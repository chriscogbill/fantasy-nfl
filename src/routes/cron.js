// Weekly ritual automation. A Railway cron service POSTs /api/cron/tick
// hourly; this endpoint decides what (if anything) is due. Inert unless the
// app_settings clock_mode is 'live' — during simulation/testing the admin
// drives the week by hand and the cron must not fight them.
//
// Live-mode weekly rhythm (ET), agreed 2026-07-22:
// - Lock/advance: 90min before the next week's first kickoff (Thu), the week
//   advances and rosters copy forward. The week boundary IS the lock.
// - Stats: imported hourly through the game window (Thu 18:00 ET -> Tue
//   09:00 ET). The Tuesday-morning runs are the "final sweep".
// - Reprice: Wed 01:00-06:00 ET window, once, on the just-completed week
//   (guarded by existing weekly_reprice history rows).

const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { getCurrentSeason } = require('../helpers/settings');
const { requireAdminOrCron } = require('../middleware/requireAuth');
const { importWeekStats } = require('../../importStats');
const { applyAutoSubs } = require('../helpers/autoSubs');

const LOCK_OFFSET_MS = 90 * 60 * 1000;

function etParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23'
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  return { weekday: parts.weekday, hour: parseInt(parts.hour) };
}

router.post('/tick', requireAdminOrCron, async (req, res) => {
  const log = [];
  try {
    // asOf + dryRun exist so the schedule logic can be tested without
    // waiting for real Thursdays or mutating anything.
    const dryRun = !!(req.body && req.body.dryRun);
    const now = req.body && req.body.asOf ? new Date(req.body.asOf) : new Date();
    if (isNaN(now.getTime())) {
      return res.status(400).json({ success: false, error: 'invalid asOf timestamp' });
    }

    const season = await getCurrentSeason(pool);
    const settingsResult = await pool.query(
      `SELECT setting_key, setting_value FROM app_settings
       WHERE setting_key IN ('clock_mode', 'current_week')`
    );
    const settings = Object.fromEntries(settingsResult.rows.map(r => [r.setting_key, r.setting_value]));
    const clockMode = settings.clock_mode || 'simulated';

    if (clockMode !== 'live' && !dryRun) {
      return res.json({ success: true, skipped: `clock_mode is '${clockMode}'`, season });
    }
    if (clockMode !== 'live') log.push(`dry run (clock_mode '${clockMode}')`);

    const currentWeekRaw = settings.current_week;
    let week = parseInt(currentWeekRaw); // NaN during Setup/Preseason

    // --- 1. Advance at lock -------------------------------------------------
    // Preseason -> week 1 locks at week 1's deadline (rosters were built
    // directly into week 1, so nothing copies); week N -> N+1 copies rosters.
    const isPreseason = currentWeekRaw === 'Preseason';
    if (isPreseason || (!isNaN(week) && week >= 1 && week < 18)) {
      const next = isPreseason ? 1 : week + 1;
      const dl = await pool.query(
        `SELECT deadline_datetime FROM lineup_deadlines WHERE season = $1 AND week = $2`,
        [season, next]
      );
      if (dl.rows.length === 0) {
        log.push(`advance: no deadline row for week ${next}, skipping`);
      } else {
        const lockAt = new Date(new Date(dl.rows[0].deadline_datetime).getTime() - LOCK_OFFSET_MS);
        if (now >= lockAt) {
          log.push(`advance due: ${currentWeekRaw} -> ${next} (locked ${lockAt.toISOString()})`);
          if (!dryRun) {
            await pool.query(
              `UPDATE app_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
               WHERE setting_key = 'current_week'`,
              [String(next)]
            );
            if (!isPreseason) {
              const copy = await pool.query(
                `SELECT * FROM copy_all_rosters_to_next_week($1, $2, $3)`,
                [week, next, season]
              );
              log.push(`rosters copied: ${JSON.stringify(copy.rows[0] || null)}`);
              // New week = +1 free transfer for every team, banked up to 5
              const ft = await pool.query(`SELECT increment_weekly_transfers($1)`, [season]);
              log.push(`weekly free transfer granted to ${ft.rows[0].increment_weekly_transfers} teams`);
            }
          }
          week = next;
        } else {
          log.push(`advance: week ${next} locks at ${lockAt.toISOString()}`);
        }
      }
    }

    const { weekday, hour } = etParts(now);

    // --- 2. Stats import through the game window ---------------------------
    const inGameWindow =
      (weekday === 'Thu' && hour >= 18) ||
      ['Fri', 'Sat', 'Sun', 'Mon'].includes(weekday) ||
      (weekday === 'Tue' && hour < 9);
    if (inGameWindow && !isNaN(week) && week >= 1) {
      log.push(`stats import due for week ${week}`);
      if (!dryRun) {
        await importWeekStats(week, season);
        log.push('stats imported');
      }
    }

    // --- 2b. Tuesday auto-subs, after the final stats sweep ----------------
    // Games ended Monday night; the <09:00 runs finished the stats. Idempotent
    // by construction (swapped-in players played, so they never swap back out).
    if (weekday === 'Tue' && hour >= 9 && hour < 12 && !isNaN(week) && week >= 1) {
      log.push(`auto-subs due for week ${week}`);
      if (!dryRun) {
        const result = await applyAutoSubs(pool, week, season, false);
        log.push(`auto-subs applied: ${result.swaps.length} of ${result.teamsChecked} team(s) changed`);
      }
    }

    // --- 3. Wednesday reprice on the completed week ------------------------
    if (weekday === 'Wed' && hour >= 1 && hour < 6 && !isNaN(week) && week >= 2) {
      const completed = week - 1;
      const done = await pool.query(
        `SELECT 1 FROM player_price_history
         WHERE season = $1 AND week = $2 AND change_reason = 'weekly_reprice' LIMIT 1`,
        [season, completed]
      );
      if (done.rows.length > 0) {
        log.push(`reprice: week ${completed} already done`);
      } else {
        log.push(`reprice due for week ${completed}`);
        if (!dryRun) {
          const port = process.env.PORT || 3000;
          const r = await fetch(`http://127.0.0.1:${port}/api/players/reprice`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET || '' },
            body: JSON.stringify({ week: completed, season })
          });
          const b = await r.json();
          log.push(b.success
            ? `repriced week ${completed}: ${JSON.stringify(b.summary)}`
            : `reprice FAILED: ${b.error}`);
        }
      }
    }

    res.json({ success: true, dryRun, season, week: isNaN(week) ? currentWeekRaw : week, log });
  } catch (error) {
    console.error('Error in cron tick:', error);
    res.status(500).json({ success: false, error: error.message, log });
  }
});

// POST /api/cron/auto-subs - Apply (or preview) auto-subs for a completed week.
// Body: { week, season?, dryRun? }. Also runs from the Tuesday tick window.
router.post('/auto-subs', requireAdminOrCron, async (req, res) => {
  try {
    const week = parseInt(req.body && req.body.week);
    if (isNaN(week) || week < 1 || week > 18) {
      return res.status(400).json({ success: false, error: 'week (1-18) is required' });
    }
    const season = req.body.season ? parseInt(req.body.season) : await getCurrentSeason(pool);
    const dryRun = !!req.body.dryRun;
    const result = await applyAutoSubs(pool, week, season, dryRun);
    res.json({ success: true, dryRun, ...result });
  } catch (error) {
    console.error('Error applying auto-subs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
