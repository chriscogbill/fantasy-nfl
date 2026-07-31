// FPL-style auto-substitutions, applied once a week's games are complete.
//
// Rules (agreed with Chris, 2026-07-31):
// - A starter who didn't play — no non-zero stat that week, or team on bye —
//   is eligible to be replaced.
// - Bench players come in IN BENCH ORDER (first eligible player goes in, not
//   the highest scorer): lineup skill stays meaningful. Bench order is
//   currently roster-row insertion order (roster_id ASC) until a bench-order
//   UI exists.
// - A bench player can replace an inactive starter of a DIFFERENT position so
//   long as the resulting nine can be rearranged into a legal formation
//   (1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX = RB/WR/TE, 1 DEF, 1 K). Example: WR2
//   inactive, TE first on bench, a WR sits in FLEX -> the FLEX WR shifts to
//   WR2 and the TE takes FLEX.
// - Swaps flip position_slot on the completed week's rows; the incoming
//   player is marked auto_subbed for UI badging. Shifted starters (slot
//   changed, still starting) are not marked. Idempotent: once applied, every
//   starter either played or had no eligible replacement.
//
// "Played" matches the reprice definition: any non-zero stat row; DEF counts
// as having played whenever their team had a fixture (a shutout is a
// legitimately all-zero row).

const NONZERO_STAT_CONDITION = `(
  st.passing_yards <> 0 OR st.passing_tds <> 0 OR st.interceptions <> 0 OR st.completions <> 0 OR st.attempts <> 0 OR
  st.rushing_yards <> 0 OR st.rushing_tds <> 0 OR st.rushing_attempts <> 0 OR
  st.receptions <> 0 OR st.receiving_yards <> 0 OR st.receiving_tds <> 0 OR st.targets <> 0 OR
  st.fumbles_lost <> 0 OR st.two_point_conversions <> 0 OR
  st.fg_0_19 <> 0 OR st.fg_20_29 <> 0 OR st.fg_30_39 <> 0 OR st.fg_40_49 <> 0 OR st.fg_50p <> 0 OR
  st.xp_made <> 0 OR st.xp_missed <> 0 OR st.fga <> 0 OR st.def_td <> 0)`;

const SLOT_ORDER = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'DEF', 'K'];

function countByPosition(players) {
  const c = {};
  for (const p of players) c[p.position] = (c[p.position] || 0) + 1;
  return c;
}

function fitsFormation(players) {
  if (players.length !== 9) return false;
  const c = countByPosition(players);
  return (c.QB || 0) === 1 && (c.DEF || 0) === 1 && (c.K || 0) === 1 &&
    (c.RB || 0) >= 2 && (c.WR || 0) >= 2 && (c.TE || 0) >= 1 &&
    ((c.RB || 0) + (c.WR || 0) + (c.TE || 0)) === 6;
}

// Assign the nine players to named slots, keeping players in slots of their
// own position type where possible so churn is minimal. fitsFormation must
// already hold. Returns Map(roster_id -> slot).
function assignSlots(players) {
  const assignment = new Map();
  const take = (arr, n, preferSlots) => {
    const sorted = [...arr].sort((a, b) => {
      const ap = preferSlots.includes(a.position_slot) ? 0 : 1;
      const bp = preferSlots.includes(b.position_slot) ? 0 : 1;
      return ap - bp || a.roster_id - b.roster_id;
    });
    return sorted.slice(0, n);
  };

  const byPos = { QB: [], RB: [], WR: [], TE: [], DEF: [], K: [] };
  for (const p of players) byPos[p.position].push(p);

  assignment.set(byPos.QB[0].roster_id, 'QB');
  assignment.set(byPos.DEF[0].roster_id, 'DEF');
  assignment.set(byPos.K[0].roster_id, 'K');

  const rbs = take(byPos.RB, 2, ['RB1', 'RB2']);
  assignment.set(rbs[0].roster_id, 'RB1');
  assignment.set(rbs[1].roster_id, 'RB2');
  const wrs = take(byPos.WR, 2, ['WR1', 'WR2']);
  assignment.set(wrs[0].roster_id, 'WR1');
  assignment.set(wrs[1].roster_id, 'WR2');
  const te = take(byPos.TE, 1, ['TE']);
  assignment.set(te[0].roster_id, 'TE');

  const flex = players.find(p => !assignment.has(p.roster_id));
  assignment.set(flex.roster_id, 'FLEX');
  return assignment;
}

async function applyAutoSubs(pool, week, season, dryRun) {
  const playedResult = await pool.query(
    `SELECT DISTINCT st.player_id
     FROM player_stats st
     JOIN players pl ON pl.player_id = st.player_id
     WHERE st.season = $1 AND st.week = $2
       AND (pl.position = 'DEF' OR ${NONZERO_STAT_CONDITION})`,
    [season, week]
  );
  const played = new Set(playedResult.rows.map(r => r.player_id));

  const fixturesResult = await pool.query(
    `SELECT home_team, away_team FROM nfl_fixtures WHERE season = $1 AND week = $2`,
    [season, week]
  );
  const teamsPlaying = new Set();
  for (const f of fixturesResult.rows) { teamsPlaying.add(f.home_team); teamsPlaying.add(f.away_team); }

  const rosterResult = await pool.query(
    `SELECT r.roster_id, r.team_id, r.player_id, r.position_slot,
            pl.name, pl.position, pl.team AS nfl_team,
            COALESCE(sc.total_points, 0)::float AS week_points
     FROM rosters r
     JOIN players pl ON pl.player_id = r.player_id
     LEFT JOIN player_scores sc ON sc.player_id = r.player_id
       AND sc.week = $2 AND sc.season = $1 AND sc.league_format = 'ppr'
     WHERE r.season = $1 AND r.week = $2
     ORDER BY r.team_id, r.roster_id`,
    [season, week]
  );

  const byTeam = new Map();
  for (const row of rosterResult.rows) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id).push(row);
  }

  const didPlay = (row) => played.has(row.player_id) && teamsPlaying.has(row.nfl_team);
  const allChanges = [];
  const teamSummaries = [];

  for (const [teamId, rows] of byTeam) {
    const starters = rows.filter(r => r.position_slot !== 'BENCH');
    // Bench order: insertion order until a bench-order UI exists
    const bench = rows.filter(r => r.position_slot === 'BENCH');
    if (starters.length !== 9) continue; // malformed lineup — leave alone

    let lineup = [...starters];
    const replaced = [];   // inactive starters moved to bench
    const subbedIn = [];   // bench players brought in
    const stillInactive = () => lineup.filter(r => !didPlay(r) && !subbedIn.includes(r));

    for (const cand of bench) {
      if (!didPlay(cand)) continue;
      const targets = stillInactive()
        .sort((a, b) => SLOT_ORDER.indexOf(a.position_slot) - SLOT_ORDER.indexOf(b.position_slot));
      if (targets.length === 0) break;
      for (const inactive of targets) {
        const trial = lineup.filter(r => r !== inactive).concat(cand);
        if (fitsFormation(trial)) {
          lineup = trial;
          replaced.push(inactive);
          subbedIn.push(cand);
          break;
        }
      }
    }

    if (subbedIn.length === 0) continue;

    const slots = assignSlots(lineup);
    const changes = [];
    for (const r of replaced) {
      changes.push({ rosterId: r.roster_id, slot: 'BENCH', autoSubbed: false });
    }
    for (const r of lineup) {
      const slot = slots.get(r.roster_id);
      if (slot !== r.position_slot) {
        changes.push({ rosterId: r.roster_id, slot, autoSubbed: subbedIn.includes(r) });
      }
    }
    allChanges.push(...changes);
    teamSummaries.push({
      teamId,
      out: replaced.map(r => `${r.name} (${r.position_slot})`),
      in: subbedIn.map(r => `${r.name} (${r.position} +${r.week_points} pts)`),
    });
  }

  if (!dryRun && allChanges.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of allChanges) {
        await client.query(
          `UPDATE rosters SET position_slot = $1, auto_subbed = $2 WHERE roster_id = $3`,
          [c.slot, c.autoSubbed, c.rosterId]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  return {
    week,
    season,
    teamsChecked: byTeam.size,
    swaps: teamSummaries,
  };
}

module.exports = { applyAutoSubs };
