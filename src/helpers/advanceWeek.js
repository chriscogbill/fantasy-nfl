// Roster carry-forward when the game week advances.
//
// While week N is current, owners edit week N+1 (transfers + lineup). So when
// N+1 locks and becomes current, its rosters already hold those edits and must
// not be overwritten. This used to DELETE week N+1 and copy week N over it,
// which threw away every change made for the coming week.
//
// Instead, at the advance fromWeek -> toWeek:
//   1. Teams with no toWeek roster get a copy of their fromWeek one (safety net;
//      skipped from Preseason, where week 1 was built directly).
//   2. Every team gets a toWeek+1 roster (copy of toWeek) if it has none, so the
//      newly editable week starts from the current squad instead of empty.
// Neither step touches a roster that already exists.

const LAST_WEEK = 18;

async function copyMissingRosters(db, fromWeek, toWeek, season) {
  const result = await db.query(
    `INSERT INTO rosters (team_id, player_id, week, season, position_slot, bench_order)
     SELECT r.team_id, r.player_id, $2, r.season, r.position_slot, r.bench_order
     FROM rosters r
     WHERE r.week = $1 AND r.season = $3
       AND NOT EXISTS (
         SELECT 1 FROM rosters x
         WHERE x.team_id = r.team_id AND x.week = $2 AND x.season = $3
       )`,
    [fromWeek, toWeek, season]
  );
  return result.rowCount;
}

async function carryRostersForward(db, fromWeek, toWeek, season) {
  const filled = fromWeek ? await copyMissingRosters(db, fromWeek, toWeek, season) : 0;
  const prepared = toWeek < LAST_WEEK ? await copyMissingRosters(db, toWeek, toWeek + 1, season) : 0;
  return { filledCurrentWeek: filled, preparedNextWeek: prepared };
}

// Lazily create one team's roster for `week` from `week - 1` if it has none.
// Covers teams whose next-week roster was never created (before this fix, the
// advance only filled the week that had just locked).
async function ensureTeamRoster(db, teamId, week, season) {
  if (week <= 1) return 0;
  const result = await db.query(
    `INSERT INTO rosters (team_id, player_id, week, season, position_slot, bench_order)
     SELECT r.team_id, r.player_id, $2, r.season, r.position_slot, r.bench_order
     FROM rosters r
     WHERE r.team_id = $1 AND r.week = $3 AND r.season = $4
       AND NOT EXISTS (
         SELECT 1 FROM rosters x
         WHERE x.team_id = $1 AND x.week = $2 AND x.season = $4
       )`,
    [teamId, week, week - 1, season]
  );
  return result.rowCount;
}

module.exports = { carryRostersForward, ensureTeamRoster };
