const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { requireAdmin } = require('../middleware/requireAuth');
const { getCurrentSeason } = require('../helpers/settings');

// GET /api/settings - Get all settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT setting_key, setting_value, description, updated_at
       FROM app_settings
       ORDER BY setting_key`
    );

    // Convert to key-value object
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = {
        value: row.setting_value,
        description: row.description,
        updated_at: row.updated_at
      };
    });

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/settings/:key - Get specific setting
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;

    const result = await pool.query(
      `SELECT setting_value, description, updated_at
       FROM app_settings
       WHERE setting_key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Setting not found' });
    }

    res.json({
      success: true,
      key,
      value: result.rows[0].setting_value,
      description: result.rows[0].description,
      updated_at: result.rows[0].updated_at
    });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/:key - Update setting (admin only)
router.put('/:key', requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!value && value !== 0) {
      return res.status(400).json({ success: false, error: 'value is required' });
    }

    // Special handling for current_week changes
    if (key === 'current_week') {
      // Get the old week value
      const oldWeekResult = await pool.query(
        `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
      );
      const oldWeek = oldWeekResult.rows[0]?.setting_value;

      // Update the setting
      const result = await pool.query(
        `UPDATE app_settings
         SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
         WHERE setting_key = $2
         RETURNING *`,
        [value, key]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Setting not found' });
      }

      // Auto-copy rosters when advancing from Preseason to Week 1 or between weeks
      let copyResult = null;
      if (oldWeek === 'Preseason' && value === '1') {
        // Don't copy anything - Week 1 rosters should be built manually during preseason
        console.log('Advanced from Preseason to Week 1 - no roster copying needed');
      } else if (oldWeek !== 'Preseason' && value !== 'Preseason') {
        const fromWeek = parseInt(oldWeek);
        const toWeek = parseInt(value);

        // Only copy forward if advancing weeks
        if (toWeek === fromWeek + 1) {
          const currentSeason = await getCurrentSeason(pool);
          copyResult = await pool.query(
            `SELECT * FROM copy_all_rosters_to_next_week($1, $2, $3)`,
            [fromWeek, toWeek, currentSeason]
          );
          console.log(`Copied rosters from Week ${fromWeek} to Week ${toWeek}:`, copyResult.rows[0]);
          // New week = +1 free transfer for every team, banked up to 5
          const ft = await pool.query(`SELECT increment_weekly_transfers($1)`, [currentSeason]);
          console.log(`Granted weekly free transfer to ${ft.rows[0].increment_weekly_transfers} teams`);
        }
      } else if (value === 'Preseason') {
        console.log('Set to Preseason - no roster copying needed');
      }

      res.json({
        success: true,
        message: `Setting '${key}' updated successfully`,
        setting: {
          key: result.rows[0].setting_key,
          value: result.rows[0].setting_value,
          description: result.rows[0].description,
          updated_at: result.rows[0].updated_at
        },
        rostersCopied: copyResult ? copyResult.rows[0] : null
      });
    } else {
      // Normal setting update
      const result = await pool.query(
        `UPDATE app_settings
         SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
         WHERE setting_key = $2
         RETURNING *`,
        [value, key]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Setting not found' });
      }

      res.json({
        success: true,
        message: `Setting '${key}' updated successfully`,
        setting: {
          key: result.rows[0].setting_key,
          value: result.rows[0].setting_value,
          description: result.rows[0].description,
          updated_at: result.rows[0].updated_at
        }
      });
    }
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/settings/clear-season-data - Clear test data for a season (admin only)
router.post('/clear-season-data', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const season = req.body.season ? parseInt(req.body.season) : await getCurrentSeason(pool);

    await client.query('BEGIN');

    // Delete in FK-safe order
    const deletions = {};

    // League entries (depends on teams)
    const entriesResult = await client.query(
      `DELETE FROM league_entries le
       USING teams t
       WHERE le.team_id = t.team_id AND t.season = $1`,
      [season]
    );
    deletions.league_entries = entriesResult.rowCount;

    // Rosters
    const rostersResult = await client.query(
      `DELETE FROM rosters WHERE season = $1`, [season]
    );
    deletions.rosters = rostersResult.rowCount;

    // Transfers
    const transfersResult = await client.query(
      `DELETE FROM transfers WHERE season = $1`, [season]
    );
    deletions.transfers = transfersResult.rowCount;

    // Leagues
    const leaguesResult = await client.query(
      `DELETE FROM leagues WHERE season = $1`, [season]
    );
    deletions.leagues = leaguesResult.rowCount;

    // Teams
    const teamsResult = await client.query(
      `DELETE FROM teams WHERE season = $1`, [season]
    );
    deletions.teams = teamsResult.rowCount;

    // Also clear current-season-only pricing tables
    const pricesResult = await client.query(`DELETE FROM player_current_prices`);
    deletions.player_current_prices = pricesResult.rowCount;

    const priceHistResult = await client.query(`DELETE FROM player_price_history`);
    deletions.player_price_history = priceHistResult.rowCount;

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Test data cleared for season ${season}`,
      deletions
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error clearing season data:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/settings/roll-forward-season - Roll forward to next season (admin only)
router.post('/roll-forward-season', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const currentSeason = await getCurrentSeason(pool);
    const newSeason = currentSeason + 1;

    await client.query('BEGIN');

    // Step 1: Compute player_season_totals from player_scores (must happen while player_stats still has data)
    const totalsResult = await client.query(
      `INSERT INTO player_season_totals (player_id, season, league_format, total_points, passing_points, rushing_points, receiving_points, kicking_points, defense_points, misc_points, games_played)
       SELECT ps.player_id, ps.season, ps.league_format,
         SUM(ps.total_points), SUM(ps.passing_points), SUM(ps.rushing_points), SUM(ps.receiving_points),
         SUM(ps.kicking_points), SUM(ps.defense_points), SUM(ps.misc_points),
         -- Played games only. Inactive is NOT the same as scoring zero: a
         -- kicker who missed his only FG attempt PLAYED (fga > 0) even at
         -- 0.0 fantasy points, while Sleeper's all-zero rows for rostered
         -- inactives must not count. So "played" = any non-zero stat column
         -- (the same definition the reprice and auto-subs use); DEF counts
         -- whenever a stats row exists (a shutout is legitimately all-zero).
         COUNT(*) FILTER (WHERE pl.position = 'DEF' OR
           st.passing_yards <> 0 OR st.passing_tds <> 0 OR st.interceptions <> 0 OR st.completions <> 0 OR st.attempts <> 0 OR
           st.rushing_yards <> 0 OR st.rushing_tds <> 0 OR st.rushing_attempts <> 0 OR
           st.receptions <> 0 OR st.receiving_yards <> 0 OR st.receiving_tds <> 0 OR st.targets <> 0 OR
           st.fumbles_lost <> 0 OR st.two_point_conversions <> 0 OR
           st.fg_0_19 <> 0 OR st.fg_20_29 <> 0 OR st.fg_30_39 <> 0 OR st.fg_40_49 <> 0 OR st.fg_50p <> 0 OR
           st.xp_made <> 0 OR st.xp_missed <> 0 OR st.fga <> 0 OR st.def_td <> 0)
       FROM player_scores ps
       JOIN player_stats st ON st.player_id = ps.player_id AND st.week = ps.week AND st.season = ps.season
       JOIN players pl ON pl.player_id = ps.player_id
       WHERE ps.season = $1
       GROUP BY ps.player_id, ps.season, ps.league_format
       ON CONFLICT (player_id, season, league_format) DO UPDATE SET
         total_points = EXCLUDED.total_points, passing_points = EXCLUDED.passing_points,
         rushing_points = EXCLUDED.rushing_points, receiving_points = EXCLUDED.receiving_points,
         kicking_points = EXCLUDED.kicking_points, defense_points = EXCLUDED.defense_points,
         misc_points = EXCLUDED.misc_points, games_played = EXCLUDED.games_played`,
      [currentSeason]
    );

    // Step 2: Archive player_stats
    await client.query(
      `INSERT INTO player_stats_archive
       SELECT stat_id, player_id, week, season, opponent, passing_yards, passing_tds, interceptions,
              completions, attempts, rushing_yards, rushing_tds, rushing_attempts, receptions,
              receiving_yards, receiving_tds, targets, fumbles_lost, two_point_conversions,
              game_date, created_at, fg_0_19, fg_20_29, fg_30_39, fg_40_49, fg_50p,
              xp_made, xp_missed, fga, def_td, points_allowed, team, CURRENT_TIMESTAMP
       FROM player_stats WHERE season = $1
       ON CONFLICT (player_id, week, season) DO NOTHING`,
      [currentSeason]
    );
    await client.query(`DELETE FROM player_stats WHERE season = $1`, [currentSeason]);

    // Step 3: Archive player_current_prices
    await client.query(
      `INSERT INTO player_prices_archive (season, player_id, final_price, algorithm_price, record_type, original_timestamp)
       SELECT $1, player_id, current_price, algorithm_price, 'final_price', last_updated
       FROM player_current_prices`,
      [currentSeason]
    );
    await client.query(`DELETE FROM player_current_prices`);

    // Step 4: Archive player_price_history
    await client.query(
      `INSERT INTO player_prices_archive (season, player_id, price, price_change, change_reason, week, day, record_type, original_timestamp)
       SELECT season, player_id, price, price_change, change_reason, week, day, 'movement', timestamp
       FROM player_price_history
       WHERE season = $1`,
      [currentSeason]
    );
    await client.query(`DELETE FROM player_price_history WHERE season = $1`, [currentSeason]);

    // Step 5: Archive scoring rules (scoring table NOT cleared — rules carry forward)
    await client.query(
      `INSERT INTO scoring_archive (season, scoring_type, points, league_format, description, scoring_section, section_name)
       SELECT $1, s.scoring_type, s.points, s.league_format, s.description, s.scoring_section, ss.section_name
       FROM scoring s
       LEFT JOIN scoring_sections ss ON s.scoring_section = ss.section_id`,
      [currentSeason]
    );

    // Step 6: Update current_season and set week to Setup
    await client.query(
      `UPDATE app_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'current_season'`,
      [newSeason.toString()]
    );
    await client.query(
      `UPDATE app_settings SET setting_value = 'Setup', updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'current_week'`
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Season rolled forward from ${currentSeason} to ${newSeason}`,
      previousSeason: currentSeason,
      newSeason,
      seasonTotalsComputed: totalsResult.rowCount
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error rolling forward season:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/settings/roll-back-season - Roll back to previous season (admin only, for testing)
router.post('/roll-back-season', requireAdmin, async (req, res) => {
  try {
    const currentSeason = await getCurrentSeason(pool);
    const previousSeason = currentSeason - 1;

    // Simply decrement the season — does NOT un-archive data
    await pool.query(
      `UPDATE app_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP WHERE setting_key = 'current_season'`,
      [previousSeason.toString()]
    );

    res.json({
      success: true,
      message: `Season rolled back from ${currentSeason} to ${previousSeason}. Note: archived data is NOT restored.`,
      previousSeason: currentSeason,
      newSeason: previousSeason
    });
  } catch (error) {
    console.error('Error rolling back season:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/settings/current/week - Convenience endpoint for current week
router.get('/current/week', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );

    res.json({
      success: true,
      week: parseInt(result.rows[0].setting_value)
    });
  } catch (error) {
    console.error('Error fetching current week:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
