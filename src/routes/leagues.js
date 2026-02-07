const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// GET /api/leagues - Get all leagues
router.get('/', async (req, res) => {
  try {
    const { season = 2024, status } = req.query;

    let query = `
      SELECT
        l.*,
        COUNT(le.entry_id) as current_teams
      FROM leagues l
      LEFT JOIN league_entries le ON l.league_id = le.league_id
      WHERE l.season = $1
    `;

    const params = [season];

    if (status) {
      query += ` AND l.status = $2`;
      params.push(status);
    }

    query += `
      GROUP BY l.league_id
      ORDER BY l.created_at DESC
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      leagues: result.rows
    });
  } catch (error) {
    console.error('Error fetching leagues:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/leagues - Create new league
router.post('/', async (req, res) => {
  try {
    const {
      leagueName,
      season = 2024,
      createdBy,
      leagueAdminEmail,
      startWeek = 1,
      endWeek = 18,
      privacyType = 'public'
    } = req.body;

    if (!leagueName) {
      return res.status(400).json({
        success: false,
        error: 'leagueName is required'
      });
    }

    // Default admin email to creator if not specified
    const adminEmail = leagueAdminEmail || createdBy || null;

    // Generate invite code for private leagues
    let inviteCode = null;
    if (privacyType === 'private') {
      inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    }

    const result = await pool.query(
      `INSERT INTO leagues
       (league_name, season, created_by, league_admin_email, start_week, end_week, status, privacy_type, invite_code)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)
       RETURNING *`,
      [leagueName, season, createdBy || null, adminEmail, startWeek, endWeek, privacyType, inviteCode]
    );

    const newLeague = result.rows[0];

    // Auto-add creator's team to the league
    if (createdBy) {
      const teamResult = await pool.query(
        `SELECT team_id FROM teams WHERE user_email = $1 AND season = $2`,
        [createdBy, season]
      );

      if (teamResult.rows.length > 0) {
        await pool.query(
          `INSERT INTO league_entries (league_id, team_id) VALUES ($1, $2)`,
          [newLeague.league_id, teamResult.rows[0].team_id]
        );
      }
    }

    res.status(201).json({
      success: true,
      league: newLeague
    });
  } catch (error) {
    console.error('Error creating league:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/leagues/:id - Get league details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const leagueResult = await pool.query(
      `SELECT
        l.*,
        COUNT(le.entry_id) as current_teams
       FROM leagues l
       LEFT JOIN league_entries le ON l.league_id = le.league_id
       WHERE l.league_id = $1
       GROUP BY l.league_id`,
      [id]
    );

    if (leagueResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'League not found' });
    }

    // Get teams in league
    const teamsResult = await pool.query(
      `SELECT
        t.team_id,
        t.team_name,
        t.user_email,
        t.current_spent,
        t.remaining_budget,
        le.joined_at
       FROM league_entries le
       JOIN teams t ON le.team_id = t.team_id
       WHERE le.league_id = $1
       ORDER BY le.joined_at ASC`,
      [id]
    );

    res.json({
      success: true,
      league: {
        ...leagueResult.rows[0],
        teams: teamsResult.rows
      }
    });
  } catch (error) {
    console.error('Error fetching league:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/leagues/:id/standings - Get league standings for a specific week
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

    // Get current week to check if we're in preseason
    const weekResult = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );
    const currentWeek = weekResult.rows[0]?.setting_value || 'Preseason';

    const result = await pool.query(
      `SELECT * FROM get_league_standings($1, $2, $3)`,
      [id, week, season]
    );

    // During preseason, set all points to 0
    const standings = currentWeek === 'Preseason'
      ? result.rows.map(row => ({
          ...row,
          week_points: 0,
          total_points: 0
        }))
      : result.rows;

    res.json({
      success: true,
      leagueId: parseInt(id),
      week: parseInt(week),
      season: parseInt(season),
      standings
    });
  } catch (error) {
    console.error('Error fetching standings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/leagues/:id/history - Get full season history
router.get('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const { season = 2024 } = req.query;

    const result = await pool.query(
      `SELECT * FROM get_league_history($1, $2)`,
      [id, season]
    );

    // Group by week
    const weeklyStandings = {};
    result.rows.forEach(row => {
      if (!weeklyStandings[row.week]) {
        weeklyStandings[row.week] = [];
      }
      weeklyStandings[row.week].push(row);
    });

    res.json({
      success: true,
      leagueId: parseInt(id),
      season: parseInt(season),
      history: weeklyStandings
    });
  } catch (error) {
    console.error('Error fetching league history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/leagues/join-by-code - Join a league using invite code
router.post('/join-by-code', async (req, res) => {
  try {
    const { teamId, inviteCode } = req.body;

    if (!teamId) {
      return res.status(400).json({
        success: false,
        error: 'teamId is required'
      });
    }

    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        error: 'inviteCode is required'
      });
    }

    // Find league by invite code
    const leagueCheck = await pool.query(
      `SELECT league_id, league_name, privacy_type, invite_code FROM leagues WHERE invite_code = $1`,
      [inviteCode.toUpperCase()]
    );

    if (leagueCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid invite code. Please check and try again.'
      });
    }

    const league = leagueCheck.rows[0];

    // Check if team is already in the league
    const existingEntry = await pool.query(
      `SELECT entry_id FROM league_entries WHERE league_id = $1 AND team_id = $2`,
      [league.league_id, teamId]
    );

    if (existingEntry.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'Your team is already in this league'
      });
    }

    // Join league
    const result = await pool.query(
      `INSERT INTO league_entries (league_id, team_id)
       VALUES ($1, $2)
       RETURNING *`,
      [league.league_id, teamId]
    );

    res.status(201).json({
      success: true,
      message: `Successfully joined ${league.league_name}`,
      league_id: league.league_id,
      entry: result.rows[0]
    });
  } catch (error) {
    console.error('Error joining league by code:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/leagues/:id/join - Join a league with a team
router.post('/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { teamId, inviteCode } = req.body;

    if (!teamId) {
      return res.status(400).json({
        success: false,
        error: 'teamId is required'
      });
    }

    // Verify league exists and check privacy
    const leagueCheck = await pool.query(
      `SELECT league_id, privacy_type, invite_code FROM leagues WHERE league_id = $1`,
      [id]
    );

    if (leagueCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'League not found' });
    }

    const league = leagueCheck.rows[0];

    // Check if league is private and invite code is required
    if (league.privacy_type === 'private') {
      if (!inviteCode) {
        return res.status(403).json({
          success: false,
          error: 'This is a private league. An invite code is required.'
        });
      }
      if (inviteCode !== league.invite_code) {
        return res.status(403).json({
          success: false,
          error: 'Invalid invite code.'
        });
      }
    }

    // Join league
    const result = await pool.query(
      `INSERT INTO league_entries (league_id, team_id)
       VALUES ($1, $2)
       RETURNING *`,
      [id, teamId]
    );

    res.status(201).json({
      success: true,
      message: 'Successfully joined league',
      entry: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(409).json({
        success: false,
        error: 'Team already in this league'
      });
    }
    console.error('Error joining league:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/leagues/:id/leave - Leave a league
router.delete('/:id/leave', async (req, res) => {
  try {
    const { id } = req.params;
    const { teamId } = req.body;

    if (!teamId) {
      return res.status(400).json({
        success: false,
        error: 'teamId is required'
      });
    }

    const result = await pool.query(
      `DELETE FROM league_entries
       WHERE league_id = $1 AND team_id = $2
       RETURNING *`,
      [id, teamId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Team not found in this league'
      });
    }

    res.json({
      success: true,
      message: 'Successfully left league'
    });
  } catch (error) {
    console.error('Error leaving league:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
