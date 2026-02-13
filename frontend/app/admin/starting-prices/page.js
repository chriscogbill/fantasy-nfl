'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/AuthContext';

export default function StartingPricesPage() {
  const router = useRouter();
  const { user, loading: authLoading, currentSeason } = useAuth();

  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [toast, setToast] = useState(null);
  const [runningAlgorithm, setRunningAlgorithm] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(null);

  // Previous season prices and suggested prices (keyed by player_id)
  const [prevSeasonPrices, setPrevSeasonPrices] = useState({});
  const [suggestedPrices, setSuggestedPrices] = useState({});

  // Algorithm parameters
  const [algorithmParams, setAlgorithmParams] = useState({
    positionMultipliers: { QB: 0.9, RB: 1.2, WR: 1.1, TE: 1.3, K: 0.7, DEF: 0.8 },
    minPrice: 4.5,
    maxPrice: 15.0,
    minGames: 3,
  });

  const [filters, setFilters] = useState({
    position: '',
    search: '',
    minPrice: '',
    maxPrice: '',
  });

  // Sorting state
  const [sortConfig, setSortConfig] = useState({ key: 'current_price', direction: 'desc' });

  // Redirect non-admins
  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/');
    }
  }, [authLoading, user, router]);

  // Load current week and previous season prices on mount
  useEffect(() => {
    if (user?.role === 'admin' && currentSeason) {
      loadInitialData();
    }
  }, [user, currentSeason]);

  useEffect(() => {
    if (user?.role === 'admin' && currentSeason && currentWeek !== null) {
      fetchPlayers();
    }
  }, [user, currentSeason, currentWeek]);

  async function loadInitialData() {
    try {
      const [weekData, prevPricesData] = await Promise.all([
        api.getCurrentWeek(),
        api.getPreviousSeasonPrices(),
      ]);
      setCurrentWeek(weekData);
      setPrevSeasonPrices(prevPricesData.prices || {});
    } catch (error) {
      console.error('Error loading initial data:', error);
      setCurrentWeek('unknown');
    }
  }

  async function fetchPlayers() {
    setLoading(true);
    try {
      const data = await api.getPlayers({ limit: 1000, season: currentSeason });
      setAllPlayers(data.players || []);
    } catch (error) {
      console.error('Error fetching players:', error);
    } finally {
      setLoading(false);
    }
  }

  // Client-side filtering
  const filteredPlayersUnsorted = allPlayers.filter(player => {
    if (filters.position && player.player_position !== filters.position) return false;
    if (filters.search && !player.player_name.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.minPrice && parseFloat(player.current_price) < parseFloat(filters.minPrice)) return false;
    if (filters.maxPrice && parseFloat(player.current_price) > parseFloat(filters.maxPrice)) return false;
    return true;
  });

  // Sorting
  function getSortValue(player, key) {
    switch (key) {
      case 'player_name': return player.player_name?.toLowerCase() || '';
      case 'player_position': return player.player_position || '';
      case 'player_team': return player.player_team || '';
      case 'current_price': return parseFloat(player.current_price) || 0;
      case 'avg_points': return parseFloat(player.avg_points) || 0;
      case 'prev_price': return prevSeasonPrices[player.player_id] || 0;
      case 'suggested': return suggestedPrices[player.player_id] || 0;
      case 'search_rank': return player.search_rank || 9999999;
      default: return 0;
    }
  }

  const filteredPlayers = [...filteredPlayersUnsorted].sort((a, b) => {
    const aVal = getSortValue(a, sortConfig.key);
    const bVal = getSortValue(b, sortConfig.key);
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    if (typeof aVal === 'string') return aVal.localeCompare(bVal) * dir;
    return (aVal - bVal) * dir;
  });

  function handleSort(key) {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  }

  function SortIcon({ columnKey }) {
    if (sortConfig.key !== columnKey) {
      return <span className="text-gray-300 ml-1">&#x2195;</span>;
    }
    return <span className="text-primary-600 ml-1">{sortConfig.direction === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  }

  async function handleRunAlgorithm() {
    setRunningAlgorithm(true);
    try {
      const result = await api.previewInitialPrices(algorithmParams);
      setSuggestedPrices(result.suggestedPrices || {});
      setToast({ message: `Algorithm generated suggested prices for ${result.count} players`, type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } catch (error) {
      setToast({ message: error.message || 'Failed to run pricing algorithm', type: 'error' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setRunningAlgorithm(false);
    }
  }

  async function handleSaveAllSuggested() {
    if (!confirm('This will save all suggested prices as the starting prices for all players. Continue?')) {
      return;
    }

    setRunningAlgorithm(true);
    try {
      const result = await api.saveSuggestedPrices(suggestedPrices);
      setToast({ message: result.message, type: 'success' });
      setTimeout(() => setToast(null), 4000);
      setSuggestedPrices({});
      fetchPlayers();
    } catch (error) {
      setToast({ message: error.message || 'Failed to save prices', type: 'error' });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setRunningAlgorithm(false);
    }
  }

  async function handleCopyPriorYearPrices() {
    // Use prevSeasonPrices (already loaded) as suggested prices
    if (Object.keys(prevSeasonPrices).length === 0) {
      setToast({ message: `No ${currentSeason - 1} prices found to copy`, type: 'error' });
      setTimeout(() => setToast(null), 4000);
      return;
    }
    setSuggestedPrices({ ...prevSeasonPrices });
    const count = Object.keys(prevSeasonPrices).length;
    setToast({ message: `Loaded ${count} prices from ${currentSeason - 1} as suggestions`, type: 'success' });
    setTimeout(() => setToast(null), 4000);
  }

  function updateMultiplier(position, value) {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      setAlgorithmParams(prev => ({
        ...prev,
        positionMultipliers: { ...prev.positionMultipliers, [position]: num }
      }));
    }
  }

  async function handlePriceChange(playerId, change) {
    setUpdating(playerId);
    try {
      const result = await api.updatePlayerPrice(playerId, {
        change,
        season: currentSeason,
        week: 0,
        day: 0,
      });

      setAllPlayers(prev =>
        prev.map(p =>
          p.player_id === playerId
            ? { ...p, current_price: result.new_price }
            : p
        )
      );

      setToast({ message: result.message, type: 'success' });
      setTimeout(() => setToast(null), 2000);
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

  // Loading week check
  if (currentWeek === null) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const isSetup = currentWeek === 'Setup';
  const hasSuggested = Object.keys(suggestedPrices).length > 0;

  // Not in Setup mode — show message
  if (!isSetup) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Starting Prices</h1>
        <div className="card border-l-4 border-l-primary-500">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="w-6 h-6 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-lg">Only Available During Setup</h2>
              <p className="text-gray-600 mt-1">
                Starting prices can only be set when the season is in <span className="font-semibold">Setup</span> mode.
                The {currentSeason} season is currently in <span className="font-semibold">{typeof currentWeek === 'number' ? `Week ${currentWeek}` : currentWeek}</span>.
              </p>
              <p className="text-gray-500 text-sm mt-3">
                Use{' '}
                <Link href="/players/prices" className="text-primary-600 hover:text-primary-700 font-medium underline">
                  Price Changes
                </Link>{' '}
                to adjust player prices during the season, or{' '}
                <Link href="/admin/settings" className="text-primary-600 hover:text-primary-700 font-medium underline">
                  Season Roll Forward
                </Link>{' '}
                to start setting up a new season.
              </p>
            </div>
          </div>
        </div>
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
        <div>
          <h1 className="text-3xl font-bold">Starting Prices</h1>
          <p className="text-gray-600 mt-1">
            Set player prices for the {currentSeason} season. Run the algorithm to see suggested prices, then save or adjust individually.
          </p>
        </div>
      </div>

      {/* Algorithm Section */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Pricing Algorithm</h2>
        <p className="text-sm text-gray-600 mb-4">
          Calculates suggested prices using {currentSeason - 1} season totals, position multipliers, and percentile ranking.
          Adjust the parameters below, then run the algorithm to preview suggested prices.
        </p>

        {/* Position Multipliers */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Position Multipliers</label>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map(pos => (
              <div key={pos}>
                <label className="block text-xs text-gray-500 mb-1">{pos}</label>
                <input
                  type="number"
                  step="0.1"
                  value={algorithmParams.positionMultipliers[pos]}
                  onChange={(e) => updateMultiplier(pos, e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-center font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Price Range & Min Games */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Min Price ($M)</label>
            <input
              type="number"
              step="0.1"
              value={algorithmParams.minPrice}
              onChange={(e) => setAlgorithmParams(prev => ({ ...prev, minPrice: parseFloat(e.target.value) || 0 }))}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Max Price ($M)</label>
            <input
              type="number"
              step="0.5"
              value={algorithmParams.maxPrice}
              onChange={(e) => setAlgorithmParams(prev => ({ ...prev, maxPrice: parseFloat(e.target.value) || 0 }))}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Min Games Played</label>
            <input
              type="number"
              step="1"
              min="1"
              value={algorithmParams.minGames}
              onChange={(e) => setAlgorithmParams(prev => ({ ...prev, minGames: parseInt(e.target.value) || 1 }))}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleRunAlgorithm}
            disabled={runningAlgorithm}
            className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer font-medium"
          >
            {runningAlgorithm ? 'Running...' : 'Run Algorithm'}
          </button>
          {hasSuggested && (
            <>
              <button
                onClick={handleSaveAllSuggested}
                disabled={runningAlgorithm}
                className="bg-positive-600 text-white px-6 py-2 rounded-lg hover:bg-positive-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer font-medium"
              >
                Save All Suggested Prices
              </button>
              <button
                onClick={() => setSuggestedPrices({})}
                className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors cursor-pointer font-medium"
              >
                Dismiss Suggestions
              </button>
            </>
          )}
          <button
            onClick={handleCopyPriorYearPrices}
            disabled={runningAlgorithm}
            className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed cursor-pointer font-medium"
          >
            Copy {currentSeason - 1} Prices
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Players</h2>
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
        {loading ? 'Loading...' : `${filteredPlayers.length} of ${allPlayers.length} players`}
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredPlayers.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No players found. Try adjusting your filters.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('player_name')}>
                  Player<SortIcon columnKey="player_name" />
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('player_position')}>
                  Pos<SortIcon columnKey="player_position" />
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('player_team')}>
                  Team<SortIcon columnKey="player_team" />
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('search_rank')}>
                  Rank<SortIcon columnKey="search_rank" />
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('prev_price')}>
                  {currentSeason - 1} Price<SortIcon columnKey="prev_price" />
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('avg_points')}>
                  {currentSeason - 1} Avg Pts<SortIcon columnKey="avg_points" />
                </th>
                {hasSuggested && (
                  <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('suggested')}>
                    Suggested<SortIcon columnKey="suggested" />
                  </th>
                )}
                <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 cursor-pointer hover:text-primary-600 select-none" onClick={() => handleSort('current_price')}>
                  Price<SortIcon columnKey="current_price" />
                </th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-600">Adjust</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredPlayers.map((player) => {
                const prevPrice = prevSeasonPrices[player.player_id];
                const suggested = suggestedPrices[player.player_id];
                const currentPrice = parseFloat(player.current_price);

                return (
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
                      {player.search_rank && player.search_rank < 9999999 ? (
                        <span className={`font-medium ${
                          player.search_rank <= 20 ? 'text-positive-600' :
                          player.search_rank <= 50 ? 'text-primary-600' :
                          player.search_rank <= 150 ? 'text-gray-700' :
                          'text-gray-400'
                        }`}>
                          {player.search_rank}
                        </span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {prevPrice ? `$${prevPrice.toFixed(1)}M` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-gray-600">
                        {player.avg_points ? parseFloat(player.avg_points).toFixed(1) : '-'}
                      </span>
                    </td>
                    {hasSuggested && (
                      <td className="px-4 py-3 text-right">
                        {suggested ? (
                          <span className={`font-medium ${
                            suggested > currentPrice ? 'text-positive-600' :
                            suggested < currentPrice ? 'text-danger-600' :
                            'text-gray-600'
                          }`}>
                            ${suggested.toFixed(1)}M
                          </span>
                        ) : '-'}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-primary-600">${currentPrice.toFixed(1)}M</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handlePriceChange(player.player_id, -0.5)}
                          disabled={updating === player.player_id || currentPrice <= 4.5}
                          className="w-8 h-8 rounded bg-danger-100 text-danger-700 font-bold hover:bg-danger-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-xs"
                        >
                          -0.5
                        </button>
                        <button
                          onClick={() => handlePriceChange(player.player_id, -0.1)}
                          disabled={updating === player.player_id || currentPrice <= 4.5}
                          className="w-8 h-8 rounded bg-danger-100 text-danger-700 font-bold hover:bg-danger-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-xs"
                        >
                          -
                        </button>
                        <button
                          onClick={() => handlePriceChange(player.player_id, 0.1)}
                          disabled={updating === player.player_id}
                          className="w-8 h-8 rounded bg-positive-100 text-positive-700 font-bold hover:bg-positive-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-xs"
                        >
                          +
                        </button>
                        <button
                          onClick={() => handlePriceChange(player.player_id, 0.5)}
                          disabled={updating === player.player_id}
                          className="w-8 h-8 rounded bg-positive-100 text-positive-700 font-bold hover:bg-positive-200 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer text-xs"
                        >
                          +0.5
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
