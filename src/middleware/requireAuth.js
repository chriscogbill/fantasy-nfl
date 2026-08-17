// Shared authentication middleware
// Sessions are managed by the cogs-auth service and stored in the shared cogsAuth database.
// These middleware functions read from the shared session store.

const pool = require('../db/connection');

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated'
    });
  }

  if (req.session.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }

  next();
}

// Verifies the authenticated user owns the team being acted on.
// Use { from: 'params' } for routes with :id in URL (e.g. /teams/:id/lineup)
// Use { from: 'body' } for routes with teamId in request body (e.g. /transfers/execute)
function requireTeamOwnership({ from = 'params' } = {}) {
  return async (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Admins can manage any team
    if (req.session.role === 'admin') {
      return next();
    }

    const teamId = from === 'params' ? req.params.id : req.body.teamId;

    if (!teamId) {
      return res.status(400).json({ success: false, error: 'Team ID is required' });
    }

    try {
      const result = await pool.query(
        'SELECT user_email FROM teams WHERE team_id = $1',
        [teamId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Team not found' });
      }

      if (result.rows[0].user_email !== req.session.email) {
        return res.status(403).json({ success: false, error: 'You do not own this team' });
      }

      next();
    } catch (error) {
      console.error('Error checking team ownership:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

// Machine access for the weekly cron: a matching x-cron-secret header is as
// good as an admin session. Humans still need admin.
function requireAdminOrCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const provided = req.get('x-cron-secret');
  if (secret && provided) {
    // Hash both sides so timingSafeEqual gets equal-length buffers and the
    // comparison leaks no per-character timing (same hardening as
    // cogs-uptime's proxy key check).
    const crypto = require('crypto');
    const a = crypto.createHash('sha256').update(provided).digest();
    const b = crypto.createHash('sha256').update(secret).digest();
    if (crypto.timingSafeEqual(a, b)) return next();
  }
  return requireAdmin(req, res, next);
}

module.exports = { requireAuth, requireAdmin, requireTeamOwnership, requireAdminOrCron };
