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
      depth_chart_order: player.depth_chart_order ?? null,
      age: player.age ?? null,
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
  
  // Only the positions the game can roster — Sleeper's dump includes
  // every position (LB, CB, OL, P…), which bloated the pool to ~11.8k
  // rows, 65% of them unusable (cleaned from prod 2026-07-24).
  const VALID_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

  // Existing rows always refresh, but NEW players must be on a current NFL
  // depth chart (except DEF pseudo-players). Sleeper's dump carries thousands
  // of retirees — some with stale teams (Le'Veon Bell: TB) and popularity-
  // driven search_ranks (Witten: 378), so team/rank can't gate relevance;
  // depth_chart_order can. Keeps pruned retirees from being re-added.
  const existingResult = await pool.query(
    `SELECT sleeper_id FROM players WHERE sleeper_id IS NOT NULL`
  );
  const existingIds = new Set(existingResult.rows.map((r) => r.sleeper_id));

  let imported = 0;
  for (const player of players) {
    if (
      !existingIds.has(player.sleeper_id) &&
      player.position !== 'DEF' &&
      player.depth_chart_order == null
    ) {
      continue;
    }
    if (player.position && player.name && VALID_POSITIONS.has(player.position)) {
      // Insert with sleeper_id
      try {
        await pool.query(
          `INSERT INTO players (name, position, team, status, sleeper_id, search_rank, age)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (sleeper_id) DO UPDATE
           SET name = EXCLUDED.name,
               position = EXCLUDED.position,
               team = EXCLUDED.team,
               status = EXCLUDED.status,
               search_rank = EXCLUDED.search_rank,
               age = EXCLUDED.age`,
          [player.name, player.position, player.team, player.status, player.sleeper_id, player.search_rank, player.age]
        );
        imported++;
      } catch (error) {
        // A (name, position) unique collision means an old row exists for
        // this player WITHOUT a sleeper_id — silently swallowing it left
        // Josh Allen an identity orphan for years (no stats ever matched,
        // priced as a no-history player at 2026 launch). Claim the row.
        if (error.code === '23505') {
          const claimed = await pool.query(
            `UPDATE players SET sleeper_id = $1, team = $2, status = $3, search_rank = $4, age = $5
             WHERE player_id = (
               SELECT player_id FROM players
               WHERE name = $6 AND position = $7 AND sleeper_id IS NULL
               ORDER BY player_id LIMIT 1
             )`,
            [player.sleeper_id, player.team, player.status, player.search_rank, player.age, player.name, player.position]
          );
          if (claimed.rowCount > 0) {
            console.log(`  claimed orphan row for ${player.name} (${player.position})`);
            imported++;
          }
        } else {
          console.error(`  insert failed for ${player.name}: ${error.message}`);
        }
      }
    }
  }
  
  console.log(`✓ Imported/updated ${imported} players to database`);

  // Players Sleeper has dropped from its dump (long-retired) never get their
  // row refreshed, so they'd keep a stale team forever and look draftable at
  // floor price (the Adrian Peterson trap, found 2026-07-24). Clear the team
  // so they read as free agents.
  const dumpIds = players.map((p) => p.sleeper_id);
  const stale = await pool.query(
    `UPDATE players SET team = NULL
     WHERE sleeper_id IS NOT NULL AND team IS NOT NULL
       AND NOT (sleeper_id = ANY($1))`,
    [dumpIds]
  );
  if (stale.rowCount > 0) {
    console.log(`✓ Cleared stale team on ${stale.rowCount} players absent from the Sleeper dump`);
  }
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
// CLI entry point
// ============================================
// Usage (season falls back to current_season from the DB):
//   node importStats.js --from 1 --to 18 [--season 2025]  # week range
//   node importStats.js --week 12 [--season 2025]          # single week
//   node importStats.js --players                          # players only
// Previously the range was hardcoded here and edited per run — CLI args
// match the other scripts (calculatePrices, importNflFixtures).

function argValue(flag) {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split('=')[1];
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
}

// Only run the CLI when executed directly — the API requires this module
// (cron tick imports stats in-process) and must not trigger a run or exit.
if (require.main === module) {
  const season = argValue('--season') ? parseInt(argValue('--season')) : null;
  const from = argValue('--from');
  const to = argValue('--to');
  const singleWeek = argValue('--week');

  let run;
  if (process.argv.includes('--players')) {
    run = (async () => {
      const connected = await setup();
      if (!connected) return;
      await importPlayers();
      await pool.end();
    })();
  } else if (singleWeek) {
    run = importAll(parseInt(singleWeek), season, true);
  } else if (from && to) {
    run = importWeekRange(parseInt(from), parseInt(to), season);
  } else {
    console.error('Usage: node importStats.js --from N --to M [--season YYYY] | --week N [--season YYYY] | --players');
    process.exit(1);
  }

  run
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error);
      process.exit(1);
    });
}

module.exports = { importWeekStats, importPlayers, importAll, importWeekRange };
//
// To import a single week:
// importAll(5, null, true)       // Week 5, skip players
// ============================================