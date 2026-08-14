// Default starting lineup for a just-completed roster: the most expensive
// player per slot starts (FLEX = priciest remaining RB/WR/TE), everyone else
// stays on the bench. Preseason has no form data, so price is the only
// sensible default signal — owners can rearrange freely on the lineup page.
// Only fires when the roster is full (15) and NO starters are set, so it
// never overwrites a lineup a user has touched.

const DEFAULT_SLOTS = [
  ['QB', 'QB'],
  ['RB', 'RB1'], ['RB', 'RB2'],
  ['WR', 'WR1'], ['WR', 'WR2'],
  ['TE', 'TE'],
  ['DEF', 'DEF'],
  ['K', 'K'],
];

async function applyDefaultLineup(client, teamId, week, season) {
  const rosterResult = await client.query(
    `SELECT r.roster_id, r.position_slot, pl.position,
            COALESCE(pcp.current_price, 0)::float AS price
     FROM rosters r
     JOIN players pl ON pl.player_id = r.player_id
     LEFT JOIN player_current_prices pcp ON pcp.player_id = r.player_id AND pcp.season = $3
     WHERE r.team_id = $1 AND r.week = $2 AND r.season = $3`,
    [teamId, week, season]
  );
  if (rosterResult.rows.length !== 15) return false;
  if (rosterResult.rows.some(r => r.position_slot && r.position_slot !== 'BENCH')) return false;

  const byPos = {};
  for (const r of rosterResult.rows) (byPos[r.position] = byPos[r.position] || []).push(r);
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => b.price - a.price);

  const assignments = [];
  for (const [pos, slot] of DEFAULT_SLOTS) {
    const player = (byPos[pos] || []).shift();
    if (player) assignments.push([player.roster_id, slot]);
  }
  const flex = ['RB', 'WR', 'TE']
    .flatMap(pos => byPos[pos] || [])
    .sort((a, b) => b.price - a.price)[0];
  if (flex) assignments.push([flex.roster_id, 'FLEX']);

  for (const [rosterId, slot] of assignments) {
    await client.query(
      `UPDATE rosters SET position_slot = $1 WHERE roster_id = $2`,
      [slot, rosterId]
    );
  }
  return assignments.length === 9;
}

module.exports = { applyDefaultLineup };
