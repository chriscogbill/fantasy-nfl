const { Pool } = require('pg');

// Database connection pool
// Supports DATABASE_URL (used by Railway/Render) or individual env vars for local dev
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })
  : new Pool({
      user: process.env.DB_USER || 'chriscogbill',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'fantasyNFL',
      password: process.env.DB_PASSWORD || '',
      port: parseInt(process.env.DB_PORT || '5432'),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

// Test connection on startup
pool.on('connect', () => {
  console.log('✓ Database connection established');
});

// An idle client erroring (e.g. the DB restarting or dropping a connection) is
// recoverable: pg discards that client and the next query opens a fresh one.
// Exiting here used to restart the whole API on one dropped connection.
pool.on('error', (err) => {
  console.error('Idle database client error (client discarded):', err.message);
});

module.exports = pool;
