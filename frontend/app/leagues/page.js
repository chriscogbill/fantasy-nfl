'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';

export default function LeaguesPage() {
  const { user, currentSeason } = useAuth();
  const [leagues, setLeagues] = useState([]);
  const [userTeam, setUserTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(null); // league object or null
  const [copiedInviteCode, setCopiedInviteCode] = useState(false);

  useEffect(() => {
    if (currentSeason) fetchData();
  }, [user, currentSeason]);

  async function fetchData() {
    setLoading(true);
    try {
      // Fetch leagues
      const leaguesData = await api.getLeagues({ season: currentSeason });
      const allLeagues = leaguesData.leagues || [];

      // Fetch user's team if logged in
      if (user) {
        const teamsData = await api.getTeams({ season: currentSeason });
        const myTeam = teamsData.teams?.find(t => t.user_email === user.email);
        setUserTeam(myTeam || null);

        // Fetch detailed info for each league to check membership
        if (myTeam) {
          const leaguesWithMembership = await Promise.all(
            allLeagues.map(async (league) => {
              try {
                const detailedLeague = await api.getLeague(league.league_id);
                const isInLeague = detailedLeague.league.teams?.some(t => t.team_id === myTeam.team_id);
                return { ...league, isUserInLeague: isInLeague };
              } catch (error) {
                console.error(`Error fetching league ${league.league_id}:`, error);
                return { ...league, isUserInLeague: false };
              }
            })
          );
          setLeagues(leaguesWithMembership);
        } else {
          setLeagues(allLeagues);
        }
      } else {
        setUserTeam(null);
        setLeagues(allLeagues);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }

  // Separate leagues by privacy type
  const publicLeagues = leagues.filter(l => l.privacy_type === 'public');

  // Only show private leagues the user is in
  const privateLeagues = user && userTeam
    ? leagues.filter(l => l.privacy_type === 'private' && l.isUserInLeague)
    : [];

  const statusColors = {
    open: 'bg-positive-100 text-positive-800',
    active: 'bg-primary-100 text-primary-800',
    closed: 'bg-gray-100 text-gray-800',
  };

  async function copyInviteCode(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedInviteCode(true);
      setTimeout(() => setCopiedInviteCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  function isUserAdmin(league) {
    return user && league.league_admin_email === user.email;
  }

  const renderLeagueTable = (leagueList) => (
    <div className="card overflow-x-auto">
      <table className="w-full table-fixed">
        <thead className="bg-gray-50 border-b-2 border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">League Name</th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600 w-20">Teams</th>
            <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600 w-24">Weeks</th>
            <th className="px-2 py-3 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {leagueList.map((league) => (
            <tr key={league.league_id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-4">
                <Link href={`/leagues/${league.league_id}`} className="font-semibold text-link-600 hover:text-link-700 hover:underline">
                  {league.league_name}
                </Link>
              </td>
              <td className="px-4 py-4 text-center">
                <span className="font-semibold">
                  {league.current_teams}
                </span>
              </td>
              <td className="px-4 py-4 text-center text-gray-600">
                {league.start_week} - {league.end_week}
              </td>
              <td className="px-2 py-4">
                {isUserAdmin(league) && (
                  <button
                    onClick={() => setShowAdminModal(league)}
                    className="text-gray-500 hover:text-gray-700 transition-colors flex items-center justify-center"
                    title="League Settings"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Leagues</h1>
        {user && (
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowJoinModal(true)}
              className="btn-primary"
            >
              Join a League
            </button>
            <Link href="/leagues/create" className="btn-primary">
              Create a League
            </Link>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : leagues.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No leagues found.</div>
      ) : (
        <>
          {/* Private Leagues - Only show if user is logged in */}
          {user && (
            <div>
              <h2 className="text-2xl font-bold mb-4">Private Leagues</h2>
              {privateLeagues.length === 0 ? (
                <div className="text-center py-8 text-gray-500">You are not in any private leagues.</div>
              ) : (
                renderLeagueTable(privateLeagues)
              )}
            </div>
          )}

          {/* Public Leagues */}
          <div>
            <h2 className="text-2xl font-bold mb-4">Public Leagues</h2>
            {publicLeagues.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No public leagues found.</div>
            ) : (
              renderLeagueTable(publicLeagues)
            )}
          </div>
        </>
      )}

      {/* Join League Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold">Join a Private League</h2>
              <button
                onClick={() => {
                  setShowJoinModal(false);
                  setInviteCode('');
                  setJoinError('');
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            {joinError && (
              <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded mb-4">
                {joinError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="Enter invite code"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent uppercase tracking-wider"
                  maxLength={8}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter the invite code provided by the league creator
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowJoinModal(false);
                    setInviteCode('');
                    setJoinError('');
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!userTeam) {
                      setJoinError('You need to create a team before joining a league.');
                      return;
                    }

                    setJoining(true);
                    setJoinError('');

                    try {
                      // Call the join league by code API
                      const result = await api.joinLeagueByCode(userTeam.team_id, inviteCode);

                      // Success - redirect to the league page
                      window.location.href = `/leagues/${result.league_id}`;
                    } catch (error) {
                      setJoinError(error.message || 'Failed to join league. Please check the invite code and try again.');
                    } finally {
                      setJoining(false);
                    }
                  }}
                  disabled={!inviteCode || joining}
                  className="flex-1 btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {joining ? 'Joining...' : 'Join League'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* League Admin Modal */}
      {showAdminModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-2xl font-bold">League Settings</h2>
              <button
                onClick={() => {
                  setShowAdminModal(null);
                  setCopiedInviteCode(false);
                }}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-lg mb-2">{showAdminModal.league_name}</h3>
                <p className="text-sm text-gray-600">
                  Type: {showAdminModal.privacy_type === 'private' ? 'Private' : 'Public'}
                </p>
              </div>

              {showAdminModal.privacy_type === 'private' && showAdminModal.invite_code && (
                <div className="bg-primary-50 border-2 border-primary-300 rounded-lg p-4">
                  <div className="text-center">
                    <div className="text-xs text-gray-600 mb-1">Invite Code</div>
                    <div className="text-3xl font-bold text-primary-600 tracking-wider mb-3">
                      {showAdminModal.invite_code}
                    </div>
                    <button
                      onClick={() => copyInviteCode(showAdminModal.invite_code)}
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
                  setShowAdminModal(null);
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
