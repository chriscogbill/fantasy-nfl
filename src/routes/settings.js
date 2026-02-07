const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// Middleware to check if user is admin
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

// GET /api/settings - Get all settings
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT setting_key, setting_value, description, updated_at
       FROM app_settings
       ORDER BY setting_key`
    );

    // Convert to key-value object
    const settings = {};
    result.rows.forEach(row => {
      settings[row.setting_key] = {
        value: row.setting_value,
        description: row.description,
        updated_at: row.updated_at
      };
    });

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/settings/:key - Get specific setting
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;

    const result = await pool.query(
      `SELECT setting_value, description, updated_at
       FROM app_settings
       WHERE setting_key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Setting not found' });
    }

    res.json({
      success: true,
      key,
      value: result.rows[0].setting_value,
      description: result.rows[0].description,
      updated_at: result.rows[0].updated_at
    });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/settings/:key - Update setting (admin only)
router.put('/:key', requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!value && value !== 0) {
      return res.status(400).json({ success: false, error: 'value is required' });
    }

    // Special handling for current_week changes
    if (key === 'current_week') {
      // Get the old week value
      const oldWeekResult = await pool.query(
        `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
      );
      const oldWeek = oldWeekResult.rows[0]?.setting_value;

      // Update the setting
      const result = await pool.query(
        `UPDATE app_settings
         SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
         WHERE setting_key = $2
         RETURNING *`,
        [value, key]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Setting not found' });
      }

      // Auto-copy rosters when advancing from Preseason to Week 1 or between weeks
      let copyResult = null;
      if (oldWeek === 'Preseason' && value === '1') {
        // Don't copy anything - Week 1 rosters should be built manually during preseason
        console.log('Advanced from Preseason to Week 1 - no roster copying needed');
      } else if (oldWeek !== 'Preseason' && value !== 'Preseason') {
        const fromWeek = parseInt(oldWeek);
        const toWeek = parseInt(value);

        // Only copy forward if advancing weeks
        if (toWeek === fromWeek + 1) {
          copyResult = await pool.query(
            `SELECT * FROM copy_all_rosters_to_next_week($1, $2, 2024)`,
            [fromWeek, toWeek]
          );
          console.log(`Copied rosters from Week ${fromWeek} to Week ${toWeek}:`, copyResult.rows[0]);
        }
      } else if (value === 'Preseason') {
        console.log('Set to Preseason - no roster copying needed');
      }

      res.json({
        success: true,
        message: `Setting '${key}' updated successfully`,
        setting: {
          key: result.rows[0].setting_key,
          value: result.rows[0].setting_value,
          description: result.rows[0].description,
          updated_at: result.rows[0].updated_at
        },
        rostersCopied: copyResult ? copyResult.rows[0] : null
      });
    } else {
      // Normal setting update
      const result = await pool.query(
        `UPDATE app_settings
         SET setting_value = $1, updated_at = CURRENT_TIMESTAMP
         WHERE setting_key = $2
         RETURNING *`,
        [value, key]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Setting not found' });
      }

      res.json({
        success: true,
        message: `Setting '${key}' updated successfully`,
        setting: {
          key: result.rows[0].setting_key,
          value: result.rows[0].setting_value,
          description: result.rows[0].description,
          updated_at: result.rows[0].updated_at
        }
      });
    }
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/settings/current/week - Convenience endpoint for current week
router.get('/current/week', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );

    res.json({
      success: true,
      week: parseInt(result.rows[0].setting_value)
    });
  } catch (error) {
    console.error('Error fetching current week:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
