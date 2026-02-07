// ============================================
// Sample Data Generator for Fantasy NFL
// Creates test leagues, teams, and rosters
// ============================================

const { Pool } = require('pg');

const pool = new Pool({
  user: 'chriscogbill',
  host: 'localhost',
  database: 'fantasyNFL',
  password: '',
  port: 5432,
});

const SEASON = 2024;
const START_WEEK = 1;

// Sample team names
const TEAM_NAMES = [
  'GridIron Giants',
  'End Zone Eagles',
  'Touchdown Titans',
  'Blitz Brigade',
  'Field Goal Fanatics',
  'Red Zone Raiders',
  'Hail Mary Heroes',
  'Overtime Outlaws'
];

// Sample user emails
const USER_EMAILS = [
  'alice@example.com',
  'bob@example.com',
  'charlie@example.com',
  'diana@example.com',
  'evan@example.com',
  'fiona@example.com',
  'george@example.com',
  'hannah@example.com'
];

async function createLeagues() {
  console.log('\n=== Creating Sample Leagues ===\n');
  
  const leagues = [
    { name: 'Premier League', max_teams: 8 },
    { name: 'Championship League', max_teams: 12 },
    { name: 'Casual Friends League', max_teams: 6 }
  ];
  
  const leagueIds = [];
  
  for (const league of leagues) {
    const result = await pool.query(
      `INSERT INTO leagues (league_name, season, max_teams, status, start_week, end_week)
       VALUES ($1, $2, $3, 'active', $4, 18)
       RETURNING league_id`,
      [league.name, SEASON, league.max_teams, START_WEEK]
    );
    
    leagueIds.push(result.rows[0].league_id);
    console.log(`✓ Created league: ${league.name} (ID: ${result.rows[0].league_id})`);
  }
  
  return leagueIds;
}

async function createTeams() {
  console.log('\n=== Creating Sample Teams ===\n');
  
  const teamIds = [];
  
  for (let i = 0; i < TEAM_NAMES.length; i++) {
    const result = await pool.query(
      `INSERT INTO teams (team_name, user_email, season, current_spent, remaining_budget)
       VALUES ($1, $2, $3, 0, 100.0)
       RETURNING team_id`,
      [TEAM_NAMES[i], USER_EMAILS[i], SEASON]
    );
    
    teamIds.push(result.rows[0].team_id);
    console.log(`✓ Created team: ${TEAM_NAMES[i]} (${USER_EMAILS[i]})`);
  }
  
  return teamIds;
}

async function assignTeamsToLeagues(leagueIds, teamIds) {
  console.log('\n=== Assigning Teams to Leagues ===\n');
  
  // League 1: First 8 teams
  for (let i = 0; i < 8; i++) {
    await pool.query(
      `INSERT INTO league_entries (league_id, team_id) VALUES ($1, $2)`,
      [leagueIds[0], teamIds[i]]
    );
  }
  console.log(`✓ Added 8 teams to Premier League`);
  
  // League 2: All 8 teams (overlapping with League 1)
  for (let i = 0; i < 8; i++) {
    await pool.query(
      `INSERT INTO league_entries (league_id, team_id) VALUES ($1, $2)`,
      [leagueIds[1], teamIds[i]]
    );
  }
  console.log(`✓ Added 8 teams to Championship League`);
  
  // League 3: First 6 teams (casual league)
  for (let i = 0; i < 6; i++) {
    await pool.query(
      `INSERT INTO league_entries (league_id, team_id) VALUES ($1, $2)`,
      [leagueIds[2], teamIds[i]]
    );
  }
  console.log(`✓ Added 6 teams to Casual Friends League`);
}

async function getTopPlayersByPosition(position, limit) {
  const result = await pool.query(
    `SELECT p.player_id, p.name, pcp.current_price, p.position
     FROM players p
     JOIN player_current_prices pcp ON p.player_id = pcp.player_id
     WHERE p.position = $1 AND pcp.current_price > 0
     ORDER BY pcp.current_price DESC
     LIMIT $2`,
    [position, limit]
  );
  
  return result.rows;
}

async function buildRosterForTeam(teamId, teamName) {
  console.log(`\n  Building roster for ${teamName}...`);
  
  // Get top players by position
  const qbs = await getTopPlayersByPosition('QB', 10);
  const rbs = await getTopPlayersByPosition('RB', 20);
  const wrs = await getTopPlayersByPosition('WR', 20);
  const tes = await getTopPlayersByPosition('TE', 10);
  const ks = await getTopPlayersByPosition('K', 5);
  const defs = await getTopPlayersByPosition('DEF', 5);
  
  // Randomize selection to create variety
  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
  
  // Build roster within budget
  const roster = [];
  const usedPlayerIds = new Set();
  let totalSpent = 0;
  const budget = 100.0;
  
  // Helper to add player if not already in roster
  const addPlayer = (player) => {
    if (!usedPlayerIds.has(player.player_id)) {
      roster.push(player);
      usedPlayerIds.add(player.player_id);
      return true;
    }
    return false;
  };
  
  // Pick players (mix of expensive and cheap)
  // 2 QBs
  for (const qb of shuffle(qbs).slice(0, 4)) {
    if (addPlayer(qb) && roster.filter(p => p.position === 'QB').length >= 2) break;
  }
  
  // 4 RBs (mix of tiers)
  addPlayer(shuffle(rbs)[0]); // Top RB
  for (const rb of shuffle(rbs.slice(3, 20))) {
    if (addPlayer(rb) && roster.filter(p => p.position === 'RB').length >= 4) break;
  }
  
  // 4 WRs (mix of tiers)
  addPlayer(shuffle(wrs)[0]); // Top WR
  for (const wr of shuffle(wrs.slice(3, 20))) {
    if (addPlayer(wr) && roster.filter(p => p.position === 'WR').length >= 4) break;
  }
  
  // 2 TEs
  for (const te of shuffle(tes).slice(0, 5)) {
    if (addPlayer(te) && roster.filter(p => p.position === 'TE').length >= 2) break;
  }
  
  // 1 K
  for (const k of shuffle(ks)) {
    if (addPlayer(k)) break;
  }
  
  // 2 DEF
  for (const def of shuffle(defs).slice(0, 4)) {
    if (addPlayer(def) && roster.filter(p => p.position === 'DEF').length >= 2) break;
  }
  
  // Calculate total
  totalSpent = roster.reduce((sum, p) => sum + parseFloat(p.current_price), 0);
  
  // If over budget, replace expensive players with cheaper ones
  if (totalSpent > budget) {
    console.log(`    Over budget (${totalSpent.toFixed(1)}m), adjusting...`);
    roster.sort((a, b) => b.current_price - a.current_price);
    
    for (let i = 0; i < roster.length && totalSpent > budget; i++) {
      const expensive = roster[i];
      const position = expensive.position;
      const targetPrice = expensive.current_price * 0.6; // Look for 40% cheaper
      
      // Get cheaper alternative that's NOT already in roster
      const alternatives = await pool.query(
        `SELECT p.player_id, p.name, pcp.current_price, p.position
         FROM players p
         JOIN player_current_prices pcp ON p.player_id = pcp.player_id
         WHERE p.position = $1 
         AND pcp.current_price < $2
         AND pcp.current_price > $3
         AND p.player_id != ALL($4)
         ORDER BY pcp.current_price DESC
         LIMIT 10`,
        [position, expensive.current_price, targetPrice * 0.5, Array.from(usedPlayerIds)]
      );
      
      if (alternatives.rows.length > 0) {
        const replacement = alternatives.rows[Math.floor(Math.random() * alternatives.rows.length)];
        
        // Remove expensive player
        roster.splice(i, 1);
        usedPlayerIds.delete(expensive.player_id);
        
        // Add replacement
        roster.push(replacement);
        usedPlayerIds.add(replacement.player_id);
        
        totalSpent = totalSpent - parseFloat(expensive.current_price) + parseFloat(replacement.current_price);
        i--; // Recheck this position
      }
    }
  }
  
  console.log(`    Selected ${roster.length} players, Total: ${totalSpent.toFixed(1)}m`);
  
  // Insert roster into database for week 1
  for (const player of roster) {
    await pool.query(
      `INSERT INTO rosters (team_id, player_id, week, season, position_slot)
       VALUES ($1, $2, $3, $4, 'BENCH')
       ON CONFLICT (team_id, player_id, week, season) DO NOTHING`,
      [teamId, player.player_id, START_WEEK, SEASON]
    );
  }
  
  // Update team budget
  await pool.query(
    `UPDATE teams 
     SET current_spent = $1, remaining_budget = $2
     WHERE team_id = $3`,
    [totalSpent, budget - totalSpent, teamId]
  );
  
  return { roster, totalSpent };
}

async function createRostersForAllTeams(teamIds) {
  console.log('\n=== Creating Rosters for Teams ===');
  
  for (let i = 0; i < teamIds.length; i++) {
    await buildRosterForTeam(teamIds[i], TEAM_NAMES[i]);
  }
  
  console.log('\n✓ All rosters created');
}

async function calculateInitialStandings(leagueIds) {
  console.log('\n=== Calculating Week 1 Standings ===\n');
  
  for (const leagueId of leagueIds) {
    // Get all teams in this league
    const teams = await pool.query(
      `SELECT le.team_id, t.team_name
       FROM league_entries le
       JOIN teams t ON le.team_id = t.team_id
       WHERE le.league_id = $1`,
      [leagueId]
    );
    
    for (const team of teams.rows) {
      // Calculate week 1 points (only starters)
      const points = await pool.query(
        `SELECT SUM(ps.total_points) as total
         FROM rosters r
         JOIN player_scores ps ON r.player_id = ps.player_id
         WHERE r.team_id = $1 
           AND r.week = $2
           AND r.season = $3
           AND ps.week = $2
           AND ps.season = $3
           AND ps.league_format = 'ppr'
           AND r.position_slot != 'BENCH'`,
        [team.team_id, START_WEEK, SEASON]
      );
      
      const weekPoints = parseFloat(points.rows[0].total) || 0;
      
      // Insert into standings
      await pool.query(
        `INSERT INTO league_standings 
         (league_id, team_id, week, season, week_points, total_points)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [leagueId, team.team_id, START_WEEK, SEASON, weekPoints]
      );
    }
    
    // Calculate ranks
    await pool.query(
      `UPDATE league_standings ls
       SET rank = sub.rank
       FROM (
         SELECT league_id, team_id, week, season,
                RANK() OVER (PARTITION BY league_id, week, season ORDER BY total_points DESC) as rank
         FROM league_standings
         WHERE league_id = $1 AND week = $2 AND season = $3
       ) sub
       WHERE ls.league_id = sub.league_id 
         AND ls.team_id = sub.team_id 
         AND ls.week = sub.week 
         AND ls.season = sub.season`,
      [leagueId, START_WEEK, SEASON]
    );
    
    console.log(`✓ Calculated standings for league ${leagueId}`);
  }
}

async function showSampleData() {
  console.log('\n=== Sample Data Summary ===\n');
  
  // Show leagues
  const leagues = await pool.query('SELECT * FROM leagues ORDER BY league_id');
  console.log('Leagues:');
  leagues.rows.forEach(l => {
    console.log(`  - ${l.league_name}: ${l.max_teams} teams`);
  });
  
  // Show teams
  const teams = await pool.query('SELECT * FROM teams ORDER BY team_id LIMIT 5');
  console.log('\nSample Teams:');
  teams.rows.forEach(t => {
    console.log(`  - ${t.team_name}: $${t.current_spent}m spent, $${t.remaining_budget}m remaining`);
  });
  
  // Show standings
  const standings = await pool.query(
    `SELECT l.league_name, t.team_name, ls.total_points, ls.rank
     FROM league_standings ls
     JOIN leagues l ON ls.league_id = l.league_id
     JOIN teams t ON ls.team_id = t.team_id
     WHERE ls.week = $1 AND ls.season = $2
     ORDER BY l.league_id, ls.rank
     LIMIT 10`,
    [START_WEEK, SEASON]
  );
  
  console.log('\nLeague Standings (Top 3 per league):');
  let currentLeague = null;
  standings.rows.forEach(s => {
    if (s.league_name !== currentLeague) {
      console.log(`\n  ${s.league_name}:`);
      currentLeague = s.league_name;
    }
    console.log(`    ${s.rank}. ${s.team_name}: ${s.total_points} pts`);
  });
}

async function run() {
  try {
    console.log('=== Fantasy NFL Sample Data Generator ===');
    
    // Create sample data
    const leagueIds = await createLeagues();
    const teamIds = await createTeams();
    await assignTeamsToLeagues(leagueIds, teamIds);
    await createRostersForAllTeams(teamIds);
    await calculateInitialStandings(leagueIds);
    
    // Show summary
    await showSampleData();
    
    console.log('\n=== Sample Data Created Successfully! ===\n');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Run the generator
run();