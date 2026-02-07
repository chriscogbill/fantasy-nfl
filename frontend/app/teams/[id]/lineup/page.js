'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/AuthContext';
import PlayerStatsModal from '../../../../components/PlayerStatsModal';

export default function LineupPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.id;
  const { user, loading: authLoading } = useAuth();

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

  // Lineup week is next week (or Week 1 during Preseason)
  const lineupWeek = currentWeek !== null
    ? (currentWeek === 'Preseason' ? 1 : parseInt(currentWeek) + 1)
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
      const week = await api.getCurrentWeek();
      setCurrentWeek(week);

      const displayWeek = week === 'Preseason' ? 1 : parseInt(week) + 1;

      const [teamData, rosterData] = await Promise.all([
        api.getTeam(teamId),
        api.getTeamRoster(teamId, { week: displayWeek, season: 2024 }).catch(() => ({
          starters: [],
          bench: [],
        })),
      ]);

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
        season: 2024,
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

  // Position order for sorting
  const positionOrder = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6 };

  // Sort bench players by position then price (highest first)
  const sortedBench = [...bench].sort((a, b) => {
    const posA = positionOrder[a.player_position] || 99;
    const posB = positionOrder[b.player_position] || 99;
    if (posA !== posB) return posA - posB;
    return parseFloat(b.current_price || 0) - parseFloat(a.current_price || 0);
  });

  return (
    <div className="space-y-6">
      <Link href={`/teams/${teamId}`} className="text-link-600 hover:text-link-700 hover:underline">
        ← Back to Team
      </Link>

      <div className="card">
        <h1 className="text-3xl font-bold mb-2">Lineup - {team.team_name}</h1>
        <p className="text-primary-700 font-semibold text-lg mb-4">
          {currentWeek === 'Preseason' ? 'Setting Week 1 lineup' : `Setting Week ${lineupWeek} lineup`}
        </p>
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
                              {player.player_position} • {player.player_team || 'N/A'}
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
                        <button
                          onClick={() => moveToBench(player)}
                          className="btn-primary text-sm px-3 py-1"
                        >
                          Bench
                        </button>
                      </>
                    ) : (
                      <div className="flex-1">
                        <div className="text-gray-500 italic mb-2">Empty slot - Select a player:</div>
                        <div className="flex gap-2 flex-wrap">
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
                        </div>
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
        <h2 className="text-2xl font-bold mb-4">Bench</h2>
        {bench.length === 0 ? (
          <div className="text-gray-500">No players on bench</div>
        ) : (
          <div className="space-y-2">
            {sortedBench.map((player) => (
              <div
                key={player.player_id}
                className="p-4 bg-gray-50 border border-gray-200 rounded-lg"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm font-semibold">
                      {player.player_position}
                    </span>
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="font-semibold">{player.player_name}</div>
                        <div className="text-sm text-gray-600">
                          {player.player_team || 'N/A'}
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
                  </div>
                  <div className="flex gap-2 flex-wrap">
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
                  </div>
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
