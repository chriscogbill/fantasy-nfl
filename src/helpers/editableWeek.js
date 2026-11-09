// Which week owners may change right now, and whether it is locked.
//
// Owners only ever edit the NEXT week: week 1 during Setup/Preseason, else
// current_week + 1. Every endpoint that changes a roster or lineup goes through
// requireEditableWeek, so a hand-edited request can't rewrite a week that has
// already been played (standings are computed live from those rosters).
//
// Lock: in live mode the week locks 90 minutes before its first kickoff (the
// same rule the cron uses to advance). In simulated mode it locks when the
// simulated current_day reaches the week's deadline_day, as before. Preseason
// never locks.

const { getCurrentSeason } = require('./settings');
const { ensureTeamRoster } = require('./advanceWeek');

const LOCK_OFFSET_MS = 90 * 60 * 1000;
const LAST_WEEK = 18;

async function getEditableWeek(db) {
  const season = await getCurrentSeason(db);
  const rows = (await db.query(
    `SELECT setting_key, setting_value FROM app_settings
     WHERE setting_key IN ('current_week', 'current_day', 'clock_mode')`
  )).rows;
  const s = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value]));
  const current = s.current_week || 'Preseason';

  if (current === 'Setup' || current === 'Preseason') {
    return { season, week: 1, locked: false };
  }
  const n = parseInt(current);
  if (isNaN(n)) return { season, week: null, locked: true, reason: 'The current week is not set' };
  if (n >= LAST_WEEK) return { season, week: null, locked: true, reason: 'The season is over' };

  const week = n + 1;
  const dl = (await db.query(
    `SELECT deadline_datetime, deadline_day FROM lineup_deadlines WHERE season = $1 AND week = $2`,
    [season, week]
  )).rows[0];

  let locked = false;
  if (dl) {
    if (s.clock_mode === 'live') {
      locked = Date.now() >= new Date(dl.deadline_datetime).getTime() - LOCK_OFFSET_MS;
    } else {
      locked = (parseInt(s.current_day) || 1) >= dl.deadline_day;
    }
  }
  return { season, week, locked, reason: locked ? `Week ${week} is locked — its deadline has passed` : null };
}

// Middleware factory. Reads the team id and requested week/season from the
// request, rejects anything but the editable, unlocked week of the current
// season, and leaves { season, week } on req.editable for the handler.
function requireEditableWeek({ teamFrom = 'params', db }) {
  return async (req, res, next) => {
    try {
      const editable = await getEditableWeek(db);
      if (editable.week === null) {
        return res.status(400).json({ success: false, error: editable.reason });
      }
      const requestedWeek = Number(req.body.week);
      if (requestedWeek !== editable.week) {
        return res.status(400).json({ success: false, error: `Only week ${editable.week} can be changed` });
      }
      if (req.body.season !== undefined && req.body.season !== null && Number(req.body.season) !== editable.season) {
        return res.status(400).json({ success: false, error: `Only the ${editable.season} season can be changed` });
      }
      if (editable.locked) {
        return res.status(403).json({ success: false, error: editable.reason });
      }
      const teamId = teamFrom === 'params' ? req.params.id : req.body.teamId;
      // A team whose next-week roster was never created starts from last week's
      await ensureTeamRoster(db, teamId, editable.week, editable.season);
      req.editable = editable;
      next();
    } catch (error) {
      console.error('Error checking editable week:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

module.exports = { getEditableWeek, requireEditableWeek };
