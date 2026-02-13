'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';

// Display names for scoring_type database values
const SCORING_TYPE_LABELS = {
  passing_yard: 'Passing Yard',
  passing_td: 'Passing TD',
  interception: 'Interception',
  rushing_yard: 'Rushing Yard',
  rushing_td: 'Rushing TD',
  reception: 'Reception',
  receiving_yard: 'Receiving Yard',
  receiving_td: 'Receiving TD',
  kicking_xp: 'Extra Point',
  kicking_miss: 'Missed Kick',
  fg_0_19: 'FG 0-19 Yards',
  fg_20_29: 'FG 20-29 Yards',
  fg_30_39: 'FG 30-39 Yards',
  fg_40_49: 'FG 40-49 Yards',
  fg_50p: 'FG 50+ Yards',
  defence_td: 'Defensive TD',
  defence_0pt: 'Shutout (0 Pts Allowed)',
  defence_pta: 'Point Allowed',
  fumble_lost: 'Fumble Lost',
};

export default function ScoringRulesPage() {
  const router = useRouter();
  const { user, loading: authLoading, currentSeason } = useAuth();

  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Track which rule is being edited and its draft value
  const [editingRule, setEditingRule] = useState(null);
  const [editValue, setEditValue] = useState('');

  // Archive viewing
  const [archiveSeason, setArchiveSeason] = useState(null);
  const [archiveSections, setArchiveSections] = useState([]);
  const [archiveLoading, setArchiveLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchRules();
    }
  }, [user]);

  async function fetchRules() {
    setLoading(true);
    try {
      const data = await api.getScoringRules();
      setSections(data.sections || []);
    } catch (err) {
      console.error('Error fetching scoring rules:', err);
      setError('Failed to load scoring rules');
    } finally {
      setLoading(false);
    }
  }

  function startEditing(rule) {
    setEditingRule(rule.scoring_id);
    setEditValue(String(rule.points));
  }

  function cancelEditing() {
    setEditingRule(null);
    setEditValue('');
  }

  async function saveEdit(ruleId) {
    const newPoints = parseFloat(editValue);
    if (isNaN(newPoints)) {
      setError('Please enter a valid number');
      return;
    }

    setUpdating(ruleId);
    setError('');
    try {
      await api.updateScoringRule(ruleId, newPoints);
      // Update local state
      setSections(prev => prev.map(section => ({
        ...section,
        rules: section.rules.map(rule =>
          rule.scoring_id === ruleId ? { ...rule, points: newPoints } : rule
        )
      })));
      setEditingRule(null);
      setEditValue('');
      setSuccess('Rule updated');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.message || 'Failed to update rule');
    } finally {
      setUpdating(null);
    }
  }

  function handleKeyDown(e, ruleId) {
    if (e.key === 'Enter') {
      saveEdit(ruleId);
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  }

  async function fetchArchive(season) {
    if (!season) {
      setArchiveSections([]);
      return;
    }
    setArchiveLoading(true);
    try {
      const data = await api.getArchivedScoringRules(season);
      setArchiveSections(data.sections || []);
    } catch (err) {
      console.error('Error fetching archived rules:', err);
      setArchiveSections([]);
    } finally {
      setArchiveLoading(false);
    }
  }

  function getLabel(scoringType) {
    return SCORING_TYPE_LABELS[scoringType] || scoringType;
  }

  if (authLoading || loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Scoring Rules</h1>
      <p className="text-gray-600">
        These rules apply to the current season ({currentSeason}). Click a points value to edit it.
      </p>

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

      {/* Current Rules */}
      {sections.map((section) => (
        <div key={section.section_name} className="card">
          <h2 className="text-xl font-bold mb-4">{section.section_name}</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b-2 border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Rule</th>
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {section.rules.map((rule) => (
                  <tr key={rule.scoring_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-sm">{getLabel(rule.scoring_type)}</td>
                    <td className="px-4 py-3 text-right">
                      {editingRule === rule.scoring_id ? (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            type="number"
                            step="any"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, rule.scoring_id)}
                            autoFocus
                            className="w-24 px-2 py-1 text-right border border-primary-400 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm font-bold"
                          />
                          <button
                            onClick={() => saveEdit(rule.scoring_id)}
                            disabled={updating === rule.scoring_id}
                            className="px-2 py-1 bg-positive-600 text-white rounded text-xs font-medium hover:bg-positive-700 disabled:opacity-50 cursor-pointer"
                          >
                            {updating === rule.scoring_id ? '...' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="px-2 py-1 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditing(rule)}
                          className="font-bold text-primary-600 hover:text-primary-800 hover:underline cursor-pointer"
                          title="Click to edit"
                        >
                          {rule.points}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Archived Rules */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Archived Rules</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">View season:</span>
            <select
              value={archiveSeason || ''}
              onChange={(e) => {
                const val = e.target.value ? parseInt(e.target.value) : null;
                setArchiveSeason(val);
                fetchArchive(val);
              }}
              className="px-3 py-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            >
              <option value="">Select season...</option>
              {currentSeason && [currentSeason - 1, currentSeason - 2].filter(s => s > 2020).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {archiveLoading ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : archiveSections.length === 0 ? (
          <p className="text-gray-500 text-center py-4">
            {archiveSeason ? 'No archived rules found for this season.' : 'Select a season to view archived rules.'}
          </p>
        ) : (
          archiveSections.map((section) => (
            <div key={section.section_name} className="mb-4">
              <h3 className="font-semibold text-gray-700 mb-2">{section.section_name}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Rule</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {section.rules.map((rule, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{getLabel(rule.scoring_type)}</td>
                        <td className="px-3 py-2 text-right font-bold text-gray-700">{rule.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
