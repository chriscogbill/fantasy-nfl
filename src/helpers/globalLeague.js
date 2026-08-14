// The global league: one public league per season that every team joins
// automatically at creation. ensureGlobalLeague lazily creates it, so a new
// season needs no admin step — the first team of the season brings the
// league into existence.

async function ensureGlobalLeague(pool, season) {
  const existing = await pool.query(
    `SELECT league_id FROM leagues WHERE season = $1 AND is_global = true LIMIT 1`,
    [season]
  );
  if (existing.rows.length > 0) return existing.rows[0].league_id;

  const created = await pool.query(
    `INSERT INTO leagues
       (league_name, season, created_by, league_admin_email, start_week, end_week, status, privacy_type, is_global)
     VALUES ('Global League', $1, NULL, NULL, 1, 17, 'open', 'public', true)
     RETURNING league_id`,
    [season]
  );
  return created.rows[0].league_id;
}

// Idempotent: joining twice is a no-op.
async function joinGlobalLeague(pool, teamId, season) {
  const leagueId = await ensureGlobalLeague(pool, season);
  await pool.query(
    `INSERT INTO league_entries (league_id, team_id)
     SELECT $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM league_entries WHERE league_id = $1 AND team_id = $2)`,
    [leagueId, teamId]
  );
  return leagueId;
}

module.exports = { ensureGlobalLeague, joinGlobalLeague };
