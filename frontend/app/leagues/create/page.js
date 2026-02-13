'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/AuthContext';
import { api } from '../../../lib/api';

export default function CreateLeaguePage() {
  const [leagueName, setLeagueName] = useState('');
  const [privacyType, setPrivacyType] = useState('private');
  const [startWeek, setStartWeek] = useState(1);
  const [endWeek, setEndWeek] = useState(18);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdLeague, setCreatedLeague] = useState(null);
  const [copied, setCopied] = useState(false);
  const { user, currentSeason } = useAuth();
  const router = useRouter();

  // Redirect if not logged in
  if (!user) {
    router.push('/login');
    return null;
  }

  async function copyInviteCode() {
    if (createdLeague?.invite_code) {
      try {
        await navigator.clipboard.writeText(createdLeague.invite_code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.createLeague({
        leagueName,
        season: currentSeason,
        createdBy: user.email,
        leagueAdminEmail: user.email,
        privacyType,
        startWeek: parseInt(startWeek),
        endWeek: parseInt(endWeek)
      });

      setCreatedLeague(response.league);

      // For public leagues, redirect immediately
      // For private leagues, show the invite code first
      if (privacyType === 'public') {
        setTimeout(() => router.push(`/leagues/${response.league.league_id}`), 1500);
      }
    } catch (err) {
      setError(err.message || 'Failed to create league');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/leagues" className="text-link-600 hover:text-link-700 hover:underline mb-4 inline-block">
        ← Back to Leagues
      </Link>

      <div className="card">
        <h1 className="text-3xl font-bold mb-6">Create New League</h1>

        {error && (
          <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {createdLeague && createdLeague.privacy_type === 'private' ? (
          <div className="space-y-4">
            <div className="bg-positive-100 border border-positive-400 text-positive-700 px-4 py-3 rounded">
              League created successfully!
            </div>

            <div className="bg-primary-50 border-2 border-primary-300 rounded-lg p-6">
              <h3 className="text-xl font-bold mb-4">Private League Created</h3>
              <p className="text-gray-700 mb-4">
                Share this invite code with people you want to join your league:
              </p>
              <div className="bg-white border-2 border-primary-400 rounded-lg p-4 mb-4">
                <div className="text-center">
                  <div className="text-xs text-gray-600 mb-1">Invite Code</div>
                  <div className="text-3xl font-bold text-primary-600 tracking-wider mb-3">
                    {createdLeague.invite_code}
                  </div>
                  <button
                    onClick={copyInviteCode}
                    className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                      copied
                        ? 'bg-positive-500 text-white'
                        : 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                    }`}
                  >
                    {copied ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Players will need this code to join your private league.
              </p>
              <Link
                href={`/leagues/${createdLeague.league_id}`}
                className="block w-full btn-primary text-center"
              >
                Go to League
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                League Name *
              </label>
              <input
                type="text"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="e.g., Championship League"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                League Type *
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div
                  onClick={() => setPrivacyType('public')}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    privacyType === 'public'
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-300 hover:border-primary-300'
                  }`}
                >
                  <div className="font-semibold mb-1">Public League</div>
                  <div className="text-sm text-gray-600">
                    Anyone can join and view standings
                  </div>
                </div>
                <div
                  onClick={() => setPrivacyType('private')}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    privacyType === 'private'
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-300 hover:border-primary-300'
                  }`}
                >
                  <div className="font-semibold mb-1">Private League</div>
                  <div className="text-sm text-gray-600">
                    Invite-only with a unique code
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Week *
                </label>
                <select
                  value={startWeek}
                  onChange={(e) => setStartWeek(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>Week {w}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Week *
                </label>
                <select
                  value={endWeek}
                  onChange={(e) => setEndWeek(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                    <option key={w} value={w}>Week {w}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
              <h3 className="font-semibold mb-2">League Details</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• Created By: {user.username}</li>
                <li>• Season: {currentSeason || '...'}</li>
                <li>• Type: {privacyType === 'public' ? 'Public' : 'Private (invite-only)'}</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating League...' : 'Create League'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
