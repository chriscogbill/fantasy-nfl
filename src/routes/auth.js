const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../db/connection');

// POST /api/auth/register - Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, fullName } = req.body;

    if (!email || !username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email, username, and password are required'
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT user_id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'User with this email or username already exists'
      });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (email, username, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, email, username, full_name, role, created_at`,
      [email, username, passwordHash, fullName || null]
    );

    const user = result.rows[0];

    // Set session
    req.session.userId = user.user_id;
    req.session.email = user.email;
    req.session.username = user.username;
    req.session.role = user.role || 'user';

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        userId: user.user_id,
        email: user.email,
        username: user.username,
        fullName: user.full_name,
        role: user.role || 'user'
      }
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/login - Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Get user
    const result = await pool.query(
      'SELECT user_id, email, username, password_hash, full_name, role FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const user = result.rows[0];

    // Check password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // Update last login
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = $1',
      [user.user_id]
    );

    // Set session
    req.session.userId = user.user_id;
    req.session.email = user.email;
    req.session.username = user.username;
    req.session.role = user.role || 'user';

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        userId: user.user_id,
        email: user.email,
        username: user.username,
        fullName: user.full_name,
        role: user.role || 'user'
      }
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/logout - Logout user
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: 'Failed to logout'
      });
    }

    res.json({
      success: true,
      message: 'Logout successful'
    });
  });
});

// GET /api/auth/me - Get current user
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  res.json({
    success: true,
    user: {
      userId: req.session.userId,
      email: req.session.email,
      username: req.session.username,
      role: req.session.role || 'user'
    }
  });
});

module.exports = router;
