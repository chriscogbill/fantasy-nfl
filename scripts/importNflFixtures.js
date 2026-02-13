const axios = require('axios');
const pool = require('../src/db/connection');
const { getCurrentSeason } = require('../src/helpers/settings');

// Map ESPN team abbreviations to our database abbreviations
const TEAM_MAP = {
  'WSH': 'WAS',  // Washington uses WAS in our DB
  'LAR': 'LAR',
  // Add any other mappings if needed
};

function normalizeTeam(espnAbbr) {
  return TEAM_MAP[espnAbbr] || espnAbbr;
}

async function fetchWeekSchedule(week, season, seasonType = 2) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=${seasonType}&week=${week}&dates=${season}`;

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

async function importFixtures(seasonOverride) {
  const client = await pool.connect();

  try {
    // Resolve season: CLI arg > parameter > app_settings
    const cliSeason = process.argv.find(arg => arg.startsWith('--season='))?.split('=')[1]
      || (process.argv.indexOf('--season') !== -1 ? process.argv[process.argv.indexOf('--season') + 1] : null);
    const season = cliSeason ? parseInt(cliSeason) : (seasonOverride || await getCurrentSeason(pool));

    console.log(`Starting NFL ${season} fixtures import...`);

    // Clear existing fixtures for this season
    await client.query('DELETE FROM nfl_fixtures WHERE season = $1', [season]);
    console.log(`Cleared existing ${season} fixtures`);

    let totalImported = 0;

    // Import regular season (weeks 1-18)
    for (let week = 1; week <= 18; week++) {
      console.log(`\nFetching Week ${week}...`);
      const fixtures = await fetchWeekSchedule(week, season, 2);

      if (fixtures.length === 0) {
        console.log(`  No games found for Week ${week}`);
        continue;
      }

      console.log(`  Found ${fixtures.length} games`);

      for (const fixture of fixtures) {
        try {
          await client.query(
            `INSERT INTO nfl_fixtures (season, week, home_team, away_team)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (season, week, home_team, away_team) DO NOTHING`,
            [season, fixture.week, fixture.homeTeam, fixture.awayTeam]
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
       WHERE season = $1
       GROUP BY week
       ORDER BY week`,
      [season]
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

// Export for use as API endpoint, run directly if executed from CLI
if (require.main === module) {
  importFixtures();
}

module.exports = { importFixtures };
