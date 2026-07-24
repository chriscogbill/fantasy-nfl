/**
 * Helper functions for accessing app settings.
 */

async function getCurrentSeason(pool) {
  const result = await pool.query(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'current_season'"
  );
  // Break-glass fallback only — the app_settings row is the source of
  // truth. Dynamic rather than a hardcoded year so a missing row during
  // e.g. a fresh-environment bootstrap degrades to "this year" instead
  // of silently pinning every query to a stale season.
  return parseInt(result.rows[0]?.setting_value) || new Date().getFullYear();
}

module.exports = { getCurrentSeason };
