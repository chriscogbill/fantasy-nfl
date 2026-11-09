const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { publicError } = require('../helpers/http');
const { getCurrentSeason } = require('../helpers/settings');
const { requireAuth, requireTeamOwnership } = require('../middleware/requireAuth');
const { stripPiiForAnon } = require('../middleware/stripPiiForAnon');
const { joinGlobalLeague } = require('../helpers/globalLeague');
const { getEditableWeek, requireEditableWeek } = require('../helpers/editableWeek');
const { ensureTeamRoster } = require('../helpers/advanceWeek');

// The 9 starting slots and the positions each one accepts
const STARTER_SLOTS = {
  QB: ['QB'], RB1: ['RB'], RB2: ['RB'], WR1: ['WR'], WR2: ['WR'],
  TE: ['TE'], FLEX: ['RB', 'WR', 'TE'], K: ['K'], DEF: ['DEF'],
};

// Public read routes stay accessible (spectator profiles) but must not
// leak email addresses to anonymous callers.
router.use(stripPiiForAnon);

// GET /api/teams - Get all teams (with optional filters)
router.get('/', async (req, res) => {
  try {
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { userEmail } = req.query;

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
    res.status(500).json({ success: false, error: publicError(error) });
  }
});

// POST /api/teams - Create new team
router.post('/', requireAuth, async (req, res) => {
  try {
    const { teamName } = req.body;
    // Identity comes from the authenticated session, NEVER the request
    // body — otherwise anyone could create/squat a team as any user.
    const userEmail = req.session.email;
    const season = req.body.season ? parseInt(req.body.season) : await getCurrentSeason(pool);

    if (!teamName) {
      return res.status(400).json({
        success: false,
        error: 'teamName is required'
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

    // Every team automatically joins the season's global league (lazily
    // created — no per-season admin step). The old version of this block
    // looked up a league named 'Overall' that never existed, so it had
    // silently never run. Never fail team creation over it.
    try {
      await joinGlobalLeague(pool, newTeam.team_id, season);
    } catch (leagueError) {
      console.error('Error adding team to the global league:', leagueError);
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
    res.status(500).json({ success: false, error: publicError(error) });
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
      const hitsResult = await pool.query(
        `SELECT COALESCE(SUM(points), 0) AS hits FROM transfer_hits
         WHERE team_id = $1 AND season = $2 AND week <= $3`,
        [id, team.season, parseInt(currentWeek)]
      );
      seasonTotalPoints = parseFloat(pointsResult.rows[0]?.total || 0) - parseFloat(hitsResult.rows[0].hits);
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
    res.status(500).json({ success: false, error: publicError(error) });
  }
});

// GET /api/teams/:id/roster - Get team roster for a specific week
router.get('/:id/roster', async (req, res) => {
  try {
    const { id } = req.params;
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { week } = req.query;

    if (!week) {
      return res.status(400).json({
        success: false,
        error: 'week parameter is required'
      });
    }

    // The editable week's roster may not exist yet for teams that made no
    // transfers; start it from last week's so the lineup page isn't empty.
    const editable = await getEditableWeek(pool);
    if (editable.week !== null && Number(week) === editable.week && Number(season) === editable.season) {
      await ensureTeamRoster(pool, id, editable.week, editable.season);
    }

    // Use the database function for roster with points
    const result = await pool.query(
      `SELECT * FROM get_lineup_with_points($1, $2, $3)`,
      [id, week, season]
    );

    // Separate starters and bench
    const starters = result.rows.filter(p => p.is_starter);
    const bench = result.rows.filter(p => !p.is_starter);

    // Starters' points, minus any transfer hits taken for this week
    const startersPoints = starters.reduce((sum, p) => sum + (parseFloat(p.week_points) || 0), 0);
    const hitsResult = await pool.query(
      `SELECT COALESCE(SUM(points), 0)::int AS hits FROM transfer_hits
       WHERE team_id = $1 AND week = $2 AND season = $3`,
      [id, week, season]
    );
    const transferHits = hitsResult.rows[0].hits;
    const totalPoints = startersPoints - transferHits;

    res.json({
      success: true,
      week: parseInt(week),
      season: parseInt(season),
      startersPoints: Math.round(startersPoints * 100) / 100,
      transferHits,
      totalPoints: Math.round(totalPoints * 100) / 100,
      starters,
      bench,
      rosterCount: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching roster:', error);
    res.status(500).json({ success: false, error: publicError(error) });
  }
});

// GET /api/teams/:id/standings - Get team standings across all leagues
router.get('/:id/standings', async (req, res) => {
  try {
    const { id } = req.params;
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { week } = req.query;

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
    res.status(500).json({ success: false, error: publicError(error) });
  }
});

// PUT /api/teams/:id/lineup - Manually set starting lineup
router.put('/:id/lineup', requireTeamOwnership({ from: 'params' }), requireEditableWeek({ teamFrom: 'params', db: pool }), async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { lineup } = req.body;
    const { week, season } = req.editable;

    if (!lineup || !Array.isArray(lineup)) {
      return res.status(400).json({
        success: false,
        error: 'lineup array is required'
      });
    }

    // Each entry must be a real starting slot, used once, holding a player
    // from this team's roster whose position fits the slot. Anything else
    // (made-up slot names, duplicates) would let bench players score.
    const rosterResult = await client.query(
      `SELECT r.player_id, p.position FROM rosters r JOIN players p ON p.player_id = r.player_id
       WHERE r.team_id = $1 AND r.week = $2 AND r.season = $3`,
      [id, week, season]
    );
    const positionOf = new Map(rosterResult.rows.map(r => [r.player_id, r.position]));
    const seenSlots = new Set();
    const seenPlayers = new Set();
    for (const entry of lineup) {
      const slot = entry && entry.position_slot;
      const playerId = Number(entry && entry.player_id);
      if (!Object.prototype.hasOwnProperty.call(STARTER_SLOTS, slot)) {
        return res.status(400).json({ success: false, error: `Unknown lineup slot: ${slot}` });
      }
      if (seenSlots.has(slot)) {
        return res.status(400).json({ success: false, error: `Slot ${slot} is used more than once` });
      }
      if (!positionOf.has(playerId)) {
        return res.status(400).json({ success: false, error: `Player ${entry.player_id} is not on this week's roster` });
      }
      if (seenPlayers.has(playerId)) {
        return res.status(400).json({ success: false, error: `Player ${playerId} is in more than one slot` });
      }
      if (!STARTER_SLOTS[slot].includes(positionOf.get(playerId))) {
        return res.status(400).json({ success: false, error: `A ${positionOf.get(playerId)} can't play ${slot}` });
      }
      seenSlots.add(slot);
      seenPlayers.add(playerId);
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
        [position_slot, id, Number(player_id), week, season]
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
    res.status(500).json({ success: false, error: publicError(error) });
  } finally {
    client.release();
  }
});

// PUT /api/teams/:id/bench-order - Set bench priority for auto-subs.
// Body: { week, season?, order: [player_id, ...] } — first in the array is
// first to come in. Same deadline lock as lineup changes.
router.put('/:id/bench-order', requireTeamOwnership({ from: 'params' }), requireEditableWeek({ teamFrom: 'params', db: pool }), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { order } = req.body;
    const { week, season } = req.editable;

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, error: 'a non-empty order array is required' });
    }

    // Only this team's BENCH rows for the week are orderable
    const benchResult = await client.query(
      `SELECT player_id FROM rosters
       WHERE team_id = $1 AND week = $2 AND season = $3 AND position_slot = 'BENCH'`,
      [id, week, season]
    );
    const benchIds = new Set(benchResult.rows.map(r => r.player_id));
    const invalid = order.filter(pid => !benchIds.has(pid));
    if (invalid.length > 0) {
      return res.status(400).json({ success: false, error: `Not on this week's bench: ${invalid.join(', ')}` });
    }

    await client.query('BEGIN');
    for (let i = 0; i < order.length; i++) {
      await client.query(
        `UPDATE rosters SET bench_order = $1
         WHERE team_id = $2 AND week = $3 AND season = $4 AND player_id = $5`,
        [i + 1, id, week, season, order[i]]
      );
    }
    await client.query('COMMIT');

    res.json({ success: true, week: parseInt(week), season, ordered: order.length });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) { /* no txn */ }
    console.error('Error setting bench order:', error);
    res.status(500).json({ success: false, error: publicError(error) });
  } finally {
    client.release();
  }
});

// POST /api/teams/:id/lineup/auto - Auto-set optimal starting lineup
router.post('/:id/lineup/auto', requireTeamOwnership({ from: 'params' }), requireEditableWeek({ teamFrom: 'params', db: pool }), async (req, res) => {
  try {
    const { id } = req.params;
    const { week, season } = req.editable;

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
    res.status(500).json({ success: false, error: publicError(error) });
  }
});

// GET /api/teams/:id/weekly-breakdown - Get detailed weekly scoring breakdown
router.get('/:id/weekly-breakdown', async (req, res) => {
  try {
    const { id } = req.params;
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { week } = req.query;

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
    res.status(500).json({ success: false, error: publicError(error) });
  }
});

// GET /api/teams/:id/transfers - Get transfer history
router.get('/:id/transfers', async (req, res) => {
  try {
    const { id } = req.params;
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { limit = 20 } = req.query;

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
    res.status(500).json({ success: false, error: publicError(error) });
  }
});

module.exports = router;
