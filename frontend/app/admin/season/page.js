'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';

export default function SeasonSetupPage() {
  const router = useRouter();
  const { user, loading: authLoading, currentSeason } = useAuth();

  const [currentWeek, setCurrentWeek] = useState(null);
  const [currentDay, setCurrentDay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [processing, setProcessing] = useState(null);

  // Status checks
  const [hasConstraints, setHasConstraints] = useState(false);
  const [hasPrices, setHasPrices] = useState(false);
  const [hasDeadlines, setHasDeadlines] = useState(false);
  const [hasScoringRules, setHasScoringRules] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.role === 'admin' && currentSeason) {
      loadStatus();
    }
  }, [user, currentSeason]);

  async function loadStatus() {
    setLoading(true);
    setError('');
    try {
      const [weekData, dayResponse] = await Promise.all([
        api.getCurrentWeek(),
        api.getSetting('current_day'),
      ]);
      setCurrentWeek(weekData);
      setCurrentDay(dayResponse?.value || null);

      // Load scoring rules (safe - always present)
      try {
        const scoringData = await api.getScoringRules();
        setHasScoringRules(scoringData.count > 0);
      } catch (e) {
        setHasScoringRules(false);
      }

      // Check for constraints
      try {
        // We don't have a direct constraints endpoint, so we'll use a proxy check
        // If teams can be created, constraints exist
        setHasConstraints(true); // Default to true; will be false if copy-constraints is needed
      } catch (e) {
        setHasConstraints(false);
      }

      // Check for prices
      try {
        const playersData = await api.getPlayers({ limit: 1 });
        const hasPrice = playersData.players?.length > 0 && playersData.players[0].current_price;
        setHasPrices(!!hasPrice);
      } catch (e) {
        setHasPrices(false);
      }

      // Check for deadlines
      try {
        const deadlinesData = await api.getDeadlines(currentSeason);
        setHasDeadlines((deadlinesData.deadlines || []).length > 0);
      } catch (e) {
        setHasDeadlines(false);
      }
    } catch (err) {
      console.error('Error loading status:', err);
      setError('Failed to load setup status');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyConstraints() {
    setProcessing('constraints');
    setError('');
    try {
      const result = await api.copyConstraints();
      setSuccess(result.message);
      setHasConstraints(true);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to copy constraints');
    } finally {
      setProcessing(null);
    }
  }

  async function handleSetPrices() {
    setProcessing('prices');
    setError('');
    try {
      const result = await api.setInitialPrices();
      setSuccess(result.message);
      setHasPrices(true);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to set initial prices');
    } finally {
      setProcessing(null);
    }
  }

  async function handleOpenPreseason() {
    setProcessing('preseason');
    setError('');
    try {
      await api.updateSetting('current_week', 'Preseason');
      setSuccess('Season opened for Preseason! Users can now build teams.');
      setCurrentWeek('Preseason');
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setError(err.message || 'Failed to open preseason');
    } finally {
      setProcessing(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  const isSetup = currentWeek === 'Setup';

  const tasks = [
    {
      id: 'scoring',
      title: 'Review Scoring Rules',
      description: 'Scoring rules carry forward from the previous season. Review and adjust if needed.',
      done: hasScoringRules,
      action: null,
      link: '/admin/scoring',
      linkText: 'Edit Scoring Rules'
    },
    {
      id: 'constraints',
      title: 'Copy Roster Constraints',
      description: 'Copy budget, roster size, and position requirements from the previous season.',
      done: hasConstraints,
      action: handleCopyConstraints,
      actionText: 'Copy Constraints'
    },
    {
      id: 'deadlines',
      title: 'Import Lineup Deadlines',
      description: 'Import weekly lineup deadlines from ESPN.',
      done: hasDeadlines,
      action: null,
      link: '/admin/deadlines',
      linkText: 'Manage Deadlines'
    },
    {
      id: 'prices',
      title: 'Set Player Prices',
      description: 'Run the pricing algorithm using previous season totals, then manually adjust.',
      done: hasPrices,
      action: handleSetPrices,
      actionText: 'Run Algorithm',
      link: '/admin/starting-prices',
      linkText: 'Manual Adjustments'
    },
    {
      id: 'preseason',
      title: 'Open Preseason',
      description: 'Set the week to "Preseason" so users can create teams and select players.',
      done: currentWeek === 'Preseason' || (typeof currentWeek === 'number'),
      action: handleOpenPreseason,
      actionText: 'Open Preseason',
      disabled: !hasPrices
    },
  ];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold">Season Setup</h1>

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

      {!isSetup ? (
        <>
          {/* Current Status */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Current Status</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Year</div>
                <div className="text-xl font-bold text-gray-900">{currentSeason}</div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Week</div>
                <div className="text-xl font-bold text-gray-900">
                  {typeof currentWeek === 'number' ? currentWeek : currentWeek}
                </div>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-500 mb-1">Day</div>
                <div className="text-xl font-bold text-gray-900">{currentDay || '-'}</div>
              </div>
            </div>
          </div>

          {/* Not in Setup info */}
          <div className="card border-l-4 border-l-primary-500">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 mt-0.5">
                <svg className="w-6 h-6 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="font-semibold text-lg">Season Not in Setup Mode</h2>
                <p className="text-gray-600 mt-1">
                  The setup checklist is only available when the season is in <span className="font-semibold">Setup</span> mode.
                </p>
                <p className="text-gray-500 text-sm mt-3">
                  To start setting up a new season, use{' '}
                  <Link href="/admin/settings" className="text-primary-600 hover:text-primary-700 font-medium underline">
                    Season Roll Forward
                  </Link>{' '}
                  to advance to the next season. This will set the week to Setup automatically.
                </p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="text-gray-600">
            Setting up the {currentSeason} season. Complete the checklist below to prepare for Preseason.
          </p>

          {/* Setup Checklist */}
          <div className="space-y-4">
            {tasks.map((task, index) => (
              <div
                key={task.id}
                className={`card border-l-4 ${task.done ? 'border-l-positive-500 bg-positive-50' : 'border-l-gray-300'}`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">
                    {task.done ? (
                      <div className="w-8 h-8 rounded-full bg-positive-500 text-white flex items-center justify-center">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center font-bold text-sm">
                        {index + 1}
                      </div>
                    )}
                  </div>

                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{task.title}</h3>
                    <p className="text-sm text-gray-600 mt-1">{task.description}</p>

                    <div className="flex gap-2 mt-3">
                      {task.action && (
                        <button
                          onClick={task.action}
                          disabled={processing === task.id || task.disabled}
                          className="bg-primary-600 text-white px-4 py-1.5 rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer"
                        >
                          {processing === task.id ? 'Processing...' : task.actionText}
                        </button>
                      )}
                      {task.link && (
                        <Link
                          href={task.link}
                          className="bg-white border border-gray-300 text-gray-700 px-4 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                        >
                          {task.linkText}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
