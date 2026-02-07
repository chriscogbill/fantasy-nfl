const express = require('express');
const cors = require('cors');
const session = require('express-session');
const pool = require('./src/db/connection');

// Import routes
const authRouter = require('./src/routes/auth');
const playersRouter = require('./src/routes/players');
const teamsRouter = require('./src/routes/teams');
const leaguesRouter = require('./src/routes/leagues');
const transfersRouter = require('./src/routes/transfers');
const settingsRouter = require('./src/routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Middleware
// ============================================

// Enable CORS for all routes with credentials
app.use(cors({
  origin: 'http://localhost:3001',
  credentials: true
}));

// Session middleware
app.use(session({
  secret: 'fantasy-nfl-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Parse JSON request bodies
app.use(express.json());

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

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/players', playersRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/leagues', leaguesRouter);
app.use('/api/transfers', transfersRouter);
app.use('/api/settings', settingsRouter);

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
  process.exit(0);
});
