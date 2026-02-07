'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/AuthContext';
import { api } from '../../../lib/api';

export default function CreateTeamPage() {
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const router = useRouter();

  // Redirect if not logged in
  if (!user) {
    router.push('/login');
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.createTeam({
        teamName,
        userEmail: user.email,
        season: 2024
      });

      // Redirect to transfers page to build initial roster
      router.push(`/teams/${response.team.team_id}/transfers`);
    } catch (err) {
      setError(err.message || 'Failed to create team');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/teams" className="text-link-600 hover:text-link-700 hover:underline mb-4 inline-block">
        ← Back to Teams
      </Link>

      <div className="card">
        <h1 className="text-3xl font-bold mb-6">Create New Team</h1>

        {error && (
          <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Team Name *
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., The Touchdown Kings"
            />
            <p className="text-sm text-gray-500 mt-1">
              Choose a unique name for your fantasy team
            </p>
          </div>

          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Team Details</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Owner: {user.username} ({user.email})</li>
              <li>• Season: 2024</li>
              <li>• Starting Budget: $100.0M</li>
              <li>• Roster Size: 15 players</li>
            </ul>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Roster Requirements</h3>
            <div className="text-sm text-gray-700 space-y-1 mb-3">
              <div>Minimum requirements:</div>
              <div className="grid grid-cols-2 gap-2 pl-4">
                <div>• 1 Quarterback (QB)</div>
                <div>• 3 Running Backs (RB)</div>
                <div>• 3 Wide Receivers (WR)</div>
                <div>• 1 Tight End (TE)</div>
                <div>• 1 Kicker (K)</div>
                <div>• 1 Defense (DEF)</div>
              </div>
              <div className="pt-2 font-semibold">
                Total: 15 players (remaining 5 can be any position)
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating Team...' : 'Create Team'}
          </button>
        </form>

        <p className="text-sm text-gray-600 mt-6 text-center">
          After creating your team, you can browse players and build your roster!
        </p>
      </div>
    </div>
  );
}
