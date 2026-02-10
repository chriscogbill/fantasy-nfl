'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/AuthContext';

export default function Home() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    teams: 0,
    leagues: 0,
    players: 0,
  });
  const [userTeams, setUserTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [teamData, setTeamData] = useState(null);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [teamsData, leaguesData, playersData, settingsData] = await Promise.all([
          api.getTeams({ season: 2024 }),
          api.getLeagues({ season: 2024 }),
          api.getPlayers({ limit: 1 }),
          api.getSettings(),
        ]);

        setStats({
          teams: teamsData.count,
          leagues: leaguesData.count,
          players: '800+', // Estimated
        });
        setSettings(settingsData);
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, []);

  useEffect(() => {
    async function fetchUserTeams() {
      if (user) {
        try {
          const teamsData = await api.getTeams({ season: 2024 });
          const myTeams = teamsData.teams?.filter(t => t.user_email === user.email) || [];
          setUserTeams(myTeams);

          // Fetch detailed team data if user has a team
          if (myTeams.length > 0) {
            const teamDetail = await api.getTeamRoster(myTeams[0].team_id);
            setTeamData(teamDetail);
          }
        } catch (error) {
          console.error('Error fetching user teams:', error);
        }
      }
    }

    fetchUserTeams();
  }, [user]);

  return (
    <div className="space-y-12">
      {/* Hero Section */}
      <div className="text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Fantasy NFL
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          Build your dream team within a $100 million budget
        </p>
        {user && userTeams.length === 0 && (
          <div className="bg-primary-50 border border-primary-300 rounded-lg p-4 mb-6 max-w-2xl mx-auto">
            <p className="text-primary-900 font-semibold mb-2">
              Welcome, {user.username}! You don't have a team yet.
            </p>
            <p className="text-primary-700 text-sm mb-3">
              Create your first team to start playing Fantasy NFL!
            </p>
            <Link href="/teams/create" className="btn-primary inline-block">
              Create Your Team
            </Link>
          </div>
        )}
        {user && userTeams.length > 0 && parseInt(userTeams[0].roster_count) < 15 && (
          <div className="bg-primary-50 border border-primary-300 rounded-lg p-6 mb-6 max-w-3xl mx-auto">
            <p className="text-primary-900 font-semibold mb-2">
              Welcome, {user.username}!
            </p>
            <p className="text-primary-700 text-sm mb-4">
              Your team <span className="font-semibold">{userTeams[0].team_name}</span> needs players. Select your 15-player squad to get started.
            </p>
            <Link href={`/teams/${userTeams[0].team_id}/transfers`} className="btn-primary inline-block text-lg px-8 py-3">
              Buy Players
            </Link>
          </div>
        )}
        {user && userTeams.length > 0 && parseInt(userTeams[0].roster_count) >= 15 && (
          <div className="bg-positive-50 border border-positive-300 rounded-lg p-6 mb-6 max-w-3xl mx-auto">
            <p className="text-positive-900 font-semibold mb-2">
              Welcome back, {user.username}!
            </p>
            <p className="text-positive-700 text-sm mb-4">
              Manage your team: {userTeams[0].team_name}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col items-center">
                <div className="text-4xl mb-2">📊</div>
                <Link href={`/teams/${userTeams[0].team_id}`} className="btn-primary w-full text-center mb-2">
                  View Your Points
                </Link>
                <span className="text-sm text-gray-600">
                  GW{settings?.current_week || '-'}: {teamData?.gameweek_points?.toFixed(1) || '0.0'} pts
                </span>
              </div>
              <div className="flex flex-col items-center">
                <div className="text-4xl mb-2">🔄</div>
                <Link href={`/teams/${userTeams[0].team_id}/transfers`} className="btn-primary w-full text-center mb-2">
                  Make Transfers
                </Link>
                <span className="text-sm text-gray-600">
                  Team Value: ${teamData?.team_value?.toFixed(1) || '100.0'}M
                </span>
              </div>
              <div className="flex flex-col items-center">
                <div className="text-4xl mb-2">📋</div>
                <Link href={`/teams/${userTeams[0].team_id}/lineup`} className="btn-primary w-full text-center mb-2">
                  Set Starting Lineup
                </Link>
                <span className="text-sm text-gray-600">
                  Deadline: {settings?.lineup_deadline || 'TBD'}
                </span>
              </div>
            </div>
          </div>
        )}
        <div className="flex gap-4 justify-center">
          {!user && (
            <Link href="/login" className="btn-primary">
              Login / Register
            </Link>
          )}
          <Link href="/players" className="btn-primary">
            Browse Players
          </Link>
          <Link href="/leagues" className="btn-primary">
            View Leagues
          </Link>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="stat-box">
            <div className="text-4xl font-bold text-primary-600">
              {loading ? '...' : stats.teams}
            </div>
            <div className="text-gray-600 mt-2">Active Teams</div>
          </div>
        </div>
        <div className="card">
          <div className="stat-box">
            <div className="text-4xl font-bold text-positive-600">
              {loading ? '...' : stats.leagues}
            </div>
            <div className="text-gray-600 mt-2">Active Leagues</div>
          </div>
        </div>
        <div className="card">
          <div className="stat-box">
            <div className="text-4xl font-bold text-primary-600">
              {loading ? '...' : stats.players}
            </div>
            <div className="text-gray-600 mt-2">NFL Players</div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">How It Works</h2>
        <ol className="space-y-3 text-gray-700">
          <li className="flex items-start">
            <span className="font-bold text-primary-600 mr-3">1.</span>
            <span>Create a team with $100 million budget</span>
          </li>
          <li className="flex items-start">
            <span className="font-bold text-primary-600 mr-3">2.</span>
            <span>Buy 15 players for your roster (minimum 1 QB, 3 RB, 3 WR, 1 TE, 1 K, 1 DEF)</span>
          </li>
          <li className="flex items-start">
            <span className="font-bold text-primary-600 mr-3">3.</span>
            <span>Set your weekly starting lineup (1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF)</span>
          </li>
          <li className="flex items-start">
            <span className="font-bold text-primary-600 mr-3">4.</span>
            <span>Make transfers week-to-week to improve your team</span>
          </li>
          <li className="flex items-start">
            <span className="font-bold text-primary-600 mr-3">5.</span>
            <span>Compete in leagues and climb the standings!</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
