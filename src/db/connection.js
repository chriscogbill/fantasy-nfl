const { Pool } = require('pg');

// Database connection pool
const pool = new Pool({
  user: 'chriscogbill',
  host: 'localhost',
  database: 'fantasyNFL',
  password: '',
  port: 5432,
  max: 20, // Maximum number of connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✓ Database connection established');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

module.exports = pool;
