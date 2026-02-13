// ============================================
// Player Pricing Calculator
// Calculates initial prices based on performance
// ============================================

const pool = require('./src/db/connection');

// Position pricing multipliers to balance different positions
const POSITION_MULTIPLIERS = {
  'QB': 0.9,    // QBs score high but only need 2
  'RB': 1.2,    // High scarcity, huge variance
  'WR': 1.1,    // High scarcity, good variance
  'TE': 1.3,    // Very scarce premium TEs
  'K': 0.7,     // Very flat distribution, low scarcity
  'DEF': 0.8   // Relatively flat distribution
};

const { getCurrentSeason } = require('./src/helpers/settings');

const BASE_PRICE = 4.5;  // Minimum price for any player

// Season can be overridden via CLI: node calculatePrices.js --season 2025
const cliSeason = process.argv.find(arg => arg.startsWith('--season='))?.split('=')[1]
  || (process.argv.indexOf('--season') !== -1 ? process.argv[process.argv.indexOf('--season') + 1] : null);
let SEASON = cliSeason ? parseInt(cliSeason) : null; // null means use getCurrentSeason()

async function calculateAveragePoints(playerId, startWeek, endWeek) {
  const query = `
    SELECT AVG(total_points) as avg_points, COUNT(*) as games_played
    FROM player_scores
    WHERE player_id = $1 
      AND season = $2 
      AND week BETWEEN $3 AND $4
      AND league_format = 'ppr'
      AND total_points > 0
  `;
  
  const result = await pool.query(query, [playerId, SEASON, startWeek, endWeek]);
  return {
    avgPoints: parseFloat(result.rows[0].avg_points) || 0,
    gamesPlayed: parseInt(result.rows[0].games_played) || 0
  };
}

async function getPositionPercentile(avgPoints, position, allPlayerData) {
  // Get all players at this position sorted by average points
  const positionPlayers = allPlayerData
    .filter(p => p.position === position && p.avgPoints > 0)
    .sort((a, b) => b.avgPoints - a.avgPoints);
  
  if (positionPlayers.length === 0) return 0;
  
  // Find percentile rank (0-100)
  const rank = positionPlayers.findIndex(p => p.avgPoints <= avgPoints);
  const percentile = (rank / positionPlayers.length) * 100;
  
  return percentile;
}

function calculatePrice(avgPoints, position, percentile, gamesPlayed) {
  // Require at least 3 games played to get meaningful price
  if (gamesPlayed < 3) {
    return BASE_PRICE;
  }
  
  // Apply position multiplier
  const multiplier = POSITION_MULTIPLIERS[position] || 1.0;
  const adjustedPoints = avgPoints * multiplier;
  
  // Pure linear pricing starting from 0
  let price = adjustedPoints * 0.60;
  
  // Apply minimum price floor
  price = Math.max(price, BASE_PRICE);
  
  // Round to 1 decimal place
  return Math.round(price * 10) / 10;
}

async function calculateAllPrices(startWeek = 1, endWeek = 11) {
  console.log(`\nCalculating prices based on weeks ${startWeek}-${endWeek}...\n`);
  
  // Get all players with stats
  const playersQuery = `
    SELECT DISTINCT p.player_id, p.name, p.position
    FROM players p
    JOIN player_scores ps ON p.player_id = ps.player_id
    WHERE ps.season = $1 
      AND ps.week BETWEEN $2 AND $3
      AND p.position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
    ORDER BY p.position, p.name
  `;
  
  const playersResult = await pool.query(playersQuery, [SEASON, startWeek, endWeek]);
  console.log(`Found ${playersResult.rows.length} players with stats\n`);
  
  // First pass: calculate average points for all players
  const allPlayerData = [];
  for (const player of playersResult.rows) {
    const stats = await calculateAveragePoints(player.player_id, startWeek, endWeek);
    allPlayerData.push({
      ...player,
      avgPoints: stats.avgPoints,
      gamesPlayed: stats.gamesPlayed
    });
  }
  
  // Second pass: calculate prices with position percentiles
  const prices = [];
  for (const playerData of allPlayerData) {
    const percentile = await getPositionPercentile(
      playerData.avgPoints, 
      playerData.position, 
      allPlayerData
    );
    
    const price = calculatePrice(
      playerData.avgPoints,
      playerData.position,
      percentile,
      playerData.gamesPlayed
    );
    
    prices.push({
      player_id: playerData.player_id,
      name: playerData.name,
      position: playerData.position,
      avgPoints: playerData.avgPoints,
      gamesPlayed: playerData.gamesPlayed,
      price: price
    });
  }
  
  return prices;
}

async function savePricesToDatabase(prices) {
  console.log('\nSaving prices to database...\n');
  
  let inserted = 0;
  for (const p of prices) {
    try {
      // Insert into player_current_prices
      await pool.query(
        `INSERT INTO player_current_prices 
         (player_id, current_price, algorithm_price, manual_override, season)
         VALUES ($1, $2, $2, false, $3)
         ON CONFLICT (player_id) DO UPDATE 
         SET current_price = EXCLUDED.current_price,
             algorithm_price = EXCLUDED.algorithm_price,
             last_updated = CURRENT_TIMESTAMP`,
        [p.player_id, p.price, SEASON]
      );
      
      // Insert into price history
      await pool.query(
        `INSERT INTO player_price_history 
         (player_id, price, change_reason, week, season)
         VALUES ($1, $2, 'initial', $3, $4)`,
        [p.player_id, p.price, 11, SEASON]  // Use week 11 as baseline
      );
      
      inserted++;
    } catch (error) {
      console.error(`Error saving price for ${p.name}:`, error.message);
    }
  }
  
  console.log(`✓ Saved prices for ${inserted} players`);
}

async function showTopPlayersByPosition(prices) {
  console.log('\n=== Top 5 Players by Position ===\n');
  
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  
  for (const pos of positions) {
    const topPlayers = prices
      .filter(p => p.position === pos)
      .sort((a, b) => b.price - a.price)
      .slice(0, 5);
    
    console.log(`${pos}:`);
    topPlayers.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name.padEnd(25)} $${p.price}m (${p.avgPoints.toFixed(1)} pts/game)`);
    });
    console.log('');
  }
}

async function run() {
  try {
    // Resolve season if not set via CLI
    if (!SEASON) {
      SEASON = await getCurrentSeason(pool);
    }
    console.log(`=== Player Pricing Calculator (Season ${SEASON}) ===`);
    
    const prices = await calculateAllPrices(1, 11);
    
    // Show sample of top players
    await showTopPlayersByPosition(prices);
    
    // Save to database
    await savePricesToDatabase(prices);
    
    // Summary stats
    const avgPrice = prices.reduce((sum, p) => sum + p.price, 0) / prices.length;
    const maxPrice = Math.max(...prices.map(p => p.price));
    const minPrice = Math.min(...prices.map(p => p.price));
    
    console.log('\n=== Pricing Summary ===');
    console.log(`Total players priced: ${prices.length}`);
    console.log(`Average price: $${avgPrice.toFixed(1)}m`);
    console.log(`Price range: $${minPrice.toFixed(1)}m - $${maxPrice.toFixed(1)}m`);
    console.log(`\nBudget per team: $100.0m for 15 players (~$6.7m avg)\n`);
    
    console.log('✓ Pricing complete!\n');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Run the pricing calculator
run();