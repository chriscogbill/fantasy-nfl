// Shared authentication middleware
// Sessions are managed by the cogs-auth service and stored in the shared cogsAuth database.
// These middleware functions read from the shared session store.

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

module.exports = { requireAuth, requireAdmin };
