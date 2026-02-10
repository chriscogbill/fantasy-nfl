const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// GET /api/players - Search and filter players
// Query params: position, minPrice, maxPrice, search, season
router.get('/', async (req, res) => {
  try {
    const {
      position,
      minPrice,
      maxPrice,
      search,
      season = 2024,
      limit = 50,
      offset = 0
    } = req.query;

    // Get current week for calculating average points
    const weekResult = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );
    const currentWeek = weekResult.rows[0]?.setting_value || 'Preseason';

    // Use the database function for efficient searching
    const result = await pool.query(
      `SELECT * FROM get_available_players($1, $2, $3, $4, $5, $6)
       LIMIT $7 OFFSET $8`,
      [
        season,
        position || null,
        minPrice ? parseFloat(minPrice) : null,
        maxPrice ? parseFloat(maxPrice) : null,
        search || null,
        currentWeek,
        limit,
        offset
      ]
    );

    res.json({
      success: true,
      count: result.rows.length,
      players: result.rows
    });
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/players/:id - Get specific player details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { season = 2024 } = req.query;

    const result = await pool.query(
      `SELECT
        p.player_id,
        p.name,
        p.position,
        p.team,
        p.status,
        pcp.current_price,
        pcp.algorithm_price,
        pcp.ownership_count,
        pcp.last_updated,
        ROUND(AVG(ps.total_points), 2) as season_avg_points,
        COUNT(DISTINCT ps.week) as games_played
       FROM players p
       LEFT JOIN player_current_prices pcp ON p.player_id = pcp.player_id
       LEFT JOIN player_scores ps ON p.player_id = ps.player_id
         AND ps.season = $2 AND ps.league_format = 'ppr'
       WHERE p.player_id = $1
       GROUP BY p.player_id, p.name, p.position, p.team, p.status,
                pcp.current_price, pcp.algorithm_price, pcp.ownership_count, pcp.last_updated`,
      [id, season]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Player not found' });
    }

    res.json({
      success: true,
      player: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/players/:id/stats - Get player weekly stats for all 18 weeks
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const { season = 2024, format = 'ppr' } = req.query;

    // Get current week setting to determine past vs future
    const weekResult = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );
    const currentWeekSetting = weekResult.rows[0]?.setting_value || 'Preseason';
    const currentWeek = currentWeekSetting === 'Preseason' ? 0 : parseInt(currentWeekSetting);

    // Get player's current team for future fixture lookups
    const playerResult = await pool.query(
      `SELECT team FROM players WHERE player_id = $1`,
      [id]
    );
    const playerCurrentTeam = playerResult.rows[0]?.team;

    // Get past weeks stats (weeks < currentWeek) using player_stats.team for opponent
    const pastStatsResult = await pool.query(
      `SELECT
        ps.week,
        ps.season,
        ps.total_points,
        ps.passing_points,
        ps.rushing_points,
        ps.receiving_points,
        ps.kicking_points,
        ps.defense_points,
        -- Get opponent using player_stats.team (team at time of game)
        CASE
          WHEN f.home_team = COALESCE(pst.team, p.team) THEN f.away_team
          WHEN f.away_team = COALESCE(pst.team, p.team) THEN '@' || f.home_team
          ELSE NULL
        END as opponent,
        pst.passing_yards,
        pst.passing_tds,
        pst.interceptions,
        pst.completions,
        pst.attempts,
        pst.rushing_yards,
        pst.rushing_tds,
        pst.rushing_attempts,
        pst.receptions,
        pst.receiving_yards,
        pst.receiving_tds,
        pst.targets,
        pst.fg_0_19,
        pst.fg_20_29,
        pst.fg_30_39,
        pst.fg_40_49,
        pst.fg_50p,
        pst.xp_made,
        pst.def_td,
        pst.points_allowed,
        false as is_future
       FROM player_scores ps
       JOIN players p ON ps.player_id = p.player_id
       JOIN player_stats pst ON ps.player_id = pst.player_id
         AND ps.week = pst.week
         AND ps.season = pst.season
       LEFT JOIN nfl_fixtures f ON f.season = ps.season
         AND f.week = ps.week
         AND (f.home_team = COALESCE(pst.team, p.team) OR f.away_team = COALESCE(pst.team, p.team))
       WHERE ps.player_id = $1
         AND ps.season = $2
         AND ps.league_format = $3
         AND ps.week <= $4
       ORDER BY ps.week ASC`,
      [id, season, format, currentWeek]
    );

    // Get all fixtures for this team (for weeks without stats)
    const allFixturesResult = await pool.query(
      `SELECT
        f.week,
        CASE
          WHEN f.home_team = $1 THEN f.away_team
          WHEN f.away_team = $1 THEN '@' || f.home_team
          ELSE NULL
        END as opponent
       FROM nfl_fixtures f
       WHERE f.season = $2
         AND (f.home_team = $1 OR f.away_team = $1)
       ORDER BY f.week ASC`,
      [playerCurrentTeam, season]
    );
    const allFixturesMap = new Map(allFixturesResult.rows.map(row => [row.week, row]));

    // Build all 18 weeks
    const allWeeks = [];
    const pastStatsMap = new Map(pastStatsResult.rows.map(row => [row.week, row]));

    for (let week = 1; week <= 18; week++) {
      if (week <= currentWeek && pastStatsMap.has(week)) {
        // Current or past week with stats
        allWeeks.push(pastStatsMap.get(week));
      } else if (week > currentWeek) {
        // Future week - use fixture data
        const fixture = allFixturesMap.get(week);
        allWeeks.push({
          week,
          season: parseInt(season),
          total_points: null,
          passing_points: null,
          rushing_points: null,
          receiving_points: null,
          kicking_points: null,
          defense_points: null,
          opponent: fixture?.opponent || 'BYE',
          passing_yards: null,
          passing_tds: null,
          interceptions: null,
          completions: null,
          attempts: null,
          rushing_yards: null,
          rushing_tds: null,
          rushing_attempts: null,
          receptions: null,
          receiving_yards: null,
          receiving_tds: null,
          targets: null,
          fg_0_19: null,
          fg_20_29: null,
          fg_30_39: null,
          fg_40_49: null,
          fg_50p: null,
          xp_made: null,
          def_td: null,
          points_allowed: null,
          is_future: true
        });
      } else {
        // Past week but no stats (player didn't play but team had a game)
        const fixture = allFixturesMap.get(week);
        allWeeks.push({
          week,
          season: parseInt(season),
          total_points: 0,
          opponent: fixture?.opponent || 'BYE',
          is_future: false
        });
      }
    }

    res.json({
      success: true,
      count: allWeeks.length,
      currentWeek: currentWeekSetting,
      stats: allWeeks
    });
  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/players/:id/price-history - Get player price history
router.get('/:id/price-history', async (req, res) => {
  try {
    const { id } = req.params;
    const { season = 2024, limit = 20 } = req.query;

    const result = await pool.query(
      `SELECT
        history_id,
        price,
        price_change,
        change_reason,
        week,
        season,
        timestamp
       FROM player_price_history
       WHERE player_id = $1 AND season = $2
       ORDER BY timestamp DESC
       LIMIT $3`,
      [id, season, limit]
    );

    res.json({
      success: true,
      count: result.rows.length,
      history: result.rows
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/players/top/:position - Get top players by position
router.get('/top/:position', async (req, res) => {
  try {
    const { position } = req.params;
    const { season = 2024, limit = 20 } = req.query;

    const result = await pool.query(
      `SELECT
        p.player_id,
        p.name,
        p.position,
        p.team,
        pcp.current_price,
        ROUND(AVG(ps.total_points), 2) as avg_points,
        COUNT(ps.week) as games_played
       FROM players p
       JOIN player_current_prices pcp ON p.player_id = pcp.player_id
       LEFT JOIN player_scores ps ON p.player_id = ps.player_id
         AND ps.season = $2 AND ps.league_format = 'ppr'
       WHERE p.position = $1 AND pcp.season = $2
       GROUP BY p.player_id, p.name, p.position, p.team, pcp.current_price
       ORDER BY pcp.current_price DESC
       LIMIT $3`,
      [position.toUpperCase(), season, limit]
    );

    res.json({
      success: true,
      position: position.toUpperCase(),
      count: result.rows.length,
      players: result.rows
    });
  } catch (error) {
    console.error('Error fetching top players:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const { requireAdmin } = require('../middleware/requireAuth');

// PUT /api/players/:id/price - Adjust player price (admin only)
router.put('/:id/price', requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { change, season, week, day } = req.body;

    if (change === undefined || !season || !week || !day) {
      return res.status(400).json({
        success: false,
        error: 'change, season, week, and day are required'
      });
    }

    const priceChange = parseFloat(change);
    if (isNaN(priceChange) || priceChange === 0) {
      return res.status(400).json({
        success: false,
        error: 'change must be a non-zero number'
      });
    }

    await client.query('BEGIN');

    // Get current price
    const currentResult = await client.query(
      `SELECT current_price FROM player_current_prices WHERE player_id = $1 AND season = $2`,
      [id, season]
    );

    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Player price not found for this season'
      });
    }

    const oldPrice = parseFloat(currentResult.rows[0].current_price);
    const newPrice = Math.max(4.5, Math.round((oldPrice + priceChange) * 10) / 10);

    // Update current price
    await client.query(
      `UPDATE player_current_prices
       SET current_price = $1, manual_override = true, last_updated = CURRENT_TIMESTAMP
       WHERE player_id = $2 AND season = $3`,
      [newPrice, id, season]
    );

    // Record in price history
    await client.query(
      `INSERT INTO player_price_history (player_id, price, price_change, change_reason, week, day, season)
       VALUES ($1, $2, $3, 'admin_manual', $4, $5, $6)`,
      [id, newPrice, priceChange, week, day, season]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Price updated from $${oldPrice.toFixed(1)}M to $${newPrice.toFixed(1)}M`,
      player_id: parseInt(id),
      old_price: oldPrice,
      new_price: newPrice,
      change: priceChange
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating player price:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
