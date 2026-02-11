const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// GET /api/teams - Get all teams (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { season = 2024, userEmail } = req.query;

    let query = `
      SELECT
        t.team_id,
        t.team_name,
        t.user_email,
        u.username as manager_name,
        t.season,
        t.current_spent,
        t.remaining_budget,
        t.created_at,
        COUNT(DISTINCT le.league_id) as leagues_count,
        COUNT(DISTINCT r.player_id) as roster_count,
        COALESCE((
          SELECT SUM(pcp.current_price)
          FROM rosters r2
          JOIN player_current_prices pcp ON r2.player_id = pcp.player_id
          WHERE r2.team_id = t.team_id
            AND r2.week = (SELECT MAX(week) FROM rosters WHERE team_id = t.team_id)
            AND pcp.season = t.season
        ), 0) as current_value
      FROM teams t
      LEFT JOIN user_profiles u ON t.user_email = u.email
      LEFT JOIN league_entries le ON t.team_id = le.team_id
      LEFT JOIN rosters r ON t.team_id = r.team_id AND r.season = t.season
      WHERE t.season = $1
    `;

    const params = [season];

    if (userEmail) {
      query += ` AND t.user_email = $2`;
      params.push(userEmail);
    }

    query += `
      GROUP BY t.team_id, t.team_name, t.user_email, u.username, t.season,
               t.current_spent, t.remaining_budget, t.created_at
      ORDER BY t.created_at DESC
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      teams: result.rows
    });
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/teams - Create new team
router.post('/', async (req, res) => {
  try {
    const { teamName, userEmail, season = 2024 } = req.body;

    if (!teamName || !userEmail) {
      return res.status(400).json({
        success: false,
        error: 'teamName and userEmail are required'
      });
    }

    // Check if user already has a team for this season
    const existingTeam = await pool.query(
      `SELECT team_id, team_name FROM teams WHERE user_email = $1 AND season = $2`,
      [userEmail, season]
    );

    if (existingTeam.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'You already have a team for this season. Each user can only create one team per season.'
      });
    }

    const result = await pool.query(
      `INSERT INTO teams (team_name, user_email, season, current_spent, remaining_budget)
       VALUES ($1, $2, $3, 0, 100.0)
       RETURNING *`,
      [teamName, userEmail, season]
    );

    const newTeam = result.rows[0];

    // Automatically add team to the Overall league
    try {
      const overallLeague = await pool.query(
        `SELECT league_id FROM leagues WHERE league_name = 'Overall' AND season = $1 AND privacy_type = 'public'`,
        [season]
      );

      if (overallLeague.rows.length > 0) {
        await pool.query(
          `INSERT INTO league_entries (league_id, team_id)
           VALUES ($1, $2)
           ON CONFLICT (league_id, team_id) DO NOTHING`,
          [overallLeague.rows[0].league_id, newTeam.team_id]
        );
      }
    } catch (leagueError) {
      console.error('Error adding team to Overall league:', leagueError);
      // Don't fail the team creation if adding to Overall league fails
    }

    res.status(201).json({
      success: true,
      team: newTeam
    });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        success: false,
        error: 'Team name already exists for this user and season'
      });
    }
    console.error('Error creating team:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/teams/:id - Get team details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get current week
    const weekResult = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );
    const currentWeek = weekResult.rows[0]?.setting_value || 'Preseason';

    const result = await pool.query(
      `SELECT
        t.*,
        u.username as manager_name,
        COUNT(DISTINCT le.league_id) as leagues_count,
        COUNT(DISTINCT r.player_id) FILTER (WHERE r.week = (
          SELECT MAX(week) FROM rosters WHERE team_id = t.team_id
        )) as current_roster_count,
        COALESCE((
          SELECT SUM(pcp.current_price)
          FROM rosters r
          JOIN player_current_prices pcp ON r.player_id = pcp.player_id
          WHERE r.team_id = t.team_id
            AND r.week = (SELECT MAX(week) FROM rosters WHERE team_id = t.team_id)
            AND pcp.season = t.season
        ), 0) as current_value
       FROM teams t
       LEFT JOIN user_profiles u ON t.user_email = u.email
       LEFT JOIN league_entries le ON t.team_id = le.team_id
       LEFT JOIN rosters r ON t.team_id = r.team_id
       WHERE t.team_id = $1
       GROUP BY t.team_id, u.username`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }

    const team = result.rows[0];

    // Calculate season total points (sum of all weeks up to current week)
    let seasonTotalPoints = 0;
    if (currentWeek !== 'Preseason') {
      const pointsResult = await pool.query(
        `SELECT SUM(week_points) as total
         FROM (
           SELECT
             r.week,
             SUM(COALESCE(ps.total_points, 0)) as week_points
           FROM rosters r
           JOIN players p ON r.player_id = p.player_id
           LEFT JOIN player_scores ps ON p.player_id = ps.player_id
             AND ps.week = r.week
             AND ps.season = r.season
             AND ps.league_format = 'ppr'
           WHERE r.team_id = $1
             AND r.season = $2
             AND r.week <= $3
             AND r.position_slot != 'BENCH'
           GROUP BY r.week
         ) weekly_totals`,
        [id, team.season, parseInt(currentWeek)]
      );
      seasonTotalPoints = parseFloat(pointsResult.rows[0]?.total || 0);
    }

    res.json({
      success: true,
      team: {
        ...team,
        season_total_points: seasonTotalPoints
      }
    });
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/teams/:id/roster - Get team roster for a specific week
router.get('/:id/roster', async (req, res) => {
  try {
    const { id } = req.params;
    const { week, season = 2024 } = req.query;

    if (!week) {
      return res.status(400).json({
        success: false,
        error: 'week parameter is required'
      });
    }

    // Use the database function for roster with points
    const result = await pool.query(
      `SELECT * FROM get_lineup_with_points($1, $2, $3)`,
      [id, week, season]
    );

    // Separate starters and bench
    const starters = result.rows.filter(p => p.is_starter);
    const bench = result.rows.filter(p => !p.is_starter);

    // Calculate total points
    const totalPoints = starters.reduce((sum, p) => sum + (parseFloat(p.week_points) || 0), 0);

    res.json({
      success: true,
      week: parseInt(week),
      season: parseInt(season),
      totalPoints: Math.round(totalPoints * 100) / 100,
      starters,
      bench,
      rosterCount: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching roster:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/teams/:id/standings - Get team standings across all leagues
router.get('/:id/standings', async (req, res) => {
  try {
    const { id } = req.params;
    const { week, season = 2024 } = req.query;

    if (!week) {
      return res.status(400).json({
        success: false,
        error: 'week parameter is required'
      });
    }

    const result = await pool.query(
      `SELECT * FROM get_team_league_positions($1, $2, $3)`,
      [id, week, season]
    );

    res.json({
      success: true,
      week: parseInt(week),
      season: parseInt(season),
      standings: result.rows
    });
  } catch (error) {
    console.error('Error fetching standings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/teams/:id/lineup - Manually set starting lineup
router.put('/:id/lineup', async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { week, season = 2024, lineup } = req.body;

    if (!week) {
      return res.status(400).json({
        success: false,
        error: 'week is required'
      });
    }

    if (!lineup || !Array.isArray(lineup)) {
      return res.status(400).json({
        success: false,
        error: 'lineup array is required'
      });
    }

    // Check deadline enforcement (uses simulated date from app_settings)
    const settingsResult = await client.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('current_week', 'current_day', 'current_season')"
    );
    const settings = {};
    settingsResult.rows.forEach(r => { settings[r.setting_key] = r.setting_value; });

    if (settings.current_week && settings.current_week !== 'Preseason' && settings.current_week !== 'Setup') {
      const deadlineResult = await client.query(
        'SELECT deadline_day FROM lineup_deadlines WHERE season = $1 AND week = $2',
        [parseInt(settings.current_season) || season, parseInt(settings.current_week) + 1]
      );

      if (deadlineResult.rows.length > 0) {
        const deadlineDay = deadlineResult.rows[0].deadline_day;
        const currentDay = parseInt(settings.current_day) || 1;

        if (currentDay >= deadlineDay) {
          client.release();
          return res.status(403).json({
            success: false,
            error: 'Lineup locked — deadline has passed for this week'
          });
        }
      }
    }

    await client.query('BEGIN');

    // First, set all players in this week's roster to BENCH
    await client.query(
      `UPDATE rosters
       SET position_slot = 'BENCH'
       WHERE team_id = $1 AND week = $2 AND season = $3`,
      [id, week, season]
    );

    // Then, update the specified positions
    for (const { position_slot, player_id } of lineup) {
      await client.query(
        `UPDATE rosters
         SET position_slot = $1
         WHERE team_id = $2 AND player_id = $3 AND week = $4 AND season = $5`,
        [position_slot, id, player_id, week, season]
      );
    }

    await client.query('COMMIT');

    // Return the updated lineup
    const result = await pool.query(
      `SELECT * FROM get_lineup_with_points($1, $2, $3)`,
      [id, week, season]
    );

    const starters = result.rows.filter(p => p.is_starter);
    const bench = result.rows.filter(p => !p.is_starter);

    res.json({
      success: true,
      message: 'Lineup updated successfully',
      starters,
      bench
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating lineup:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/teams/:id/lineup/auto - Auto-set optimal starting lineup
router.post('/:id/lineup/auto', async (req, res) => {
  try {
    const { id } = req.params;
    const { week, season = 2024 } = req.body;

    if (!week) {
      return res.status(400).json({
        success: false,
        error: 'week is required'
      });
    }

    // Call the database function to set lineup
    await pool.query(
      `SELECT set_starting_lineup($1, $2, $3)`,
      [id, week, season]
    );

    // Return the updated lineup
    const result = await pool.query(
      `SELECT * FROM get_lineup_with_points($1, $2, $3)`,
      [id, week, season]
    );

    const starters = result.rows.filter(p => p.is_starter);
    const bench = result.rows.filter(p => !p.is_starter);

    res.json({
      success: true,
      message: 'Lineup auto-optimized successfully',
      starters,
      bench
    });
  } catch (error) {
    console.error('Error auto-setting lineup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/teams/:id/weekly-breakdown - Get detailed weekly scoring breakdown
router.get('/:id/weekly-breakdown', async (req, res) => {
  try {
    const { id } = req.params;
    const { week, season = 2024 } = req.query;

    if (!week) {
      return res.status(400).json({
        success: false,
        error: 'week parameter is required'
      });
    }

    const result = await pool.query(
      `SELECT * FROM get_team_weekly_breakdown($1, $2, $3)`,
      [id, week, season]
    );

    res.json({
      success: true,
      week: parseInt(week),
      season: parseInt(season),
      breakdown: result.rows
    });
  } catch (error) {
    console.error('Error fetching weekly breakdown:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/teams/:id/transfers - Get transfer history
router.get('/:id/transfers', async (req, res) => {
  try {
    const { id } = req.params;
    const { season = 2024, limit = 20 } = req.query;

    const result = await pool.query(
      `SELECT * FROM get_transfer_history($1, $2, $3)`,
      [id, season, limit]
    );

    res.json({
      success: true,
      count: result.rows.length,
      transfers: result.rows
    });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
