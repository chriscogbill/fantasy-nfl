const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const pool = require('./src/db/connection');

// Separate pool for the shared auth/session database (cogsAuth)
const authPool = new Pool({
  user: process.env.DB_USER || 'chriscogbill',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.AUTH_DB_NAME || 'cogsAuth',
  password: process.env.DB_PASSWORD || '',
  port: parseInt(process.env.DB_PORT || '5432'),
});

// Import routes (auth is handled by the cogs-auth service)
const playersRouter = require('./src/routes/players');
const teamsRouter = require('./src/routes/teams');
const leaguesRouter = require('./src/routes/leagues');
const transfersRouter = require('./src/routes/transfers');
const settingsRouter = require('./src/routes/settings');
const deadlinesRouter = require('./src/routes/deadlines');
const scoringRouter = require('./src/routes/scoring');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware
// ============================================

// Enable CORS for all routes with credentials
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3001,http://localhost:3002').split(',');
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Session middleware with shared PostgreSQL store (cogsAuth database)
const cookieConfig = {
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
};

// Set cookie domain for cross-subdomain sharing (production only)
if (process.env.COOKIE_DOMAIN) {
  cookieConfig.domain = process.env.COOKIE_DOMAIN;
}

app.use(session({
  store: new pgSession({
    pool: authPool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'cogs-shared-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: cookieConfig
}));

// Parse JSON request bodies
app.use(express.json());

// Lazy sync: ensure authenticated users have a profile in the local user_profiles table
app.use(async (req, res, next) => {
  if (req.session?.userId && req.session?.email) {
    try {
      await pool.query(
        `INSERT INTO user_profiles (user_id, email, username, full_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username, full_name = EXCLUDED.full_name`,
        [req.session.userId, req.session.email, req.session.username || req.session.email, null]
      );
    } catch (err) {
      // Non-critical - log but don't block the request
      console.error('User profile sync error:', err.message);
    }
  }
  next();
});

// Request logging with session info
app.use((req, res, next) => {
  const sessionInfo = req.session?.userId ? `[User: ${req.session.email}]` : '[Not authenticated]';
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} ${sessionInfo}`);
  next();
});

// ============================================
// Routes
// ============================================

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    });
  }
});

// API info
app.get('/', (req, res) => {
  res.json({
    name: 'Fantasy NFL Salary Cap API',
    version: '1.0.0',
    endpoints: {
      players: '/api/players',
      teams: '/api/teams',
      leagues: '/api/leagues',
      transfers: '/api/transfers',
      health: '/health'
    },
    documentation: 'See README.md for endpoint details'
  });
});

// Mount API routes (auth handled by cogs-auth service on port 3002)
app.use('/api/players', playersRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/leagues', leaguesRouter);
app.use('/api/transfers', transfersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/deadlines', deadlinesRouter);
app.use('/api/scoring', scoringRouter);

// ============================================
// Error Handling
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// ============================================
// Server Startup
// ============================================

app.listen(PORT, async () => {
  console.log('\n===========================================');
  console.log('Fantasy NFL Salary Cap API');
  console.log('===========================================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Test database connection
  try {
    const result = await pool.query('SELECT COUNT(*) as player_count FROM players');
    const playerCount = result.rows[0].player_count;
    console.log(`✓ Database connected (${playerCount} players loaded)`);
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
  }

  console.log('\nAvailable endpoints:');
  console.log('  GET  /health                          - Health check');
  console.log('  GET  /api/players                     - Search players');
  console.log('  GET  /api/players/:id                 - Get player details');
  console.log('  GET  /api/players/:id/stats           - Get player stats');
  console.log('  GET  /api/teams                       - List teams');
  console.log('  POST /api/teams                       - Create team');
  console.log('  GET  /api/teams/:id/roster            - Get team roster');
  console.log('  GET  /api/leagues                     - List leagues');
  console.log('  GET  /api/leagues/:id/standings       - League standings');
  console.log('  POST /api/transfers/preview           - Preview transfer');
  console.log('  POST /api/transfers/execute           - Execute transfer');
  console.log('===========================================\n');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  await authPool.end();
  process.exit(0);
});
