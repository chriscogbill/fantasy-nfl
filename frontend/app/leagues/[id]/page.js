'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';

export default function LeagueDetailPage() {
  const params = useParams();
  const leagueId = params.id;
  const { user } = useAuth();

  const [league, setLeague] = useState(null);
  const [standings, setStandings] = useState([]);
  const [week, setWeek] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [copiedInviteCode, setCopiedInviteCode] = useState(false);

  async function copyInviteCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedInviteCode(true);
      setTimeout(() => setCopiedInviteCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function isUserAdmin() {
    return user && league && league.league_admin_email === user.email;
  }

  useEffect(() => {
    async function loadCurrentWeek() {
      try {
        const fetchedWeek = await api.getCurrentWeek();
        setCurrentWeek(fetchedWeek);
        // If preseason, default to week 1 for viewing purposes
        setWeek(fetchedWeek === 'Preseason' ? 1 : fetchedWeek);
      } catch (error) {
        console.error('Error loading current week:', error);
        setCurrentWeek('Preseason');
        setWeek(1); // Fallback to week 1
      }
    }
    loadCurrentWeek();
  }, []);

  useEffect(() => {
    if (leagueId && week !== null) {
      fetchLeagueData();
    }
  }, [leagueId, week]);

  async function fetchLeagueData() {
    setLoading(true);
    try {
      // Fetch league data
      const leagueData = await api.getLeague(leagueId);
      setLeague(leagueData.league);

      // Only fetch standings if we have a valid numeric week
      if (week !== 'Preseason' && !isNaN(week)) {
        try {
          const standingsData = await api.getLeagueStandings(leagueId, { week, season: 2024 });
          setStandings(standingsData.standings || []);
        } catch (standingsError) {
          console.error('Error fetching standings:', standingsError);
          setStandings([]);
        }
      } else {
        setStandings([]);
      }
    } catch (error) {
      console.error('Error fetching league data:', error);
      setLeague(null);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!league) {
    return <div className="text-center py-12 text-gray-500">League not found</div>;
  }

  const getRankColor = (rank) => {
    return 'text-gray-600';
  };

  const getRankEmoji = (rank) => {
    return `${rank}.`;
  };

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/leagues" className="text-link-600 hover:text-link-700 hover:underline">
        ← Back to Leagues
      </Link>

      {/* League Header */}
      <div className="card">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold mb-2">{league.league_name}</h1>
            <div className="text-gray-600">
              {league.current_teams} teams • Weeks {league.start_week}-{league.end_week}
            </div>
          </div>
          {isUserAdmin() && (
            <button
              onClick={() => setShowAdminModal(true)}
              className="text-gray-500 hover:text-gray-700 transition-colors flex items-center justify-center"
              title="League Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
        </div>
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
      </div>

      {/* Standings Table */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Standings</h2>

        {standings.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No standings data for this week
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">
                    Team
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">
                    Owner
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
                    Week Points
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
                    Total Points
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">
                    Roster Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {standings.map((standing) => {
                  // During preseason, all points should be 0
                  const displayWeekPoints = currentWeek === 'Preseason' ? 0 : standing.week_points;
                  const displayTotalPoints = currentWeek === 'Preseason' ? 0 : standing.total_points;

                  return (
                    <tr
                      key={standing.team_name}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-4">
                        <span className={`text-2xl font-bold ${getRankColor(standing.rank)}`}>
                          {getRankEmoji(standing.rank)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <Link href={`/teams/${standing.team_id}`} className="font-semibold text-link-600 hover:text-link-700 hover:underline">
                          {standing.team_name}
                        </Link>
                      </td>
                      <td className="px-4 py-4 text-gray-600 text-sm">
                        {standing.username}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="font-semibold text-primary-600">
                          {parseFloat(displayWeekPoints).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="font-bold text-lg">
                          {parseFloat(displayTotalPoints).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-positive-600 font-semibold">
                        ${parseFloat(standing.roster_value).toFixed(1)}M
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* League Admin Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold">League Settings</h2>
              <button
                onClick={() => {
                  setShowAdminModal(false);
                  setCopiedInviteCode(false);
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg mb-2">{league.league_name}</h3>
                <p className="text-sm text-gray-600">
                  Type: {league.privacy_type === 'private' ? 'Private' : 'Public'}
                </p>
              </div>

              {league.privacy_type === 'private' && league.invite_code && (
                <div className="bg-primary-50 border-2 border-primary-300 rounded-lg p-4">
                  <div className="text-center">
                    <div className="text-xs text-gray-600 mb-1">Invite Code</div>
                    <div className="text-3xl font-bold text-primary-600 tracking-wider mb-3">
                      {league.invite_code}
                    </div>
                    <button
                      onClick={() => copyInviteCode(league.invite_code)}
                      className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                        copiedInviteCode
                          ? 'bg-positive-500 text-white'
                          : 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                      }`}
                    >
                      {copiedInviteCode ? 'Copied!' : 'Copy Code'}
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mt-3 text-center">
                    Share this code with people you want to invite to your league.
                  </p>
                </div>
              )}

              <button
                onClick={() => {
                  setShowAdminModal(false);
                  setCopiedInviteCode(false);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
