'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/AuthContext';
import PlayerStatsModal from '../../../../components/PlayerStatsModal';
import TeamLogo from '../../../../components/TeamLogo';

export default function LineupPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.id;
  const { user, loading: authLoading, currentSeason } = useAuth();

  const [team, setTeam] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [lineup, setLineup] = useState({});
  const [bench, setBench] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [deadline, setDeadline] = useState(null);
  const [currentDay, setCurrentDay] = useState(null);
  const [lineupLocked, setLineupLocked] = useState(false);

  // Required positions
  const requiredPositions = [
    { slot: 'QB', position: 'QB', count: 1 },
    { slot: 'RB1', position: 'RB', count: 1 },
    { slot: 'RB2', position: 'RB', count: 1 },
    { slot: 'WR1', position: 'WR', count: 1 },
    { slot: 'WR2', position: 'WR', count: 1 },
    { slot: 'TE', position: 'TE', count: 1 },
    { slot: 'FLEX', position: ['RB', 'WR', 'TE'], count: 1 },
    { slot: 'K', position: 'K', count: 1 },
    { slot: 'DEF', position: 'DEF', count: 1 },
  ];

  // Lineup week is next week (or Week 1 during Setup/Preseason)
  const lineupWeek = currentWeek !== null
    ? (currentWeek === 'Setup' || currentWeek === 'Preseason' ? 1 : parseInt(currentWeek) + 1)
    : null;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (teamId && user && !authLoading) {
      loadData();
    }
  }, [teamId, user, authLoading]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [week, dayResponse] = await Promise.all([
        api.getCurrentWeek(),
        api.getSetting('current_day'),
      ]);
      const season = currentSeason;
      setCurrentWeek(week);
      const day = parseInt(dayResponse.value) || 1;
      setCurrentDay(day);

      const displayWeek = (week === 'Setup' || week === 'Preseason') ? 1 : parseInt(week) + 1;

      const [teamData, rosterData, deadlineData] = await Promise.all([
        api.getTeam(teamId),
        api.getTeamRoster(teamId, { week: displayWeek, season }).catch(() => ({
          starters: [],
          bench: [],
        })),
        api.getDeadline(season, displayWeek).catch(() => ({ deadline: null })),
      ]);

      // Check if lineup is locked (never locked during Preseason)
      if (deadlineData.deadline) {
        setDeadline(deadlineData.deadline);
        if (week !== 'Preseason') {
          setLineupLocked(day >= deadlineData.deadline.deadline_day);
        } else {
          setLineupLocked(false);
        }
      } else {
        setDeadline(null);
        setLineupLocked(false);
      }

      setTeam(teamData.team);

      // Build lineup map and bench list
      const lineupMap = {};
      const benchList = [];
      const players = [...(rosterData.starters || []), ...(rosterData.bench || [])];

      players.forEach((player) => {
        if (player.position_slot === 'BENCH') {
          benchList.push(player);
        } else {
          lineupMap[player.position_slot] = player;
        }
      });

      setLineup(lineupMap);
      setBench(benchList);
      setAllPlayers(players);
    } catch (error) {
      console.error('Error loading data:', error);
      setError('Failed to load lineup data');
    } finally {
      setLoading(false);
    }
  }

  async function saveLineup(lineupData, benchData) {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Build lineup array for API
      const lineupArray = requiredPositions.map((pos) => ({
        position_slot: pos.slot,
        player_id: lineupData[pos.slot]?.player_id || null,
      })).filter((item) => item.player_id !== null);

      await api.setTeamLineup(teamId, {
        week: lineupWeek,
        season: currentSeason,
        lineup: lineupArray,
      });

      setSuccess(`Saved`);

      // Clear success message after short delay
      setTimeout(() => {
        setSuccess('');
      }, 2000);
    } catch (error) {
      console.error('Error saving lineup:', error);
      setError(error.message || 'Failed to save lineup');
    } finally {
      setSaving(false);
    }
  }

  async function movePlayerToSlot(player, slot) {
    // Remove player from current position
    const newLineup = { ...lineup };
    const newBench = [...bench];

    // Remove from bench if present
    const benchIndex = newBench.findIndex((p) => p.player_id === player.player_id);
    if (benchIndex !== -1) {
      newBench.splice(benchIndex, 1);
    }

    // Remove from any lineup slot
    Object.keys(newLineup).forEach((key) => {
      if (newLineup[key]?.player_id === player.player_id) {
        delete newLineup[key];
      }
    });

    // If there was a player in the target slot, move them to bench
    if (newLineup[slot]) {
      newBench.push(newLineup[slot]);
    }

    // Add player to new slot
    newLineup[slot] = player;

    setLineup(newLineup);
    setBench(newBench);

    // Auto-save after state update
    await saveLineup(newLineup, newBench);
  }

  async function moveToBench(player) {
    const newLineup = { ...lineup };
    const newBench = [...bench];

    // Remove from lineup
    Object.keys(newLineup).forEach((key) => {
      if (newLineup[key]?.player_id === player.player_id) {
        delete newLineup[key];
      }
    });

    // Add to bench if not already there
    if (!newBench.find((p) => p.player_id === player.player_id)) {
      newBench.push(player);
    }

    setLineup(newLineup);
    setBench(newBench);

    // Auto-save after state update
    await saveLineup(newLineup, newBench);
  }

  function canPlayInSlot(player, positionSlot) {
    const posData = requiredPositions.find((p) => p.slot === positionSlot);
    if (!posData) return false;

    if (Array.isArray(posData.position)) {
      return posData.position.includes(player.player_position);
    }
    return player.player_position === posData.position;
  }

  function handleOpenStats(player, e) {
    e.stopPropagation();
    setSelectedPlayer(player);
    setIsStatsModalOpen(true);
  }

  function handleCloseStats() {
    setIsStatsModalOpen(false);
    setSelectedPlayer(null);
  }

  if (authLoading || loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!team) {
    return <div className="text-center py-12 text-gray-500">Team not found</div>;
  }

  if (currentWeek === 'Setup') {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">The season is being prepared. Lineup selection will open during Preseason.</p>
      </div>
    );
  }

  // Check if user owns this team
  if (team.user_email !== user.email) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">You can only set the lineup for your own team.</p>
        <Link href={`/teams/${teamId}`} className="text-link-600 hover:text-link-700 hover:underline mt-4 inline-block">
          ← Back to Team
        </Link>
      </div>
    );
  }

  const positionColors = {
    QB: 'pos-qb pos-border-qb',
    RB1: 'pos-rb pos-border-rb',
    RB2: 'pos-rb pos-border-rb',
    WR1: 'pos-wr pos-border-wr',
    WR2: 'pos-wr pos-border-wr',
    TE: 'pos-te pos-border-te',
    FLEX: 'pos-flex pos-border-flex',
    K: 'pos-k pos-border-k',
    DEF: 'pos-def pos-border-def',
  };

  // Button colors based on player position (for empty slots - use player's own position)
  const positionButtonColors = {
    QB: { filled: 'bg-pos-qb-800 text-white hover:opacity-90', empty: 'bg-pos-qb-100 text-pos-qb-800 hover:opacity-80' },
    RB: { filled: 'bg-pos-rb-800 text-white hover:opacity-90', empty: 'bg-pos-rb-100 text-pos-rb-800 hover:opacity-80' },
    WR: { filled: 'bg-pos-wr-800 text-white hover:opacity-90', empty: 'bg-pos-wr-100 text-pos-wr-800 hover:opacity-80' },
    TE: { filled: 'bg-pos-te-800 text-white hover:opacity-90', empty: 'bg-pos-te-100 text-pos-te-800 hover:opacity-80' },
    K: { filled: 'bg-pos-k-800 text-white hover:opacity-90', empty: 'bg-pos-k-100 text-pos-k-800 hover:opacity-80' },
    DEF: { filled: 'bg-pos-def-800 text-white hover:opacity-90', empty: 'bg-pos-def-100 text-pos-def-800 hover:opacity-80' },
    FLEX: { filled: 'bg-pos-flex-800 text-white hover:opacity-90', empty: 'bg-pos-flex-100 text-pos-flex-800 hover:opacity-80' },
  };

  // Get the base position from a slot (e.g., RB1 -> RB, WR2 -> WR)
  function getBasePosition(slot) {
    if (slot.startsWith('RB')) return 'RB';
    if (slot.startsWith('WR')) return 'WR';
    return slot;
  }

  // Get button style for moving a player to a slot
  function getSlotButtonStyle(playerPosition, targetSlot, isEmpty) {
    // For FLEX slot, use the player's own position color
    // For other slots, use the target slot's position color
    const colorPosition = targetSlot === 'FLEX' ? playerPosition : getBasePosition(targetSlot);
    const colors = positionButtonColors[colorPosition] || positionButtonColors.DEF;
    return isEmpty ? colors.filled : colors.empty;
  }

  // Bench renders in bench order (auto-sub priority) — the API returns rows
  // already sorted by bench_order, so the state array order IS the priority.
  // Ordering only means anything WITHIN a substitution group: RB/WR/TE all
  // compete for RB/WR/FLEX/TE slots so they order together, while a backup
  // QB/K/DEF can only ever fill its own slot (ordering a K against a WR was
  // meaningless — Chris, launch week).
  const sortedBench = bench;
  const BENCH_GROUPS = [
    { key: 'FLEX', label: 'RB / WR / TE (flex pool)', positions: ['RB', 'WR', 'TE'] },
    { key: 'QB', label: 'QB', positions: ['QB'] },
    { key: 'K', label: 'K', positions: ['K'] },
    { key: 'DEF', label: 'DEF', positions: ['DEF'] },
  ];
  const benchGroups = BENCH_GROUPS.map((g) => ({
    ...g,
    players: bench.filter((p) => g.positions.includes(p.player_position)),
  })).filter((g) => g.players.length > 0);

  async function moveBenchPlayer(groupKey, index, direction) {
    const group = benchGroups.find((g) => g.key === groupKey);
    if (!group) return;
    const target = index + direction;
    if (target < 0 || target >= group.players.length) return;
    const newGroupPlayers = [...group.players];
    [newGroupPlayers[index], newGroupPlayers[target]] = [newGroupPlayers[target], newGroupPlayers[index]];
    // Rebuild the global bench order as the groups concatenated — auto-subs
    // only compares order within slot-compatible candidates, so group-local
    // order is what matters.
    const newBench = benchGroups.flatMap((g) => (g.key === groupKey ? newGroupPlayers : g.players));
    setBench(newBench);
    try {
      await api.setBenchOrder(teamId, {
        week: lineupWeek,
        season: currentSeason,
        order: newBench.map((p) => p.player_id),
      });
      setSuccess('Saved');
      setTimeout(() => setSuccess(''), 2000);
    } catch (error) {
      console.error('Error saving bench order:', error);
      setError(error.message || 'Failed to save bench order');
      setBench(bench); // revert on failure
    }
  }

  return (
    <div className="space-y-6">
      <Link href={`/teams/${teamId}`} className="text-link-600 hover:text-link-700 hover:underline">
        ← Back to Team
      </Link>

      <div className="card">
        <h1 className="text-3xl font-bold mb-2">Lineup - {team.team_name}</h1>
        <p className="text-primary-700 font-semibold text-lg">
          {currentWeek === 'Preseason' ? 'Setting Week 1 lineup' : `Setting Week ${lineupWeek} lineup`}
        </p>
        <div className="mt-2">
          {lineupLocked ? (
            <div className="inline-flex items-center gap-2 bg-danger-100 border border-danger-400 text-danger-700 px-3 py-1.5 rounded text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Lineup locked — deadline has passed
              {deadline && (
                <span className="text-xs opacity-75">
                  ({new Date(deadline.deadline_datetime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} {new Date(deadline.deadline_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })})
                </span>
              )}
            </div>
          ) : deadline ? (
            <div className="inline-flex items-center gap-2 bg-primary-50 border border-primary-200 text-primary-600 px-3 py-1.5 rounded text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Deadline: {new Date(deadline.deadline_datetime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} {new Date(deadline.deadline_datetime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 text-gray-500 text-sm">
              Deadline: TBD
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="fixed bottom-4 right-4 bg-positive-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>{success}</span>
        </div>
      )}

      {/* Starting Lineup */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Starting Lineup</h2>
        <div className="space-y-3">
          {requiredPositions.map((pos) => {
            const player = lineup[pos.slot];
            return (
              <div
                key={pos.slot}
                className={`p-4 border-2 rounded-lg ${positionColors[pos.slot] || 'bg-gray-50 border-gray-300'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="font-bold text-sm w-16">{pos.slot}</span>
                    {player ? (
                      <>
                        <div className="flex-1 flex items-center gap-2">
                          <div>
                            <div className="font-semibold">{player.player_name}</div>
                            <div className="text-sm opacity-75">
                              {player.player_position} • <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle"><TeamLogo team={player.player_team} className="w-4 h-4 shrink-0" /> {player.player_team || 'N/A'}</span>
                              {player.opponent && (
                                <span className="ml-2 font-semibold text-primary-700">
                                  vs {player.opponent}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleOpenStats(player, e)}
                            className="text-primary-500 hover:text-primary-700 text-lg cursor-pointer"
                            title="View player stats"
                          >
                            ℹ️
                          </button>
                        </div>
                        {!lineupLocked && (
                          <button
                            onClick={() => moveToBench(player)}
                            className="btn-primary text-sm px-3 py-1"
                          >
                            Bench
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="flex-1">
                        <div className="text-gray-500 italic mb-2">{lineupLocked ? 'Empty slot (locked)' : 'Empty slot - Select a player:'}</div>
                        {!lineupLocked && <div className="flex gap-2 flex-wrap">
                          {sortedBench
                            .filter((benchPlayer) => canPlayInSlot(benchPlayer, pos.slot))
                            .map((benchPlayer) => (
                              <button
                                key={benchPlayer.player_id}
                                onClick={() => movePlayerToSlot(benchPlayer, pos.slot)}
                                className={`px-3 py-1.5 rounded text-sm transition-colors cursor-pointer ${positionButtonColors[benchPlayer.player_position]?.filled || 'bg-gray-600 text-white'}`}
                                title={benchPlayer.opponent ? `vs ${benchPlayer.opponent}` : ''}
                              >
                                <div className="flex flex-col items-start">
                                  <span>{benchPlayer.player_name}</span>
                                  {benchPlayer.opponent && (
                                    <span className="text-xs opacity-90">vs {benchPlayer.opponent}</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          {sortedBench.filter((benchPlayer) => canPlayInSlot(benchPlayer, pos.slot)).length === 0 && (
                            <span className="text-sm text-gray-400">No eligible players on bench</span>
                          )}
                        </div>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bench */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-1">Bench</h2>
        <p className="text-sm text-gray-500 mb-4">
          Bench order sets auto-sub priority — if a starter doesn&apos;t play, the first eligible bench player comes in.
        </p>
        {bench.length === 0 ? (
          <div className="text-gray-500">No players on bench</div>
        ) : (
          <div className="space-y-4">
            {benchGroups.map((group) => (
            <div key={group.key}>
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.label}</div>
              <div className="space-y-2">
              {group.players.map((player, benchIndex) => (
              <div
                key={player.player_id}
                className="p-4 bg-gray-50 border border-gray-200 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  {/* Ordering control sits OUTSIDE the stacking wrapper so
                      it centres against the whole card, name row and slot
                      buttons included. Fixed flex-centred boxes give the
                      arrows symmetric spacing round the number (the bare
                      glyphs carried uneven baseline space). */}
                  {group.players.length > 1 && (
                    <div className="flex flex-col items-center gap-0.5 shrink-0" title="Auto-sub priority within this group">
                      {!lineupLocked && (
                        <button
                          onClick={() => moveBenchPlayer(group.key, benchIndex, -1)}
                          disabled={benchIndex === 0}
                          className="h-5 w-6 flex items-center justify-center text-lg leading-none text-gray-400 hover:text-gray-700 disabled:opacity-25 disabled:cursor-default cursor-pointer"
                          title="Move up in sub priority"
                        >▲</button>
                      )}
                      <span className="w-6 h-6 flex items-center justify-center bg-gray-300 text-gray-700 rounded-full text-xs font-bold leading-none">
                        {benchIndex + 1}
                      </span>
                      {!lineupLocked && (
                        <button
                          onClick={() => moveBenchPlayer(group.key, benchIndex, 1)}
                          disabled={benchIndex === group.players.length - 1}
                          className="h-5 w-6 flex items-center justify-center text-lg leading-none text-gray-400 hover:text-gray-700 disabled:opacity-25 disabled:cursor-default cursor-pointer"
                          title="Move down in sub priority"
                        >▼</button>
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    {/* Position lives in the subtext line, matching the
                        Starting Lineup rows (badge dropped — it misaligned
                        rows and ate mobile width; Chris, Aug 2026). */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{player.player_name}</div>
                        <div className="text-sm text-gray-600">
                          {player.player_position} • <span className="inline-flex items-center gap-1 whitespace-nowrap align-middle"><TeamLogo team={player.player_team} className="w-4 h-4 shrink-0" /> {player.player_team || 'N/A'}</span>
                          {player.opponent && (
                            <span className="ml-2 font-semibold text-primary-700">
                              vs {player.opponent}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleOpenStats(player, e)}
                        className="text-primary-500 hover:text-primary-700 text-lg cursor-pointer"
                        title="View player stats"
                      >
                        ℹ️
                      </button>
                    </div>
                    {!lineupLocked && <div className="flex gap-2 flex-wrap">
                    {requiredPositions
                      .filter((pos) => canPlayInSlot(player, pos.slot))
                      .map((pos) => {
                        const currentPlayer = lineup[pos.slot];
                        const isEmpty = !currentPlayer;

                        return (
                          <button
                            key={pos.slot}
                            onClick={() => movePlayerToSlot(player, pos.slot)}
                            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors cursor-pointer ${getSlotButtonStyle(player.player_position, pos.slot, isEmpty)}`}
                            title={isEmpty ? `Add to ${pos.slot}` : `Swap with ${currentPlayer.player_name}`}
                          >
                            <div className="flex flex-col items-start">
                              <div className="text-xs">→ {pos.slot}</div>
                              {!isEmpty && (
                                <div className="text-[10px] opacity-90 truncate max-w-[100px]">
                                  (swap {currentPlayer.player_name})
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>}
                  </div>
                </div>
              </div>
              ))}
              </div>
            </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-save indicator */}
      {saving && (
        <div className="fixed bottom-4 right-4 bg-primary-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          <span>Saving...</span>
        </div>
      )}

      {/* Player Stats Modal */}
      <PlayerStatsModal
        player={selectedPlayer}
        isOpen={isStatsModalOpen}
        onClose={handleCloseStats}
      />
    </div>
  );
}
