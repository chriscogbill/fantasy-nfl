'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export default function PlayersPage() {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    position: '',
    search: '',
    minPrice: '',
    maxPrice: '',
  });

  useEffect(() => {
    fetchPlayers();
  }, [filters]);

  async function fetchPlayers() {
    setLoading(true);
    try {
      const params = {
        limit: 50,
        season: 2024,
      };

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

  function handleFilterChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearFilters() {
    setFilters({
      position: '',
      search: '',
      minPrice: '',
      maxPrice: '',
    });
  }

  const positionColors = {
    QB: 'pos-qb',
    RB: 'pos-rb',
    WR: 'pos-wr',
    TE: 'pos-te',
    K: 'pos-k',
    DEF: 'pos-def',
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Player Search</h1>
        <button onClick={clearFilters} className="btn-secondary">
          Clear Filters
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Search by Name
            </label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              placeholder="e.g. Mahomes"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Position */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Position
            </label>
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

          {/* Min Price */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Price (M)
            </label>
            <input
              type="number"
              value={filters.minPrice}
              onChange={(e) => handleFilterChange('minPrice', e.target.value)}
              placeholder="0"
              step="0.1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Max Price */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Price (M)
            </label>
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

      {/* Results Count */}
      <div className="text-sm text-gray-600">
        {loading ? 'Loading...' : `${players.length} players found`}
      </div>

      {/* Players Table */}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {players.map((player) => (
                <tr key={player.player_id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4">
                    <div className="font-semibold">{player.player_name}</div>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`px-2 py-1 text-xs font-semibold rounded ${
                        positionColors[player.player_position] || 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {player.player_position}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-gray-600">{player.player_team || '-'}</td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-semibold">${player.current_price}M</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-bold text-primary-600">
                      {player.avg_points ? parseFloat(player.avg_points).toFixed(1) : '-'}
                    </span>
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
