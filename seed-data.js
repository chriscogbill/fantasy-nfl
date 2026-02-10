const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'chriscogbill',
  database: 'fantasyNFL',
  password: '',
});

async function seed() {
  try {
    // Create app settings
    await pool.query(`
      INSERT INTO app_settings (setting_key, setting_value, description) VALUES
        ('current_week', '1', 'Current NFL week'),
        ('current_season', '2024', 'Current NFL season'),
        ('current_day', 'Preseason', 'Current game day')
      ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
    `);
    console.log('App settings created');

    // Create an admin user
    const adminHash = await bcrypt.hash('admin123', 10);
    await pool.query(`
      INSERT INTO users (username, email, password_hash, role) VALUES
        ('admin', 'admin@test.com', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash]);
    console.log('Admin user created (admin@test.com / admin123)');

    // Create a test user
    const userHash = await bcrypt.hash('test123', 10);
    await pool.query(`
      INSERT INTO users (username, email, password_hash, role) VALUES
        ('testuser', 'test@test.com', $1, 'user')
      ON CONFLICT (email) DO NOTHING
    `, [userHash]);
    console.log('Test user created (test@test.com / test123)');

    // Insert some sample NFL players
    const players = [
      ['Patrick Mahomes', 'QB', 'KC'],
      ['Josh Allen', 'QB', 'BUF'],
      ['Lamar Jackson', 'QB', 'BAL'],
      ['Jalen Hurts', 'QB', 'PHI'],
      ['Joe Burrow', 'QB', 'CIN'],
      ['Derrick Henry', 'RB', 'BAL'],
      ['Saquon Barkley', 'RB', 'PHI'],
      ['Christian McCaffrey', 'RB', 'SF'],
      ['Breece Hall', 'RB', 'NYJ'],
      ['Bijan Robinson', 'RB', 'ATL'],
      ['Travis Etienne', 'RB', 'JAX'],
      ['Jonathan Taylor', 'RB', 'IND'],
      ['Kyren Williams', 'RB', 'LAR'],
      ['Tyreek Hill', 'WR', 'MIA'],
      ['CeeDee Lamb', 'WR', 'DAL'],
      ['Ja\'Marr Chase', 'WR', 'CIN'],
      ['Amon-Ra St. Brown', 'WR', 'DET'],
      ['AJ Brown', 'WR', 'PHI'],
      ['Davante Adams', 'WR', 'LV'],
      ['Stefon Diggs', 'WR', 'HOU'],
      ['DK Metcalf', 'WR', 'SEA'],
      ['Travis Kelce', 'TE', 'KC'],
      ['Mark Andrews', 'TE', 'BAL'],
      ['TJ Hockenson', 'TE', 'MIN'],
      ['George Kittle', 'TE', 'SF'],
      ['Harrison Butker', 'K', 'KC'],
      ['Justin Tucker', 'K', 'BAL'],
      ['Tyler Bass', 'K', 'BUF'],
      ['Dallas Cowboys', 'DEF', 'DAL'],
      ['San Francisco 49ers', 'DEF', 'SF'],
      ['Baltimore Ravens', 'DEF', 'BAL'],
    ];

    for (const [name, position, team] of players) {
      await pool.query(`
        INSERT INTO players (name, position, team, status)
        VALUES ($1, $2, $3, 'Active')
        ON CONFLICT DO NOTHING
      `, [name, position, team]);
    }
    console.log(`Inserted ${players.length} sample players`);

    // Set prices for all players
    const allPlayers = await pool.query('SELECT player_id, position FROM players');
    const priceMap = { QB: 8.0, RB: 7.5, WR: 7.0, TE: 6.0, K: 4.5, DEF: 5.0 };
    for (const p of allPlayers.rows) {
      const basePrice = priceMap[p.position] || 5.0;
      const price = basePrice + (Math.random() * 3 - 1.5); // ±1.5M variation
      await pool.query(`
        INSERT INTO player_current_prices (player_id, current_price, season, last_updated)
        VALUES ($1, $2, 2024, NOW())
        ON CONFLICT (player_id) DO UPDATE SET current_price = $2, last_updated = NOW()
      `, [p.player_id, Math.max(4.5, price.toFixed(1))]);
    }
    console.log('Player prices set');

    // Insert scoring rules
    await pool.query(`
      INSERT INTO scoring_sections (section_name) VALUES
        ('passing'), ('rushing'), ('receiving'), ('kicking'), ('defense')
      ON CONFLICT DO NOTHING
    `);

    // Create a league
    await pool.query(`
      INSERT INTO leagues (league_name, season, created_by, league_type, status, start_week, end_week, league_admin_email, privacy_type, invite_code)
      VALUES ('Test League', 2024, 'admin', 'salary_cap', 'active', 1, 18, 'admin@test.com', 'public', 'TEST123')
      ON CONFLICT DO NOTHING
    `);
    console.log('Test league created');

    console.log('\n=== Seed data complete! ===');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

seed();
