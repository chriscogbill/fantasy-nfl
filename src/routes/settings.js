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

    // League standings (depends on league_entries)
    const standingsResult = await client.query(
      `DELETE FROM league_standings ls
       USING league_entries le, teams t
       WHERE ls.entry_id = le.entry_id AND le.team_id = t.team_id AND t.season = $1`,
      [season]
    );
    deletions.league_standings = standingsResult.rowCount;

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
       SELECT player_id, season, league_format,
         SUM(total_points), SUM(passing_points), SUM(rushing_points), SUM(receiving_points),
         SUM(kicking_points), SUM(defense_points), SUM(misc_points), COUNT(*)
       FROM player_scores
       WHERE season = $1
       GROUP BY player_id, season, league_format
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

// POST /api/settings/setup-season/copy-constraints - Copy roster constraints from previous season
router.post('/setup-season/copy-constraints', requireAdmin, async (req, res) => {
  try {
    const currentSeason = await getCurrentSeason(pool);
    const previousSeason = currentSeason - 1;

    // Check if constraints already exist for current season
    const existingResult = await pool.query(
      `SELECT COUNT(*) FROM roster_constraints WHERE season = $1`, [currentSeason]
    );

    if (parseInt(existingResult.rows[0].count) > 0) {
      return res.json({
        success: true,
        message: `Roster constraints already exist for season ${currentSeason}`,
        copied: 0
      });
    }

    const result = await pool.query(
      `INSERT INTO roster_constraints (season, budget, roster_size, min_qb, min_rb, min_wr, min_te, min_k, min_def,
        start_qb, start_rb, start_wr, start_te, start_flex, start_k, start_def, free_transfers_per_week, points_per_extra_transfer)
       SELECT $1, budget, roster_size, min_qb, min_rb, min_wr, min_te, min_k, min_def,
        start_qb, start_rb, start_wr, start_te, start_flex, start_k, start_def, free_transfers_per_week, points_per_extra_transfer
       FROM roster_constraints WHERE season = $2`,
      [currentSeason, previousSeason]
    );

    res.json({
      success: true,
      message: `Copied ${result.rowCount} constraint(s) from season ${previousSeason} to ${currentSeason}`,
      copied: result.rowCount
    });
  } catch (error) {
    console.error('Error copying constraints:', error);
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
