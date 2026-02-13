'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading, currentSeason, refreshSeason } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Confirmation modals
  const [showRollForward, setShowRollForward] = useState(false);
  const [showRollBack, setShowRollBack] = useState(false);
  const [showClearData, setShowClearData] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  async function handleRollForward() {
    setProcessing(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.rollForwardSeason();
      setSuccess(result.message);
      setShowRollForward(false);
      // Refresh season in context and reload
      await refreshSeason();
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError(err.message || 'Failed to roll forward season');
    } finally {
      setProcessing(false);
    }
  }

  async function handleRollBack() {
    setProcessing(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.rollBackSeason();
      setSuccess(result.message);
      setShowRollBack(false);
      await refreshSeason();
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError(err.message || 'Failed to roll back season');
    } finally {
      setProcessing(false);
    }
  }

  async function handleClearData() {
    setProcessing(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.clearSeasonData(currentSeason);
      setSuccess(result.message);
      setShowClearData(false);
    } catch (err) {
      setError(err.message || 'Failed to clear test data');
    } finally {
      setProcessing(false);
    }
  }

  if (authLoading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  const nextSeason = currentSeason ? currentSeason + 1 : null;
  const prevSeason = currentSeason ? currentSeason - 1 : null;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold">Season Roll Forward</h1>

      {error && (
        <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-positive-100 border border-positive-400 text-positive-700 px-4 py-3 rounded">
          {success}
        </div>
      )}

      {/* Season Management */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Season Management</h2>
        <div className="flex items-center gap-4 mb-6">
          <span className="text-gray-600">Current Season:</span>
          <span className="text-4xl font-bold text-primary-600">{currentSeason || '...'}</span>
        </div>

        <div className="space-y-4">
          {/* Roll Forward */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-lg">Roll Forward to {nextSeason}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Archives current season data (stats, prices, scoring rules) and advances to {nextSeason}.
                  Sets week to &quot;Setup&quot; mode.
                </p>
              </div>
              <button
                onClick={() => setShowRollForward(true)}
                className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                Roll Forward
              </button>
            </div>
          </div>

          {/* Roll Back */}
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-lg">Roll Back to {prevSeason}</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Sets the current season back to {prevSeason}. Does NOT restore archived data.
                  For testing purposes only.
                </p>
              </div>
              <button
                onClick={() => setShowRollBack(true)}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                Roll Back
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Clear Test Data */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Clear Test Data</h2>
        <p className="text-gray-600 mb-4">
          Remove all teams, leagues, transfers, and rosters for the current season ({currentSeason}).
          Player data, scoring rules, and archived data are preserved.
        </p>

        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-4">
          <p className="text-yellow-800 text-sm font-medium mb-2">This will delete:</p>
          <ul className="text-yellow-700 text-sm space-y-1">
            <li>- League standings and entries</li>
            <li>- Rosters and transfers</li>
            <li>- Leagues and teams</li>
            <li>- Current player prices and price history</li>
          </ul>
          <p className="text-yellow-800 text-sm font-medium mt-3">Preserved:</p>
          <ul className="text-yellow-700 text-sm space-y-1">
            <li>- Players, player stats, scoring rules</li>
            <li>- Users, roster constraints, fixtures, deadlines</li>
            <li>- All archived data from previous seasons</li>
          </ul>
        </div>

        <button
          onClick={() => setShowClearData(true)}
          className="bg-danger-600 text-white px-4 py-2 rounded-lg hover:bg-danger-700 transition-colors cursor-pointer"
        >
          Clear Test Data
        </button>
      </div>

      {/* Roll Forward Confirmation Modal */}
      {showRollForward && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4">Roll Forward to {nextSeason}?</h2>
            <p className="text-gray-600 mb-4">This will:</p>
            <ol className="text-sm text-gray-700 space-y-2 mb-6">
              <li>1. Compute player season totals from current stats</li>
              <li>2. Archive player stats to player_stats_archive</li>
              <li>3. Archive player prices to player_prices_archive</li>
              <li>4. Archive scoring rules to scoring_archive</li>
              <li>5. Clear current stats and prices tables</li>
              <li>6. Set season to {nextSeason} and week to &quot;Setup&quot;</li>
            </ol>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRollForward(false)}
                disabled={processing}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRollForward}
                disabled={processing}
                className="flex-1 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:bg-gray-400 cursor-pointer"
              >
                {processing ? 'Processing...' : 'Confirm Roll Forward'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Roll Back Confirmation Modal */}
      {showRollBack && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4">Roll Back to {prevSeason}?</h2>
            <p className="text-gray-600 mb-4">
              This will set the current season back to {prevSeason}. Archived data is NOT restored.
              This is intended for testing only.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowRollBack(false)}
                disabled={processing}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRollBack}
                disabled={processing}
                className="flex-1 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:bg-gray-400 cursor-pointer"
              >
                {processing ? 'Processing...' : 'Confirm Roll Back'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear Data Confirmation Modal */}
      {showClearData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold mb-4">Clear Test Data?</h2>
            <p className="text-gray-600 mb-4">
              This will delete all teams, leagues, transfers, rosters, and current pricing data for season {currentSeason}.
              This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowClearData(false)}
                disabled={processing}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleClearData}
                disabled={processing}
                className="flex-1 bg-danger-600 text-white px-4 py-2 rounded-lg hover:bg-danger-700 disabled:bg-gray-400 cursor-pointer"
              >
                {processing ? 'Clearing...' : 'Confirm Clear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
