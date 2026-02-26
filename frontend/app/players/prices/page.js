'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';

export default function PlayerPricesPage() {
  const router = useRouter();
  const { user, loading: authLoading, currentSeason } = useAuth();

  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null); // player_id being updated
  const [toast, setToast] = useState(null);

  const [filters, setFilters] = useState({
    position: '',
    search: '',
    minPrice: '',
    maxPrice: '',
  });

  // Price change settings (defaulting to current app settings)
  const [season, setSeason] = useState(null);
  const [week, setWeek] = useState(null);
  const [day, setDay] = useState(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  // Load current settings for defaults
  useEffect(() => {
    async function loadSettings() {
      try {
        const [seasonResp, weekResp, dayResp] = await Promise.all([
          api.getSetting('current_season'),
          api.getSetting('current_week'),
          api.getSetting('current_day'),
        ]);
        setSeason(parseInt(seasonResp.value) || currentSeason || new Date().getFullYear());
        setWeek(weekResp.value === 'Preseason' ? 'Preseason' : parseInt(weekResp.value));
        setDay(parseInt(dayResp.value) || 1);
        setSettingsLoaded(true);
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    }
    if (user?.role === 'admin') {
      loadSettings();
    }
  }, [user]);

  useEffect(() => {
    if (settingsLoaded) {
      fetchPlayers();
    }
  }, [filters, settingsLoaded]);

  async function fetchPlayers() {
    setLoading(true);
    try {
      const params = { limit: 50, season: season || currentSeason || new Date().getFullYear() };
      if (filters.position) params.position = filters.position;
      if (filters.search) params.search = filters.search;
      if (filters.minPrice) params.minPrice = filters.minPrice;
      if (filters.maxPrice) params.maxPrice = filters.maxPrice;

      const data = await api.getPlayers(params);
      setPlayers(data.players || []);
    } catch (error) {
      console.error('Error fetching players:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handlePriceChange(playerId, change) {
    if (!season || !week || week === 'Preseason' || !day) {
      setToast({ message: 'Set a valid week (not Preseason) and day before changing prices', type: 'error' });
      setTimeout(() => setToast(null), 3000);
      return;
    }

    setUpdating(playerId);
    try {
      const result = await api.updatePlayerPrice(playerId, {
        change,
        season,
        week,
        day,
      });

      // Update player in list with new price
      setPlayers(prev =>
        prev.map(p =>
          p.player_id === playerId
            ? { ...p, current_price: result.new_price }
            : p
        )
      );

      setToast({ message: result.message, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setToast({ message: error.message || 'Failed to update price', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setUpdating(null);
    }
  }

  function handleFilterChange(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }

  const positionColors = {
    QB: 'pos-qb',
    RB: 'pos-rb',
    WR: 'pos-wr',
    TE: 'pos-te',
    K: 'pos-k',
    DEF: 'pos-def',
  };

  if (authLoading || !user || user.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-white ${
          toast.type === 'success' ? 'bg-positive-600' : 'bg-danger-600'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Price Changes</h1>
      </div>

      {/* Price Change Settings */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Price Change Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Season</label>
            <select
              value={season || ''}
              onChange={(e) => setSeason(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {currentSeason && [currentSeason - 1, currentSeason, currentSeason + 1].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Week</label>
            <select
              value={week || ''}
              onChange={(e) => setWeek(e.target.value === 'Preseason' ? 'Preseason' : parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="Preseason">Preseason</option>
              {Array.from({ length: 18 }, (_, i) => i + 1).map(w => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Day</label>
            <select
              value={day || ''}
              onChange={(e) => setDay(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {Array.from({ length: 7 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
        {week === 'Preseason' && (
          <p className="text-sm text-danger-600 mt-2">Price changes cannot be made during Preseason. Select a week.</p>
        )}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search by Name</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="e.g. Mahomes"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
            <select
              value={filters.position}
              onChange={(e) => handleFilterChange('position', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">All Positions</option>
              <option value="QB">QB</option>
              <option value="RB">RB</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
              <option value="K">K</option>
              <option value="DEF">DEF</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Price (M)</label>
            <input
              type="number"
              value={filters.minPrice}
              onChange={(e) => handleFilterChange('minPrice', e.target.value)}
              placeholder="0"
              step="0.1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Price (M)</label>
            <input
              type="number"
              value={filters.maxPrice}
              onChange={(e) => handleFilterChange('maxPrice', e.target.value)}
              placeholder="100"
              step="0.1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="text-sm text-gray-600">
        {loading ? 'Loading...' : `${players.length} players found`}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : players.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No players found. Try adjusting your filters.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Player</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Position</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Team</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Price</th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600">Avg Points</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Adjust</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {players.map((player) => (
                <tr key={player.player_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{player.player_name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-semibold rounded ${
                      positionColors[player.player_position] || 'bg-gray-100 text-gray-800'
                    }`}>
                      {player.player_position}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{player.player_team || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold">${parseFloat(player.current_price).toFixed(1)}M</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-bold text-primary-600">
                      {player.avg_points ? parseFloat(player.avg_points).toFixed(1) : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handlePriceChange(player.player_id, -0.1)}
                        disabled={updating === player.player_id || parseFloat(player.current_price) <= 4.5 || week === 'Preseason'}
                        className="w-8 h-8 rounded bg-danger-100 text-danger-700 font-bold hover:bg-danger-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        -
                      </button>
                      <button
                        onClick={() => handlePriceChange(player.player_id, 0.1)}
                        disabled={updating === player.player_id || week === 'Preseason'}
                        className="w-8 h-8 rounded bg-positive-100 text-positive-700 font-bold hover:bg-positive-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
