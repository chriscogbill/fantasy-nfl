'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export default function PlayerStatsModal({ player, isOpen, onClose }) {
  const [stats, setStats] = useState([]);
  const [currentWeek, setCurrentWeek] = useState('Preseason');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && player) {
      fetchPlayerStats();
    }
  }, [isOpen, player]);

  async function fetchPlayerStats() {
    setLoading(true);
    setError('');
    try {
      console.log('Fetching stats for player:', player.player_id, player.player_name || player.name);
      const response = await api.getPlayerStats(player.player_id, { season: 2024 });
      console.log('Stats response:', response);
      setStats(response.stats || []);
      setCurrentWeek(response.currentWeek || 'Preseason');
    } catch (err) {
      console.error('Error fetching player stats:', err);
      setError('Failed to load player stats');
      setStats([]);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  const renderStatsGroupHeaders = (position) => {
    switch (position) {
      case 'QB':
        return (
          <>
            <th colSpan="4" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-blue-100 border-r border-gray-300">Passing Stats</th>
            <th colSpan="2" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-green-100">Rushing Stats</th>
          </>
        );
      case 'RB':
        return (
          <>
            <th colSpan="3" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-green-100 border-r border-gray-300">Rushing Stats</th>
            <th colSpan="3" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-blue-100">Receiving Stats</th>
          </>
        );
      case 'WR':
      case 'TE':
        return (
          <>
            <th colSpan="4" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-blue-100 border-r border-gray-300">Receiving Stats</th>
            <th colSpan="2" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-green-100">Rushing Stats</th>
          </>
        );
      case 'K':
        return (
          <>
            <th colSpan="5" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-orange-100 border-r border-gray-300">Field Goals</th>
            <th colSpan="1" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-yellow-100">Extra Points</th>
          </>
        );
      case 'DEF':
        return (
          <>
            <th colSpan="2" className="px-3 py-2 text-center text-xs font-bold text-gray-700 uppercase bg-gray-100">Defense Stats</th>
          </>
        );
      default:
        return null;
    }
  };

  const renderStatsColumns = (position) => {
    switch (position) {
      case 'QB':
        return (
          <>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Pass Yds</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Pass TD</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">INT</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50 border-r border-gray-300">Comp/Att</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-green-50">Rush Yds</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-green-50">Rush TD</th>
          </>
        );
      case 'RB':
        return (
          <>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-green-50">Rush Att</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-green-50">Rush Yds</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-green-50 border-r border-gray-300">Rush TD</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Rec</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Rec Yds</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Rec TD</th>
          </>
        );
      case 'WR':
      case 'TE':
        return (
          <>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Rec</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Targets</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50">Rec Yds</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-blue-50 border-r border-gray-300">Rec TD</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-green-50">Rush Yds</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-green-50">Rush TD</th>
          </>
        );
      case 'K':
        return (
          <>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-orange-50">0-19</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-orange-50">20-29</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-orange-50">30-39</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-orange-50">40-49</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-orange-50 border-r border-gray-300">50+</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-yellow-50">XP</th>
          </>
        );
      case 'DEF':
        return (
          <>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-gray-50">Pts Allow</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-gray-50">Def TD</th>
          </>
        );
      default:
        return null;
    }
  };

  // Helper to display stat value or dash for future weeks
  const displayStat = (value, isFuture) => {
    if (isFuture || value === null || value === undefined) return '-';
    return value;
  };

  const renderStatsData = (stat, position, isFuture) => {
    const textClass = isFuture ? "px-3 py-2 text-sm text-gray-400" : "px-3 py-2 text-sm text-gray-900";

    switch (position) {
      case 'QB':
        return (
          <>
            <td className={textClass}>{displayStat(stat.passing_yards, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.passing_tds, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.interceptions, isFuture)}</td>
            <td className={textClass}>{isFuture ? '-' : `${stat.completions || 0}/${stat.attempts || 0}`}</td>
            <td className={textClass}>{displayStat(stat.rushing_yards, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.rushing_tds, isFuture)}</td>
          </>
        );
      case 'RB':
        return (
          <>
            <td className={textClass}>{displayStat(stat.rushing_attempts, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.rushing_yards, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.rushing_tds, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.receptions, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.receiving_yards, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.receiving_tds, isFuture)}</td>
          </>
        );
      case 'WR':
      case 'TE':
        return (
          <>
            <td className={textClass}>{displayStat(stat.receptions, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.targets, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.receiving_yards, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.receiving_tds, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.rushing_yards, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.rushing_tds, isFuture)}</td>
          </>
        );
      case 'K':
        return (
          <>
            <td className={textClass}>{displayStat(stat.fg_0_19, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.fg_20_29, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.fg_30_39, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.fg_40_49, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.fg_50p, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.xp_made, isFuture)}</td>
          </>
        );
      case 'DEF':
        return (
          <>
            <td className={textClass}>{displayStat(stat.points_allowed, isFuture)}</td>
            <td className={textClass}>{displayStat(stat.def_td, isFuture)}</td>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{player?.player_name || player?.name}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {player?.player_position || player?.position} • {player?.player_team || player?.team} • 2024 Season
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            </div>
          ) : error ? (
            <div className="bg-danger-100 border border-danger-400 text-danger-700 px-4 py-3 rounded">
              {error}
            </div>
          ) : stats.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              No schedule data available for this player
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th rowSpan="2" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase sticky left-0 bg-gray-50 border-b border-gray-300">Week</th>
                    <th rowSpan="2" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-gray-50 border-b border-gray-300">Opponent</th>
                    <th rowSpan="2" className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase bg-gray-50 border-b border-gray-300">Total Pts</th>
                    {renderStatsGroupHeaders(player?.player_position || player?.position)}
                  </tr>
                  <tr>
                    {renderStatsColumns(player?.player_position || player?.position)}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {stats.map((stat) => {
                    const isFuture = stat.is_future === true;
                    const rowBgClass = isFuture ? 'bg-link-50' : 'bg-white';
                    const stickyBgClass = isFuture ? 'bg-link-50' : 'bg-white';

                    return (
                      <tr key={stat.week} className={`hover:bg-gray-100 ${rowBgClass}`}>
                        <td className={`px-3 py-2 text-sm font-medium sticky left-0 ${stickyBgClass} ${isFuture ? 'text-gray-500' : 'text-gray-900'}`}>
                          Week {stat.week}
                        </td>
                        <td className={`px-3 py-2 text-sm ${isFuture ? 'text-gray-500' : 'text-gray-900'}`}>
                          {stat.opponent || '-'}
                        </td>
                        <td className={`px-3 py-2 text-sm font-bold ${isFuture ? 'text-gray-400' : 'text-primary-600'}`}>
                          {isFuture ? '-' : (stat.total_points ? parseFloat(stat.total_points).toFixed(1) : '0.0')}
                        </td>
                        {renderStatsData(stat, player?.player_position || player?.position, isFuture)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
