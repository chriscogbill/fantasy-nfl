/**
 * Helper functions for accessing app settings.
 */

async function getCurrentSeason(pool) {
  const result = await pool.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'current_season'"
  );
  return parseInt(result.rows[0]?.setting_value) || 2024;
}

module.exports = { getCurrentSeason };
