// Pre-season hygiene: purge retired/irrelevant players from the pool.
//
// Sleeper's dump keeps thousands of retirees — some with stale teams
// (Le'Veon Bell: TB, last played 2021) and popularity-driven search_ranks
// (Jason Witten: 378) — so neither team nor rank can gate relevance. The
// reliable signal is a current depth-chart entry. A player is DELETED when
// ALL of:
//   1. no rosters or transfers references (any season — history is sacred)
//   2. no stats since 2024 (player_stats live, or player_stats_archive >= 2024)
//   3. not a DEF pseudo-player
//   4. not on any current NFL depth chart (dump depth_chart_order is null)
// Their price rows and season totals are removed too. importPlayers has the
// matching guard (new players need a depth-chart entry), so pruned players
// only return if they land on a depth chart again.
//
//   DATABASE_URL=... node scripts/pruneStalePlayers.js [--dry-run]

const pool = require('../src/db/connection');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const response = await fetch('https://api.sleeper.app/v1/players/nfl');
  const dump = await response.json();
  const onDepthChart = new Set(
    Object.entries(dump)
      .filter(([, p]) => p.depth_chart_order != null)
      .map(([id]) => id)
  );
  console.log(`Sleeper dump: ${Object.keys(dump).length} players, ${onDepthChart.size} on depth charts`);

  const candidates = await pool.query(
    `SELECT p.player_id, p.name, p.position, p.team, p.sleeper_id
     FROM players p
     WHERE p.position <> 'DEF'
       AND NOT EXISTS (SELECT 1 FROM rosters r WHERE r.player_id = p.player_id)
       AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.player_id = p.player_id)
       AND NOT EXISTS (SELECT 1 FROM player_stats st WHERE st.player_id = p.player_id)
       AND NOT EXISTS (SELECT 1 FROM player_stats_archive sa
                       WHERE sa.player_id = p.player_id AND sa.season >= 2024)`
  );
  const drop = candidates.rows.filter(r => !r.sleeper_id || !onDepthChart.has(r.sleeper_id));
  console.log(`Unreferenced, no stats since 2024: ${candidates.rows.length}; of those NOT on a depth chart (deleting): ${drop.length}`);
  console.log('Examples:', drop.slice(0, 10).map(r => `${r.position} ${r.name} (${r.team || 'FA'})`).join(', '));

  if (dryRun) {
    console.log('\nDry run — no changes made.');
    await pool.end();
    return;
  }

  const dropIds = drop.map(r => r.player_id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const prices = await client.query(`DELETE FROM player_current_prices WHERE player_id = ANY($1)`, [dropIds]);
    const history = await client.query(`DELETE FROM player_price_history WHERE player_id = ANY($1)`, [dropIds]);
    const totals = await client.query(`DELETE FROM player_season_totals WHERE player_id = ANY($1)`, [dropIds]);
    const players = await client.query(`DELETE FROM players WHERE player_id = ANY($1)`, [dropIds]);
    console.log(`Deleted ${players.rowCount} players (${prices.rowCount} prices, ${history.rowCount} history rows, ${totals.rowCount} season totals)`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
  console.log('Done.');
}

main().catch((e) => { console.error('Error:', e); process.exit(1); });
