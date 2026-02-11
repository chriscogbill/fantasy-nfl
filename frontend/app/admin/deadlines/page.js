'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';

export default function DeadlinesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [deadlines, setDeadlines] = useState([]);
  const [season, setSeason] = useState(2024);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingWeek, setEditingWeek] = useState(null);
  const [editDatetime, setEditDatetime] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchDeadlines();
    }
  }, [user, season]);

  async function fetchDeadlines() {
    setLoading(true);
    try {
      const data = await api.getDeadlines(season);
      setDeadlines(data.deadlines || []);
    } catch (err) {
      console.error('Error fetching deadlines:', err);
      setError('Failed to load deadlines');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.importDeadlines(season);
      const imported = result.results.filter(r => r.status === 'imported').length;
      setSuccess(`Imported deadlines for ${imported} weeks from ESPN`);
      await fetchDeadlines();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      console.error('Error importing deadlines:', err);
      setError('Failed to import deadlines from ESPN');
    } finally {
      setImporting(false);
    }
  }

  function startEditing(week) {
    const existing = deadlines.find(d => d.week === week);
    if (existing) {
      // Format datetime for input (local time)
      const dt = new Date(existing.deadline_datetime);
      const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
      setEditDatetime(local.toISOString().slice(0, 16));
      setEditDescription(existing.description || '');
    } else {
      setEditDatetime('');
      setEditDescription('');
    }
    setEditingWeek(week);
  }

  async function handleSave(week) {
    if (!editDatetime) {
      setError('Please enter a date and time');
      return;
    }
    setError('');
    try {
      await api.updateDeadline(season, week, {
        deadline_datetime: new Date(editDatetime).toISOString(),
        description: editDescription,
      });
      setEditingWeek(null);
      await fetchDeadlines();
      setSuccess(`Updated deadline for Week ${week}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error saving deadline:', err);
      setError('Failed to save deadline');
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

  // Build a map of week -> deadline for easy lookup
  const deadlineMap = {};
  deadlines.forEach(d => { deadlineMap[d.week] = d; });

  const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Lineup Deadlines</h1>
        <div className="flex items-center gap-3">
          <select
            value={season}
            onChange={(e) => setSeason(parseInt(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value={2024}>2024</option>
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
          </select>
          <button
            onClick={handleImport}
            disabled={importing}
            className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 cursor-pointer disabled:cursor-not-allowed"
          >
            {importing ? 'Importing...' : 'Import from ESPN'}
          </button>
        </div>
      </div>

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

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b-2 border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 w-20">Week</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Deadline</th>
              <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600 w-20">Day</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Description</th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {Array.from({ length: 18 }, (_, i) => i + 1).map((week) => {
              const deadline = deadlineMap[week];
              const isEditing = editingWeek === week;

              return (
                <tr key={week} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-semibold">Week {week}</span>
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        type="datetime-local"
                        value={editDatetime}
                        onChange={(e) => setEditDatetime(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 text-sm"
                      />
                    ) : deadline ? (
                      <span className="text-sm">
                        {new Date(deadline.deadline_datetime).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                        })}{' '}
                        {new Date(deadline.deadline_datetime).toLocaleTimeString('en-US', {
                          hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
                        })}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {deadline ? (
                      <span className="inline-flex items-center px-2 py-1 bg-primary-100 text-primary-700 rounded text-xs font-medium">
                        {dayNames[deadline.deadline_day] || deadline.deadline_day}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        placeholder="e.g. Thursday Night Football"
                        className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 text-sm w-full"
                      />
                    ) : (
                      <span className="text-sm text-gray-600">{deadline?.description || '-'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handleSave(week)}
                          className="text-positive-600 hover:text-positive-800 text-sm font-medium cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingWeek(null)}
                          className="text-gray-500 hover:text-gray-700 text-sm font-medium cursor-pointer ml-2"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(week)}
                        className="text-primary-600 hover:text-primary-800 text-sm font-medium cursor-pointer"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
