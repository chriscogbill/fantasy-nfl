'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';
import PlayerStatsModal from '../../../components/PlayerStatsModal';

export default function TeamDetailPage() {
  const params = useParams();
  const teamId = params.id;
  const { user, currentSeason } = useAuth();

  const [team, setTeam] = useState(null);
  const [roster, setRoster] = useState(null);
  const [week, setWeek] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [seasonTotal, setSeasonTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);

  useEffect(() => {
    async function loadCurrentWeek() {
      try {
        const fetchedWeek = await api.getCurrentWeek();
        setCurrentWeek(fetchedWeek);
        // If Preseason, show Week 1 roster
        setWeek(fetchedWeek === 'Preseason' ? 1 : fetchedWeek);
      } catch (error) {
        console.error('Error loading current week:', error);
        setCurrentWeek(11);
        setWeek(11); // Fallback to week 11
      }
    }
    loadCurrentWeek();
  }, []);

  useEffect(() => {
    if (teamId && week !== null) {
      fetchTeamData();
    }
  }, [teamId, week]);

  async function fetchTeamData() {
    setLoading(true);
    try {
      const [teamData, rosterData] = await Promise.all([
        api.getTeam(teamId),
        api.getTeamRoster(teamId, { week, season: currentSeason }),
      ]);

      setTeam(teamData.team);
      setRoster(rosterData);

      // Use actual season total from backend (sum of all weeks)
      setSeasonTotal(teamData.team.season_total_points || 0);
    } catch (error) {
      console.error('Error fetching team data:', error);
    } finally {
      setLoading(false);
    }
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

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!team) {
    return <div className="text-center py-12 text-gray-500">Team not found</div>;
  }

  const positionColors = {
    QB: 'pos-qb',
    RB: 'pos-rb',
    RB1: 'pos-rb',
    RB2: 'pos-rb',
    WR: 'pos-wr',
    WR1: 'pos-wr',
    WR2: 'pos-wr',
    TE: 'pos-te',
    FLEX: 'pos-flex',
    K: 'pos-k',
    DEF: 'pos-def',
    BENCH: 'bg-gray-50 text-gray-600',
  };

  // During preseason, points should be 0 since no games have been played
  const weekTotal = currentWeek === 'Preseason' ? 0 : (roster?.totalPoints || 0);
  const displaySeasonTotal = currentWeek === 'Preseason' ? 0 : seasonTotal;

  return (
    <div className="space-y-6">
      {/* Back Button - Only show when viewing other teams */}
      {user && user.email !== team.user_email && (
        <Link href="/leagues" className="text-link-600 hover:text-link-700 hover:underline">
          ← Back to Leagues
        </Link>
      )}

      {/* Team Header */}
      <div className="card">
        <h1 className="text-3xl font-bold mb-2">{team.team_name}</h1>
        <div className="text-gray-600">Manager: {team.manager_name || 'Unknown'}</div>
      </div>

      {/* Points, Finances, and Team Management */}
      <div className={`grid grid-cols-1 gap-6 ${user && user.email === team.user_email ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {/* Points Box */}
        <div className="card">
          <h2 className="text-xl font-bold mb-4">Points</h2>
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-600 mb-1">
                {currentWeek === 'Preseason' ? 'Week 1' : `Week ${currentWeek}`}
              </div>
              <div className="text-4xl font-bold text-primary-600">
                {weekTotal.toFixed(2)}
              </div>
              {currentWeek === 'Preseason' && (
                <div className="text-xs text-gray-500 mt-1">No games played yet</div>
              )}
            </div>
            <div className="border-t border-gray-200 pt-4">
              <div className="text-sm text-gray-600 mb-1">Total</div>
              <div className="text-4xl font-bold text-positive-600">
                {displaySeasonTotal.toFixed(2)}
              </div>
              {currentWeek === 'Preseason' && (
                <div className="text-xs text-gray-500 mt-1">Season hasn't started</div>
              )}
            </div>
          </div>
        </div>

        {/* Finances Box */}
        <div className="card">
          <h2 className="text-xl font-bold mb-4">Finances</h2>
          <div className="space-y-4">
            <div>
              <div className="text-sm text-gray-600 mb-1">Team Value</div>
              <div className="text-4xl font-bold text-primary-600">
                ${parseFloat(team.current_value || 0).toFixed(1)}M
              </div>
              {/* Spacer to match Points box height during preseason */}
              {currentWeek === 'Preseason' && (
                <div className="text-xs text-transparent mt-1">Placeholder</div>
              )}
            </div>
            <div className="border-t border-gray-200 pt-4">
              <div className="text-sm text-gray-600 mb-1">Budget Remaining</div>
              <div className="text-4xl font-bold text-positive-600">
                ${parseFloat(team.remaining_budget).toFixed(1)}M
              </div>
              {/* Spacer to match Points box height during preseason */}
              {currentWeek === 'Preseason' && (
                <div className="text-xs text-transparent mt-1">Placeholder</div>
              )}
            </div>
          </div>
        </div>

        {/* Team Management Box - Only show for team owner */}
        {user && user.email === team.user_email && (
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Team Management</h2>
            <div className="space-y-4">
              <Link
                href={`/teams/${teamId}/transfers`}
                className="block p-4 bg-primary-50 border-2 border-primary-300 rounded-lg hover:bg-primary-100 transition-colors text-center"
              >
                <div className="text-2xl mb-1">🔄</div>
                <div className="font-bold">Make Transfers</div>
              </Link>

              <Link
                href={`/teams/${teamId}/lineup`}
                className="block p-4 bg-primary-50 border-2 border-primary-300 rounded-lg hover:bg-primary-100 transition-colors text-center"
              >
                <div className="text-2xl mb-1">📋</div>
                <div className="font-bold">Set Lineup</div>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Week Selector */}
      <div className="flex items-center gap-4">
        <label className="font-medium">Week:</label>
        <select
          value={week}
          onChange={(e) => setWeek(parseInt(e.target.value))}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
        {roster && (
          <div className="ml-auto text-lg font-semibold">
            Total Points:{' '}
            <span className="text-primary-600">
              {currentWeek === 'Preseason' ? '0.00' : roster.totalPoints.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Starting Lineup */}
      {roster && (
        <>
          <div className="card">
            <h2 className="text-2xl font-bold mb-4">Starting Lineup</h2>
            <div className="space-y-2">
              {roster.starters.length === 0 ? (
                <div className="text-gray-500">No starters set for this week</div>
              ) : (
                roster.starters.map((player) => {
                  const displayPoints = currentWeek === 'Preseason' ? 0 : (player.week_points || 0);
                  const displayAvg = currentWeek === 'Preseason' ? 0 : (player.season_avg || 0);

                  return (
                    <div
                      key={player.player_id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-3 py-1 text-sm font-semibold rounded ${
                            positionColors[player.position_slot] || 'bg-gray-100'
                          }`}
                        >
                          {player.position_slot}
                        </span>
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-semibold">{player.player_name}</div>
                            <div className="text-sm text-gray-600">
                              {player.player_position} • ${player.current_price}M
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleOpenStats(player, e)}
                            className="text-primary-500 hover:text-primary-700 text-lg"
                            title="View player stats"
                          >
                            ℹ️
                          </button>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-primary-600">
                          {parseFloat(displayPoints).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">
                          Avg: {displayAvg ? parseFloat(displayAvg).toFixed(1) : '-'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Bench */}
          <div className="card">
            <h2 className="text-2xl font-bold mb-4">Bench</h2>
            <div className="space-y-2">
              {roster.bench.length === 0 ? (
                <div className="text-gray-500">No bench players</div>
              ) : (
                roster.bench.map((player) => {
                  const displayPoints = currentWeek === 'Preseason' ? 0 : (player.week_points || 0);
                  const displayAvg = currentWeek === 'Preseason' ? 0 : (player.season_avg || 0);

                  return (
                    <div
                      key={player.player_id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`px-3 py-1 text-sm font-semibold rounded ${
                            positionColors[player.player_position] || 'bg-gray-100'
                          }`}
                        >
                          {player.player_position}
                        </span>
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="font-semibold">{player.player_name}</div>
                            <div className="text-sm text-gray-600">
                              ${player.current_price}M
                            </div>
                          </div>
                          <button
                            onClick={(e) => handleOpenStats(player, e)}
                            className="text-primary-500 hover:text-primary-700 text-lg"
                            title="View player stats"
                          >
                            ℹ️
                          </button>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-gray-600">
                          {parseFloat(displayPoints).toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">
                          Avg: {displayAvg ? parseFloat(displayAvg).toFixed(1) : '-'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
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
