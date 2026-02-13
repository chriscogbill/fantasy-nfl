const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { getCurrentSeason } = require('../helpers/settings');
const { requireAdmin } = require('../middleware/requireAuth');

// GET /api/players - Search and filter players
// Query params: position, minPrice, maxPrice, search, season
router.get('/', async (req, res) => {
  try {
    const {
      position,
      minPrice,
      maxPrice,
      search,
      limit = 50,
      offset = 0
    } = req.query;
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);

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

// GET /api/players/previous-season-prices - Get player prices from the previous season
router.get('/previous-season-prices', requireAdmin, async (req, res) => {
  try {
    const currentSeason = await getCurrentSeason(pool);
    const previousSeason = currentSeason - 1;

    // Try archive first, then fall back to current prices if previous season data is still there
    let result = await pool.query(
      `SELECT player_id, final_price as price
       FROM player_prices_archive
       WHERE season = $1 AND record_type = 'current_price'`,
      [previousSeason]
    );

    if (result.rows.length === 0) {
      // Fall back to player_current_prices if not yet archived
      result = await pool.query(
        `SELECT player_id, current_price as price
         FROM player_current_prices
         WHERE season = $1`,
        [previousSeason]
      );
    }

    // Build a map
    const prices = {};
    result.rows.forEach(row => {
      prices[row.player_id] = parseFloat(row.price);
    });

    res.json({
      success: true,
      season: previousSeason,
      count: Object.keys(prices).length,
      prices
    });
  } catch (error) {
    console.error('Error fetching previous season prices:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/players/copy-prior-year-prices - Copy previous season prices to current season (admin only)
router.post('/copy-prior-year-prices', requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentSeason = await getCurrentSeason(client);
    const previousSeason = currentSeason - 1;

    // Get previous season prices (archive first, then current)
    let prevResult = await client.query(
      `SELECT player_id, final_price as price
       FROM player_prices_archive
       WHERE season = $1 AND record_type = 'current_price'`,
      [previousSeason]
    );

    if (prevResult.rows.length === 0) {
      prevResult = await client.query(
        `SELECT player_id, current_price as price
         FROM player_current_prices
         WHERE season = $1`,
        [previousSeason]
      );
    }

    if (prevResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: `No prices found for ${previousSeason} season`
      });
    }

    let updated = 0;
    for (const row of prevResult.rows) {
      await client.query(
        `INSERT INTO player_current_prices (player_id, current_price, algorithm_price, season, last_updated)
         VALUES ($1, $2, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (player_id) DO UPDATE SET
           current_price = $2, algorithm_price = $2, last_updated = CURRENT_TIMESTAMP`,
        [row.player_id, parseFloat(row.price), currentSeason]
      );
      updated++;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Copied ${updated} player prices from ${previousSeason} to ${currentSeason}`,
      playersCopied: updated,
      fromSeason: previousSeason,
      toSeason: currentSeason
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error copying prior year prices:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// Default algorithm parameters
const DEFAULT_ALGORITHM_PARAMS = {
  positionMultipliers: { QB: 0.9, RB: 1.2, WR: 1.1, TE: 1.3, K: 0.7, DEF: 0.8 },
  minPrice: 4.5,
  maxPrice: 15.0,
  minGames: 3,
};

// Shared pricing algorithm logic
async function runPricingAlgorithm(dbClient, params = {}) {
  const positionMultipliers = params.positionMultipliers || DEFAULT_ALGORITHM_PARAMS.positionMultipliers;
  const MIN_PRICE = params.minPrice != null ? parseFloat(params.minPrice) : DEFAULT_ALGORITHM_PARAMS.minPrice;
  const MAX_PRICE = params.maxPrice != null ? parseFloat(params.maxPrice) : DEFAULT_ALGORITHM_PARAMS.maxPrice;
  const MIN_GAMES = params.minGames != null ? parseInt(params.minGames) : DEFAULT_ALGORITHM_PARAMS.minGames;

  const currentSeason = await getCurrentSeason(dbClient);
  const previousSeason = currentSeason - 1;

  // Get previous season totals
  const totalsResult = await dbClient.query(
    `SELECT pst.player_id, pst.total_points, pst.games_played, p.position
     FROM player_season_totals pst
     JOIN players p ON pst.player_id = p.player_id
     WHERE pst.season = $1 AND pst.league_format = 'ppr'`,
    [previousSeason]
  );

  const playerStats = new Map();
  totalsResult.rows.forEach(row => {
    playerStats.set(row.player_id, row);
  });

  // Get all active players
  const playersResult = await dbClient.query(
    `SELECT player_id, position FROM players WHERE status != 'Inactive'`
  );

  // Calculate prices by position percentile
  const positionGroups = {};
  playersResult.rows.forEach(player => {
    const stats = playerStats.get(player.player_id);
    const avgPts = stats && stats.games_played >= MIN_GAMES
      ? parseFloat(stats.total_points) / stats.games_played
      : 0;

    if (!positionGroups[player.position]) positionGroups[player.position] = [];
    positionGroups[player.position].push({
      player_id: player.player_id,
      position: player.position,
      avg_points: avgPts,
      games_played: stats?.games_played || 0
    });
  });

  const prices = {};

  Object.entries(positionGroups).forEach(([position, players]) => {
    players.sort((a, b) => b.avg_points - a.avg_points);
    const multiplier = positionMultipliers[position] || 1.0;

    players.forEach((player, index) => {
      let price;
      if (player.avg_points === 0) {
        price = MIN_PRICE;
      } else {
        const percentile = 1 - (index / players.length);
        const rawPrice = MIN_PRICE + (MAX_PRICE - MIN_PRICE) * percentile * multiplier;
        price = Math.max(MIN_PRICE, Math.round(rawPrice * 10) / 10);
      }

      prices[player.player_id] = price;
    });
  });

  return { prices, previousSeason, currentSeason };
}

// POST /api/players/preview-initial-prices - Run pricing algorithm and return suggested prices without saving
router.post('/preview-initial-prices', requireAdmin, async (req, res) => {
  try {
    const { prices, previousSeason, currentSeason } = await runPricingAlgorithm(pool, req.body);

    res.json({
      success: true,
      previousSeason,
      currentSeason,
      count: Object.keys(prices).length,
      suggestedPrices: prices
    });
  } catch (error) {
    console.error('Error previewing initial prices:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/players/save-suggested-prices - Save a map of suggested prices (admin only)
router.post('/save-suggested-prices', requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const { prices } = req.body;
    if (!prices || typeof prices !== 'object' || Object.keys(prices).length === 0) {
      return res.status(400).json({ success: false, error: 'prices map is required' });
    }

    const currentSeason = await getCurrentSeason(client);

    await client.query('BEGIN');

    let updated = 0;
    for (const [playerId, price] of Object.entries(prices)) {
      const priceVal = parseFloat(price);
      if (isNaN(priceVal)) continue;

      await client.query(
        `INSERT INTO player_current_prices (player_id, current_price, algorithm_price, season, last_updated)
         VALUES ($1, $2, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (player_id) DO UPDATE SET
           current_price = $2, algorithm_price = $2, last_updated = CURRENT_TIMESTAMP`,
        [playerId, priceVal, currentSeason]
      );
      updated++;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Saved prices for ${updated} players`,
      playersUpdated: updated,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving suggested prices:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/players/set-initial-prices - Run pricing algorithm and save (admin only)
router.post('/set-initial-prices', requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { prices, previousSeason, currentSeason } = await runPricingAlgorithm(client, req.body);

    // UPSERT into player_current_prices
    let updated = 0;
    for (const [playerId, price] of Object.entries(prices)) {
      await client.query(
        `INSERT INTO player_current_prices (player_id, current_price, algorithm_price, last_updated)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (player_id) DO UPDATE SET
           current_price = $2, algorithm_price = $3, last_updated = CURRENT_TIMESTAMP`,
        [playerId, price, price]
      );
      updated++;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Set initial prices for ${updated} players based on ${previousSeason} season totals`,
      playersUpdated: updated,
      previousSeason,
      currentSeason
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error setting initial prices:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// GET /api/players/season-totals - Get player season totals
router.get('/season-totals', async (req, res) => {
  try {
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const format = req.query.format || 'ppr';

    const result = await pool.query(
      `SELECT pst.*, p.name, p.position, p.team
       FROM player_season_totals pst
       JOIN players p ON pst.player_id = p.player_id
       WHERE pst.season = $1 AND pst.league_format = $2
       ORDER BY pst.total_points DESC`,
      [season, format]
    );

    res.json({
      success: true,
      count: result.rows.length,
      season,
      totals: result.rows
    });
  } catch (error) {
    console.error('Error fetching season totals:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/players/:id - Get specific player details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);

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
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const format = req.query.format || 'ppr';

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
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { limit = 20 } = req.query;

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
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { limit = 20 } = req.query;

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

// PUT /api/players/:id/price - Adjust player price (admin only)
router.put('/:id/price', requireAdmin, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { change, season, week, day } = req.body;

    if (change === undefined || !season || (week === undefined || week === null) || (day === undefined || day === null)) {
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
