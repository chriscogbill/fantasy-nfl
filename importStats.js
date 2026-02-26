// ============================================
// STEP 1: Install dependencies first
// Run these commands in your terminal:
// npm init -y
// npm install pg node-fetch
// ============================================

const pool = require('./src/db/connection');
const { getCurrentSeason } = require('./src/helpers/settings');

// ============================================
// Sleeper Provider (simplified version)
// ============================================

class SleeperProvider {
  constructor() {
    this.baseUrl = 'https://api.sleeper.app/v1';
  }

  async getAllPlayers() {
    const response = await fetch(`${this.baseUrl}/players/nfl`);
    const data = await response.json();
    
    // Convert object to array
    return Object.entries(data).map(([id, player]) => ({
      sleeper_id: id,
      name: `${player.first_name || ''} ${player.last_name || ''}`.trim(),
      position: player.position,
      team: player.team,
      status: player.status || 'active',
      search_rank: player.search_rank || null,
    }));
  }

  async getWeekStats(week, season) {
    const response = await fetch(
      `${this.baseUrl}/stats/nfl/regular/${season}/${week}`
    );
    return await response.json();
  }
}

// ============================================
// Database Functions
// ============================================

async function insertPlayer(player) {
  const query = `
    INSERT INTO players (name, position, team, status)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
    RETURNING player_id
  `;
  
  const values = [
    player.name,
    player.position,
    player.team,
    player.status
  ];
  
  try {
    const result = await pool.query(query, values);
    return result.rows[0]?.player_id;
  } catch (error) {
    console.error('Error inserting player:', error.message);
    return null;
  }
}

// Add Sleeper ID column to players table for faster lookups
async function addSleeperIdColumn() {
  try {
    await pool.query(`
      ALTER TABLE players 
      ADD COLUMN IF NOT EXISTS sleeper_id VARCHAR(50) UNIQUE
    `);
    console.log('✓ Added sleeper_id column to players table');
  } catch (error) {
    console.log('sleeper_id column already exists or error:', error.message);
  }
}

async function updatePlayerSleeperIds() {
  console.log('Updating Sleeper IDs for players...');
  const provider = new SleeperProvider();
  const allPlayers = await provider.getAllPlayers();
  
  let updated = 0;
  for (const player of allPlayers) {
    if (player.sleeper_id && player.name) {
      try {
        const result = await pool.query(
          `UPDATE players SET sleeper_id = $1 
           WHERE LOWER(name) = LOWER($2) AND sleeper_id IS NULL`,
          [player.sleeper_id, player.name]
        );
        if (result.rowCount > 0) updated++;
      } catch (error) {
        // Skip duplicates
      }
    }
  }
  
  console.log(`✓ Updated ${updated} players with Sleeper IDs`);
}

async function insertPlayerStats(playerId, sleeperPlayerId, stats, week, season, playerTeam = null) {
  const query = `
    INSERT INTO player_stats (
      player_id, week, season, opponent, team,
      passing_yards, passing_tds, interceptions, completions, attempts,
      rushing_yards, rushing_tds, rushing_attempts,
      receptions, receiving_yards, receiving_tds, targets,
      fumbles_lost, two_point_conversions,
      fg_0_19, fg_20_29, fg_30_39, fg_40_49, fg_50p, fga,
      xp_made, xp_missed,
      def_td, points_allowed
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
    ON CONFLICT (player_id, week, season) DO UPDATE SET
      passing_yards = EXCLUDED.passing_yards,
      passing_tds = EXCLUDED.passing_tds,
      interceptions = EXCLUDED.interceptions,
      completions = EXCLUDED.completions,
      attempts = EXCLUDED.attempts,
      rushing_yards = EXCLUDED.rushing_yards,
      rushing_tds = EXCLUDED.rushing_tds,
      rushing_attempts = EXCLUDED.rushing_attempts,
      receptions = EXCLUDED.receptions,
      receiving_yards = EXCLUDED.receiving_yards,
      receiving_tds = EXCLUDED.receiving_tds,
      targets = EXCLUDED.targets,
      fumbles_lost = EXCLUDED.fumbles_lost,
      two_point_conversions = EXCLUDED.two_point_conversions,
      fg_0_19 = EXCLUDED.fg_0_19,
      fg_20_29 = EXCLUDED.fg_20_29,
      fg_30_39 = EXCLUDED.fg_30_39,
      fg_40_49 = EXCLUDED.fg_40_49,
      fg_50p = EXCLUDED.fg_50p,
      fga = EXCLUDED.fga,
      xp_made = EXCLUDED.xp_made,
      xp_missed = EXCLUDED.xp_missed,
      def_td = EXCLUDED.def_td,
      points_allowed = EXCLUDED.points_allowed,
      team = COALESCE(EXCLUDED.team, player_stats.team)
  `;

  const values = [
    playerId,
    week,
    season,
    stats.opponent || null,
    playerTeam,  // Team at time of this game
    stats.pass_yd || 0,
    stats.pass_td || 0,
    stats.pass_int || 0,
    stats.pass_cmp || 0,
    stats.pass_att || 0,
    stats.rush_yd || 0,
    stats.rush_td || 0,
    stats.rush_att || 0,
    stats.rec || 0,
    stats.rec_yd || 0,
    stats.rec_td || 0,
    stats.rec_tgt || 0,
    stats.fum_lost || 0,
    (stats.pass_2pt || 0) + (stats.rush_2pt || 0) + (stats.rec_2pt || 0),
    stats.fgm_0_19 || 0,
    stats.fgm_20_29 || 0,
    stats.fgm_30_39 || 0,
    stats.fgm_40_49 || 0,
    stats.fgm_50p || 0,
    stats.fga || 0,
    stats.xpm || 0,
    stats.xpa ? (stats.xpa - (stats.xpm || 0)) : 0,  // Calculate misses from attempts - makes
    stats.def_td || 0,
    stats.pts_allow || 0
  ];

  try {
    await pool.query(query, values);
    return true;
  } catch (error) {
    console.error(`Error inserting stats for player ${playerId}:`, error.message);
    return false;
  }
}

// ============================================
// Main Import Functions
// ============================================

async function importPlayers() {
  console.log('Starting player import...');
  const provider = new SleeperProvider();
  
  // Ensure sleeper_id column exists
  await addSleeperIdColumn();
  
  const players = await provider.getAllPlayers();
  console.log(`Found ${players.length} players from Sleeper API`);
  
  let imported = 0;
  for (const player of players) {
    if (player.position && player.name) {
      // Insert with sleeper_id
      try {
        await pool.query(
          `INSERT INTO players (name, position, team, status, sleeper_id, search_rank)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (sleeper_id) DO UPDATE
           SET name = EXCLUDED.name,
               position = EXCLUDED.position,
               team = EXCLUDED.team,
               status = EXCLUDED.status,
               search_rank = EXCLUDED.search_rank`,
          [player.name, player.position, player.team, player.status, player.sleeper_id, player.search_rank]
        );
        imported++;
      } catch (error) {
        // Skip duplicates
      }
    }
  }
  
  console.log(`✓ Imported/updated ${imported} players to database`);
}

async function importWeekStats(week, season) {
  console.log(`Starting stats import for Week ${week}, ${season}...`);
  const provider = new SleeperProvider();

  // Get all stats for the week
  const weekStats = await provider.getWeekStats(week, season);
  const sleeperPlayerIds = Object.keys(weekStats);
  console.log(`Found stats for ${sleeperPlayerIds.length} players`);

  // Get all players from Sleeper API to get their current team
  const allPlayers = await provider.getAllPlayers();
  const playerTeamMap = new Map(
    allPlayers.map(p => [p.sleeper_id, p.team])
  );

  // Get player mapping from database using sleeper_id
  const playerMapQuery = 'SELECT player_id, sleeper_id FROM players WHERE sleeper_id IS NOT NULL';
  const playerMapResult = await pool.query(playerMapQuery);
  const playersBySleeperID = new Map(
    playerMapResult.rows.map(p => [p.sleeper_id, p.player_id])
  );

  let imported = 0;
  let skipped = 0;

  for (const sleeperPlayerId of sleeperPlayerIds) {
    const stats = weekStats[sleeperPlayerId];
    const dbPlayerId = playersBySleeperID.get(sleeperPlayerId);
    const playerTeam = playerTeamMap.get(sleeperPlayerId) || null;

    if (dbPlayerId) {
      const success = await insertPlayerStats(dbPlayerId, sleeperPlayerId, stats, week, season, playerTeam);
      if (success) imported++;
    } else {
      skipped++;
    }
  }

  console.log(`✓ Imported stats for ${imported} players (${skipped} skipped - no matching player)`);
}

async function importMultipleWeeks(startWeek, endWeek, season) {
  console.log(`\nImporting weeks ${startWeek} to ${endWeek} for ${season} season...\n`);
  
  for (let week = startWeek; week <= endWeek; week++) {
    await importWeekStats(week, season);
  }
  
  console.log(`\n✓ All weeks imported successfully!`);
}

// ============================================
// Easy-to-use wrapper functions
// ============================================

async function setup() {
  console.log('Testing database connection...');
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✓ Database connected successfully!');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    console.error('\nMake sure:');
    console.error('1. Postgres.app is running');
    console.error('2. Your database name is correct');
    console.error('3. Your username is correct');
    return false;
  }
}

async function importAll(week = 1, season = null, skipPlayers = false) {
  const connected = await setup();
  if (!connected) return;

  if (!season) {
    season = await getCurrentSeason(pool);
  }
  console.log(`Using season: ${season}`);

  console.log('\n=== Starting Import ===\n');
  
  // Step 1: Import players (optional - skip if already done)
  if (!skipPlayers) {
    await importPlayers();
  } else {
    console.log('Skipping player import (use skipPlayers=false to re-import players)');
  }
  
  // Step 2: Import stats for specified week
  await importWeekStats(week, season);
  
  console.log('\n=== Import Complete! ===\n');
  
  // Close database connection
  await pool.end();
}

async function importWeekRange(startWeek, endWeek, season = null) {
  const connected = await setup();
  if (!connected) return;

  if (!season) {
    season = await getCurrentSeason(pool);
  }
  console.log(`Using season: ${season}`);

  console.log('\n=== Starting Batch Import ===\n');
  
  await importMultipleWeeks(startWeek, endWeek, season);
  
  console.log('\n=== Batch Import Complete! ===\n');
  
  // Close database connection
  await pool.end();
}

// ============================================
// Run it!
// ============================================

// Option 1: Import a single week
// importAll(1, null, true)  // Skip player import, just get stats (uses current_season from DB)

// Option 2: Import multiple weeks at once (RECOMMENDED)
importWeekRange(2, 11)  // Import remaining weeks (uses current_season from DB)
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });

// ============================================
// USAGE INSTRUCTIONS:
// ============================================
// 1. Save this file as "importStats.js"
// 2. Update the database config at the top (username: chriscogbill)
// 3. Run: npm install pg node-fetch
// 4. Run: node importStats.js
// 
// To import a range of weeks (season auto-detected from DB):
// importWeekRange(1, 11)         // Imports weeks 1-11
// importWeekRange(12, 18)        // Imports weeks 12-18
// importWeekRange(1, 11, 2025)   // Explicit season override
//
// To import a single week:
// importAll(5, null, true)       // Week 5, skip players
// ============================================