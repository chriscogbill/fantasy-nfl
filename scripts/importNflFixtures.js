const axios = require('axios');
const pool = require('../src/db/connection');

// Map ESPN team abbreviations to our database abbreviations
const TEAM_MAP = {
  'WSH': 'WAS',  // Washington uses WAS in our DB
  'LAR': 'LAR',
  // Add any other mappings if needed
};

function normalizeTeam(espnAbbr) {
  return TEAM_MAP[espnAbbr] || espnAbbr;
}

async function fetchWeekSchedule(week, seasonType = 2) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasonType}&week=${week}&dates=2024`;

  try {
    const response = await axios.get(url);
    const games = response.data.events || [];

    const fixtures = games.map(game => {
      const homeTeam = game.competitions[0].competitors.find(c => c.homeAway === 'home');
      const awayTeam = game.competitions[0].competitors.find(c => c.homeAway === 'away');

      return {
        week,
        homeTeam: normalizeTeam(homeTeam.team.abbreviation),
        awayTeam: normalizeTeam(awayTeam.team.abbreviation)
      };
    });

    return fixtures;
  } catch (error) {
    console.error(`Error fetching week ${week}:`, error.message);
    return [];
  }
}

async function importFixtures() {
  const client = await pool.connect();

  try {
    console.log('Starting NFL 2024 fixtures import...');

    // Clear existing 2024 fixtures
    await client.query('DELETE FROM nfl_fixtures WHERE season = 2024');
    console.log('Cleared existing 2024 fixtures');

    let totalImported = 0;

    // Import regular season (weeks 1-18)
    for (let week = 1; week <= 18; week++) {
      console.log(`\nFetching Week ${week}...`);
      const fixtures = await fetchWeekSchedule(week, 2);

      if (fixtures.length === 0) {
        console.log(`  No games found for Week ${week}`);
        continue;
      }

      console.log(`  Found ${fixtures.length} games`);

      for (const fixture of fixtures) {
        try {
          await client.query(
            `INSERT INTO nfl_fixtures (season, week, home_team, away_team)
             VALUES (2024, $1, $2, $3)
             ON CONFLICT (season, week, home_team, away_team) DO NOTHING`,
            [fixture.week, fixture.homeTeam, fixture.awayTeam]
          );
          console.log(`  ✓ ${fixture.homeTeam} vs ${fixture.awayTeam}`);
          totalImported++;
        } catch (error) {
          console.error(`  ✗ Error inserting ${fixture.homeTeam} vs ${fixture.awayTeam}:`, error.message);
        }
      }

      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`\n✅ Import complete! Total fixtures imported: ${totalImported}`);

    // Show fixture count per week
    const result = await client.query(
      `SELECT week, COUNT(*) as count
       FROM nfl_fixtures
       WHERE season = 2024
       GROUP BY week
       ORDER BY week`
    );

    console.log('\nFixtures per week:');
    result.rows.forEach(row => {
      console.log(`  Week ${row.week}: ${row.count} games`);
    });

  } catch (error) {
    console.error('Error during import:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the import
importFixtures();
