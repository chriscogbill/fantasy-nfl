const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { getCurrentSeason } = require('../helpers/settings');
const { requireAdmin, requireAdminOrCron } = require('../middleware/requireAuth');

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
       WHERE season = $1 AND record_type = 'final_price'`,
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
       WHERE season = $1 AND record_type = 'final_price'`,
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
  // Percentile is raised to this power before pricing. 1 = the original
  // linear curve, which compressed each position's whole viable pool
  // into the top few $ (feasible TEs all $16-18). >1 bends the curve so
  // price falls away quickly below the elite (Chris, 2026-07-24: Likely
  // vs Kittle should feel like $6 vs $18, not $16 vs $18).
  curveExponent: 2.0,
};

// Age adjustment applied to points-per-game BEFORE ranking (Chris,
// 2026-08-01: a 30-year-old McCaffrey shouldn't out-price 24-year-old
// Bijan/Gibbs off last season alone). Both sides are graduated per year
// (Chris: a 22-year-old second-year deserves more boost than a
// 25-year-old vet like Kyren Williams): youth bonus accrues youthRate
// per year BELOW neutralYoung (capped maxBonus); decline accrues
// declineRate per year past declineFrom (capped maxPenalty). RB ages
// hardest, QB barely; K has no meaningful age curve and DEF no age.
const AGE_CURVES = {
  RB: { neutralYoung: 26, youthRate: 0.02, maxBonus: 0.08, declineFrom: 27, declineRate: 0.04, maxPenalty: 0.20 },
  WR: { neutralYoung: 26, youthRate: 0.015, maxBonus: 0.06, declineFrom: 30, declineRate: 0.03, maxPenalty: 0.15 },
  TE: { neutralYoung: 26, youthRate: 0.015, maxBonus: 0.06, declineFrom: 30, declineRate: 0.03, maxPenalty: 0.15 },
  QB: { neutralYoung: 26, youthRate: 0.01, maxBonus: 0.04, declineFrom: 35, declineRate: 0.03, maxPenalty: 0.12 },
};

function ageFactor(position, age) {
  const c = AGE_CURVES[position];
  if (!c || age == null) return 1;
  if (age < c.neutralYoung) return 1 + Math.min(c.maxBonus, (c.neutralYoung - age) * c.youthRate);
  if (age > c.declineFrom) return 1 - Math.min(c.maxPenalty, (age - c.declineFrom) * c.declineRate);
  return 1;
}

// Shared pricing algorithm logic
async function runPricingAlgorithm(dbClient, params = {}) {
  const positionMultipliers = params.positionMultipliers || DEFAULT_ALGORITHM_PARAMS.positionMultipliers;
  const MIN_PRICE = params.minPrice != null ? parseFloat(params.minPrice) : DEFAULT_ALGORITHM_PARAMS.minPrice;
  const MAX_PRICE = params.maxPrice != null ? parseFloat(params.maxPrice) : DEFAULT_ALGORITHM_PARAMS.maxPrice;
  const MIN_GAMES = params.minGames != null ? parseInt(params.minGames) : DEFAULT_ALGORITHM_PARAMS.minGames;
  const CURVE_EXP = params.curveExponent != null ? parseFloat(params.curveExponent) : DEFAULT_ALGORITHM_PARAMS.curveExponent;

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

  // Get all active players (search_rank drives the rookie pricing pass,
  // age drives the age adjustment)
  const playersResult = await dbClient.query(
    `SELECT player_id, position, team, search_rank, age FROM players WHERE status != 'Inactive'`
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
      team: player.team,
      search_rank: player.search_rank,
      // Rank on age-adjusted production, not raw production
      avg_points: avgPts * ageFactor(player.position, player.age),
      games_played: stats?.games_played || 0
    });
  });

  const prices = {};
  let rookiesPricedByRank = 0;

  Object.entries(positionGroups).forEach(([position, players]) => {
    players.sort((a, b) => b.avg_points - a.avg_points);
    const multiplier = positionMultipliers[position] || 1.0;

    // Percentile over PRICEABLE players only: scored AND on a current
    // NFL team. Zero-sample players (practice squads, rookies) in the
    // denominator compressed the whole pool into the top prices on the
    // first 2025 preview (nothing at $5–13); team-less players both
    // distorted the curve and got priced themselves — no team means no
    // fixtures and no points, whatever last season said (Jonnu Smith,
    // FA, priced 4th in the whole game off his 2024). Everyone not
    // priceable gets the floor; an unattached star who signs mid-season
    // is caught up by the weekly repricing.
    const priceable = players.filter(pl => pl.avg_points > 0 && pl.team);

    players.forEach(player => {
      prices[player.player_id] = MIN_PRICE;
    });
    priceable.forEach((player, index) => {
      const percentile = Math.pow(1 - (index / priceable.length), CURVE_EXP);
      const rawPrice = MIN_PRICE + (MAX_PRICE - MIN_PRICE) * percentile * multiplier;
      prices[player.player_id] = Math.max(MIN_PRICE, Math.round(rawPrice * 10) / 10);
    });

    // Rookie/no-history pass: players with no prior-season sample would
    // all land on MIN_PRICE, making every hyped rookie a league-breaking
    // bargain (e.g. a first-round RB at $4.5M). Sleeper's search_rank is
    // a consensus-expectation signal we already import — price zero-
    // history players by linear interpolation between the two PRICED
    // same-position veterans bracketing their rank. Above the best
    // veteran → capped at that veteran's price (the admin starting-
    // prices page is the editorial pass for genuine outliers); no
    // meaningful rank (Sleeper sentinel 9999999 / null) → MIN_PRICE.
    const RANK_SENTINEL = 500; // Sleeper packs placeholder tiers at 999+ (seen: Freiermuth "999")
    const ladder = players
      .filter(pl =>
        pl.team &&
        pl.avg_points > 0 &&
        Number.isFinite(pl.search_rank) &&
        pl.search_rank > 0 &&
        pl.search_rank < RANK_SENTINEL
      )
      .map(pl => ({ rank: pl.search_rank, price: prices[pl.player_id] }))
      .sort((a, b) => a.rank - b.rank);

    if (ladder.length >= 2) {
      players.forEach(player => {
        if (player.avg_points !== 0) return;
        // No current NFL team = retired / unsigned, not a rookie — a
        // drafted rookie always has a team. Guards against zero-history
        // veterans with stale-but-plausible search_ranks being priced
        // like hyped rookies (Blake Jarwin, retired, previewed $17.7M).
        if (!player.team) return;
        const rank = player.search_rank;
        if (!Number.isFinite(rank) || rank <= 0 || rank >= RANK_SENTINEL) return;

        if (rank >= ladder[ladder.length - 1].rank) {
          return; // ranked below every scored veteran — MIN_PRICE stands
        }
        // Median of the 4 nearest scored neighbours by rank. Two-point
        // linear interpolation proved fragile in practice: Sleeper packs
        // rookies into placeholder rank tiers (ties at e.g. 212) and the
        // price ladder isn't monotonic in rank, which priced mid-hype
        // rookie TEs at Kelce money. A neighbourhood median smooths both.
        const byDistance = ladder
          .map(step => ({ ...step, dist: Math.abs(step.rank - rank) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 4)
          .map(step => step.price)
          .sort((a, b) => a - b);
        const mid = byDistance.length / 2;
        let price = byDistance.length % 2
          ? byDistance[Math.floor(mid)]
          : (byDistance[mid - 1] + byDistance[mid]) / 2;
        // Cap: a rookie never out-prices the position's 3rd-best proven
        // veteran — hyped rookies slot just below the established elite.
        const topPrices = [...ladder].map(l => l.price).sort((a, b) => b - a);
        const cap = topPrices[Math.min(2, topPrices.length - 1)];
        price = Math.min(price, cap);
        const rounded = Math.max(MIN_PRICE, Math.round(price * 10) / 10);
        if (rounded > MIN_PRICE) {
          prices[player.player_id] = rounded;
          rookiesPricedByRank++;
        }
      });

      // Unattached veterans (played last season, currently no team —
      // e.g. a star between contracts): Chris's call 2026-07-24 — price
      // by RANK via the same ladder rather than prior points (their
      // situation changed) or a hard floor (they may be elite). Stale-
      // rank retirees fail the played-last-season test and stay floored.
      players.forEach(player => {
        if (player.team || player.avg_points === 0) return;
        const rank = player.search_rank;
        if (!Number.isFinite(rank) || rank <= 0 || rank >= RANK_SENTINEL) return;
        const byDistance = ladder
          .map(step => ({ ...step, dist: Math.abs(step.rank - rank) }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 4)
          .map(step => step.price)
          .sort((a, b) => a - b);
        if (byDistance.length === 0) return;
        const mid = byDistance.length / 2;
        let price = byDistance.length % 2
          ? byDistance[Math.floor(mid)]
          : (byDistance[mid - 1] + byDistance[mid]) / 2;
        const topPrices = [...ladder].map(l => l.price).sort((a, b) => b - a);
        const cap = topPrices[Math.min(2, topPrices.length - 1)];
        price = Math.min(price, cap);
        const roundedVet = Math.max(MIN_PRICE, Math.round(price * 10) / 10);
        if (roundedVet > MIN_PRICE) prices[player.player_id] = roundedVet;
      });
    }
  });

  // Global rescale (Chris, 2026-07-24): maxPrice is the price of THE
  // most expensive player in the game, full stop. Position multipliers
  // + the curve set everyone's RELATIVE price; here the whole market is
  // scaled linearly (floor fixed) so the global top lands exactly on
  // maxPrice. Before this, multipliers pushed above maxPrice (TE ceiling
  // was 4.5 + 10.5*1.3 = 18.15 with max "15"), which read as a bug.
  const globalMax = Math.max(...Object.values(prices));
  if (globalMax > MIN_PRICE) {
    const scale = (MAX_PRICE - MIN_PRICE) / (globalMax - MIN_PRICE);
    for (const id of Object.keys(prices)) {
      const scaled = MIN_PRICE + (prices[id] - MIN_PRICE) * scale;
      prices[id] = Math.max(MIN_PRICE, Math.round(scaled * 10) / 10);
    }
  }

  return { prices, previousSeason, currentSeason, rookiesPricedByRank };
}

// POST /api/players/preview-initial-prices - Run pricing algorithm and return suggested prices without saving
router.post('/preview-initial-prices', requireAdmin, async (req, res) => {
  try {
    const { prices, previousSeason, currentSeason, rookiesPricedByRank } = await runPricingAlgorithm(pool, req.body);

    res.json({
      success: true,
      previousSeason,
      currentSeason,
      count: Object.keys(prices).length,
      rookiesPricedByRank,
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

    const { prices, previousSeason, currentSeason, rookiesPricedByRank } = await runPricingAlgorithm(client, req.body);

    // UPSERT into player_current_prices
    let updated = 0;
    for (const [playerId, price] of Object.entries(prices)) {
      await client.query(
        `INSERT INTO player_current_prices (player_id, current_price, algorithm_price, season, last_updated)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (player_id) DO UPDATE SET
           current_price = $2, algorithm_price = $3, season = $4, last_updated = CURRENT_TIMESTAMP`,
        [playerId, price, price, currentSeason]
      );
      updated++;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Set initial prices for ${updated} players based on ${previousSeason} season totals`,
      playersUpdated: updated,
      rookiesPricedByRank,
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
    // 'Setup' predates nothing-played too; parseInt('Setup') is NaN and
    // used to 500 the whole endpoint during Setup (found in 2025 testing).
    const nonPlayingWeeks = ['Preseason', 'Setup'];
    let currentWeek = nonPlayingWeeks.includes(currentWeekSetting)
      ? 0
      : parseInt(currentWeekSetting) || 0;

    // Past (rolled) seasons live in the archive tables; the *_all views
    // union live + archive. For a completed season every week is "past".
    const requestedSeason = season;
    const activeSeason = await getCurrentSeason(pool);
    const isPastSeason = requestedSeason < activeSeason;
    if (isPastSeason) currentWeek = 18;
    const scoresSource = isPastSeason ? 'player_scores_all' : 'player_scores';
    const statsSource = isPastSeason ? 'player_stats_all' : 'player_stats';

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
       FROM ${scoresSource} ps
       JOIN players p ON ps.player_id = p.player_id
       JOIN ${statsSource} pst ON ps.player_id = pst.player_id
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

// POST /api/players/reprice - In-season weekly reprice (admin or cron)
//
// Banded rank drift (design agreed 2026-07-24):
// - Players who PLAYED in the priced week get a bounded move toward their
//   form rank: delta = (price_rank - form_rank) / pool, shrunk by
//   games/(games+2) so early-season noise moves less. Bands: >=20% of the
//   pool -> ±0.3, 10-20% -> ±0.2, 6-10% -> ±0.1, inside 6% -> no change.
// - Players who did NOT play while their team had a fixture decay a flat
//   -0.1 regardless of form (injury/benching discount that can't compound
//   into a collapse, and a hot week can't keep rising from the bench).
// - Team on bye -> untouched. Clamped to [minPrice, maxPrice], 0.1 steps.
// "Played" = any non-zero stat that week (Sleeper emits all-zero rows for
// rostered inactives), except DEF where a stats row itself means the unit
// played (a shutout can be legitimately all-zero).
router.post('/reprice', requireAdminOrCron, async (req, res) => {
  const client = await pool.connect();

  try {
    const dryRun = !!req.body.dryRun;
    const season = req.body.season ? parseInt(req.body.season) : await getCurrentSeason(pool);

    // Default to the most recently completed week (reprice runs after the
    // week advances, so current_week - 1).
    let week = req.body.week !== undefined ? parseInt(req.body.week) : null;
    if (week === null) {
      const wk = await client.query(
        `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
      );
      const cur = parseInt(wk.rows[0]?.setting_value);
      if (isNaN(cur) || cur < 2) {
        return res.status(400).json({
          success: false,
          error: 'No completed week to reprice yet — pass an explicit week, or advance past week 1 first'
        });
      }
      week = cur - 1;
    }
    if (isNaN(week) || week < 1 || week > 18) {
      return res.status(400).json({ success: false, error: 'week must be 1-18' });
    }

    const MIN_PRICE = DEFAULT_ALGORITHM_PARAMS.minPrice;
    const MAX_PRICE = DEFAULT_ALGORITHM_PARAMS.maxPrice;
    const DEAD_ZONE = 0.06;
    const DECAY = -0.1;
    // DEF/K have 32-ish player pools and flat price curves, so pool-fraction
    // bands over-move them (wk1-2 2025 sim: 46% of DEF moves hit ±0.3 and one
    // spike week powered multi-week climbs — a value farm). Cap their weekly
    // step so value accrues no faster than any cheap flier elsewhere.
    const STEP_CAPS = { DEF: 0.1, K: 0.1 };

    // Priced players
    const playersResult = await client.query(
      `SELECT pl.player_id, pl.name, pl.position, pl.team, pcp.current_price::float AS price
       FROM players pl
       JOIN player_current_prices pcp ON pcp.player_id = pl.player_id AND pcp.season = $1
       WHERE pl.position IN ('QB','RB','WR','TE','K','DEF')`,
      [season]
    );

    // Season-to-date form for weeks <= priced week. "Played" filters out
    // Sleeper's all-zero rows for rostered inactives.
    const playedCondition = `(pl.position = 'DEF' OR
        st.passing_yards <> 0 OR st.passing_tds <> 0 OR st.interceptions <> 0 OR st.completions <> 0 OR st.attempts <> 0 OR
        st.rushing_yards <> 0 OR st.rushing_tds <> 0 OR st.rushing_attempts <> 0 OR
        st.receptions <> 0 OR st.receiving_yards <> 0 OR st.receiving_tds <> 0 OR st.targets <> 0 OR
        st.fumbles_lost <> 0 OR st.two_point_conversions <> 0 OR
        st.fg_0_19 <> 0 OR st.fg_20_29 <> 0 OR st.fg_30_39 <> 0 OR st.fg_40_49 <> 0 OR st.fg_50p <> 0 OR
        st.xp_made <> 0 OR st.xp_missed <> 0 OR st.fga <> 0 OR st.def_td <> 0)`;
    const formResult = await client.query(
      `SELECT st.player_id, COUNT(*)::int AS games,
              COALESCE(SUM(sc.total_points), 0)::float AS pts,
              BOOL_OR(st.week = $2) AS played_this_week
       FROM player_stats st
       JOIN players pl ON pl.player_id = st.player_id
       JOIN player_scores sc ON sc.player_id = st.player_id
         AND sc.week = st.week AND sc.season = st.season AND sc.league_format = 'ppr'
       WHERE st.season = $1 AND st.week <= $2 AND ${playedCondition}
       GROUP BY st.player_id`,
      [season, week]
    );
    const form = new Map(formResult.rows.map(r => [r.player_id, r]));

    // Teams with a fixture in the priced week (everyone else is on bye)
    const fixturesResult = await client.query(
      `SELECT home_team, away_team FROM nfl_fixtures WHERE season = $1 AND week = $2`,
      [season, week]
    );
    const teamsPlaying = new Set();
    for (const f of fixturesResult.rows) { teamsPlaying.add(f.home_team); teamsPlaying.add(f.away_team); }

    // Rank pools per position: players with >=1 played game this season
    const byPos = {};
    for (const p of playersResult.rows) {
      if (form.has(p.player_id)) (byPos[p.position] = byPos[p.position] || []).push(p);
    }
    const priceRank = new Map();
    const formRank = new Map();
    const poolSize = new Map();
    for (const pos of Object.keys(byPos)) {
      const arr = byPos[pos];
      const byPrice = [...arr].sort((a, b) => b.price - a.price ||
        (form.get(b.player_id).pts / form.get(b.player_id).games) - (form.get(a.player_id).pts / form.get(a.player_id).games));
      const byForm = [...arr].sort((a, b) =>
        (form.get(b.player_id).pts / form.get(b.player_id).games) - (form.get(a.player_id).pts / form.get(a.player_id).games));
      byPrice.forEach((x, i) => priceRank.set(x.player_id, i + 1));
      byForm.forEach((x, i) => formRank.set(x.player_id, i + 1));
      arr.forEach(x => poolSize.set(x.player_id, arr.length));
    }

    const moves = [];
    const summary = { pool: playersResult.rows.length, played: 0, rankMoves: 0, decayed: 0, byes: 0, unchanged: 0 };
    for (const p of playersResult.rows) {
      const f = form.get(p.player_id);
      let step = 0;
      let reason = 'weekly_reprice';
      if (f && f.played_this_week) {
        summary.played++;
        const d = ((priceRank.get(p.player_id) - formRank.get(p.player_id)) / poolSize.get(p.player_id))
          * (f.games / (f.games + 2));
        if (d >= 0.20) step = 0.3; else if (d >= 0.10) step = 0.2; else if (d >= DEAD_ZONE) step = 0.1;
        else if (d <= -0.20) step = -0.3; else if (d <= -0.10) step = -0.2; else if (d <= -DEAD_ZONE) step = -0.1;
        const cap = STEP_CAPS[p.position] || 0.3;
        step = Math.max(-cap, Math.min(cap, step));
      } else if (!teamsPlaying.has(p.team)) {
        summary.byes++;
      } else {
        step = DECAY;
        reason = 'inactivity_decay';
      }
      const newPrice = Math.min(MAX_PRICE, Math.max(MIN_PRICE, Math.round((p.price + step) * 10) / 10));
      if (newPrice !== p.price) {
        moves.push({ ...p, newPrice, change: Math.round((newPrice - p.price) * 10) / 10, reason });
        if (reason === 'inactivity_decay') summary.decayed++; else summary.rankMoves++;
      } else {
        summary.unchanged++;
      }
    }

    if (!dryRun) {
      const dayResult = await client.query(
        `SELECT setting_value FROM app_settings WHERE setting_key = 'current_day'`
      );
      const day = parseInt(dayResult.rows[0]?.setting_value) || 1;

      await client.query('BEGIN');
      for (const m of moves) {
        await client.query(
          `UPDATE player_current_prices
           SET current_price = $1, last_updated = CURRENT_TIMESTAMP
           WHERE player_id = $2 AND season = $3`,
          [m.newPrice, m.player_id, season]
        );
        await client.query(
          `INSERT INTO player_price_history (player_id, price, price_change, change_reason, week, day, season)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [m.player_id, m.newPrice, m.change, m.reason, week, day, season]
        );
      }
      await client.query('COMMIT');
    }

    const risers = moves.filter(m => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 15);
    const fallers = moves.filter(m => m.change < 0 && m.reason === 'weekly_reprice')
      .sort((a, b) => a.change - b.change).slice(0, 15);

    res.json({
      success: true,
      dryRun,
      season,
      week,
      summary: { ...summary, totalMoves: moves.length },
      risers: risers.map(m => `${m.position} ${m.name}: $${m.price} → $${m.newPrice}`),
      fallers: fallers.map(m => `${m.position} ${m.name}: $${m.price} → $${m.newPrice}`)
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) { /* no txn open */ }
    console.error('Error running reprice:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
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
