const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  user: 'chriscogbill',
  host: 'localhost',
  database: 'fantasyNFL',
  password: '',
  port: 5432,
});

async function createUsers() {
  const users = [
    { email: 'alice@example.com', username: 'alice', password: 'password123', fullName: 'Alice Johnson' },
    { email: 'bob@example.com', username: 'bob', password: 'password123', fullName: 'Bob Smith' },
    { email: 'charlie@example.com', username: 'charlie', password: 'password123', fullName: 'Charlie Brown' },
    { email: 'diana@example.com', username: 'diana', password: 'password123', fullName: 'Diana Prince' },
    { email: 'evan@example.com', username: 'evan', password: 'password123', fullName: 'Evan Davis' },
    { email: 'fiona@example.com', username: 'fiona', password: 'password123', fullName: 'Fiona Green' },
    { email: 'george@example.com', username: 'george', password: 'password123', fullName: 'George Martin' },
    { email: 'hannah@example.com', username: 'hannah', password: 'password123', fullName: 'Hannah Lee' },
  ];

  console.log('Creating users...\n');

  for (const user of users) {
    try {
      const passwordHash = await bcrypt.hash(user.password, 10);

      await pool.query(
        `INSERT INTO users (email, username, password_hash, full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             username = EXCLUDED.username,
             full_name = EXCLUDED.full_name`,
        [user.email, user.username, passwordHash, user.fullName]
      );

      console.log(`✓ Created user: ${user.email} (password: ${user.password})`);
    } catch (error) {
      console.error(`✗ Error creating user ${user.email}:`, error.message);
    }
  }

  console.log('\n✓ All users created/updated successfully!');
  console.log('\nYou can now login with any of these accounts:');
  console.log('Email: alice@example.com, Password: password123');
  console.log('Email: bob@example.com, Password: password123');
  console.log('etc...\n');

  await pool.end();
}

createUsers();
