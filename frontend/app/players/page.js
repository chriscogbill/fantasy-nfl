'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/AuthContext';
import TeamLogo from '../../components/TeamLogo';
import PlayerStatsModal from '../../components/PlayerStatsModal';

const STORAGE_KEY = 'playersTableConfig';

export default function PlayersPage() {
  const { user, userTeamId, currentSeason } = useAuth();
  const showBuyButton = user && userTeamId;
  const [allPlayers, setAllPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    position: '',
    search: '',
    minPrice: '',
    maxPrice: '',
  });
  // During Setup/Preseason nobody has current-season points yet, so the
  // points column shows LAST season's totals (the number you pick teams
  // by) instead of an all-zero "Avg Points" (Chris, 2026-07-24: the
  // page looked broken in Setup with every row at 0.0).
  const [currentWeekState, setCurrentWeekState] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);

  // Configurable columns + sort, persisted in localStorage (hydrated in an
  // effect so the server render never touches window).
  const [visibleCols, setVisibleCols] = useState(['position', 'team', 'bye', 'price', 'points']);
  const [sort, setSort] = useState({ key: 'price', dir: 'desc' });
  const [columnsOpen, setColumnsOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved?.visible?.length) setVisibleCols(saved.visible);
      if (saved?.sort?.key) setSort(saved.sort);
    } catch (e) { /* corrupted config — keep defaults */ }
  }, []);

  function persistConfig(visible, sortCfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ visible, sort: sortCfg }));
    } catch (e) { /* private mode etc. */ }
  }

  function toggleColumn(key) {
    const next = visibleCols.includes(key)
      ? visibleCols.filter((k) => k !== key)
      : [...visibleCols, key];
    setVisibleCols(next);
    persistConfig(next, sort);
  }

  function handleSort(key, numeric) {
    const next = sort.key === key
      ? { key, dir: sort.dir === 'desc' ? 'asc' : 'desc' }
      : { key, dir: numeric ? 'desc' : 'asc' };
    setSort(next);
    persistConfig(visibleCols, next);
  }

  function handleOpenStats(player, e) {
    e.stopPropagation();
    setSelectedPlayer(player);
    setIsStatsModalOpen(true);
  }

  function handleCloseStats() {
    setIsStatsModalOpen(false);
    setSelectedPlayer(null);
  }
  const isPreseason = currentWeekState === 'Setup' || currentWeekState === 'Preseason';

  useEffect(() => {
    fetchPlayers();
    api.getCurrentWeek()
      .then((w) => setCurrentWeekState(w ?? null))
      .catch(() => setCurrentWeekState(null));
  }, [currentSeason]);

  async function fetchPlayers() {
    setLoading(true);
    try {
      const data = await api.getPlayers({ limit: 10000, season: currentSeason });
      setAllPlayers(data.players || []);
    } catch (error) {
      console.error('Error fetching players:', error);
    } finally {
      setLoading(false);
    }
  }

  const positionColors = {
    QB: 'pos-qb',
    RB: 'pos-rb',
    WR: 'pos-wr',
    TE: 'pos-te',
    K: 'pos-k',
    DEF: 'pos-def',
  };

  const num = (v) => (v === null || v === undefined || v === '' ? null : parseFloat(v));

  // Column definitions. `sortVal` returns the comparable value (null sorts
  // last); `numeric` picks the first-click direction (desc for numbers).
  const COLUMN_DEFS = [
    {
      key: 'position', label: 'Position', align: 'text-left', numeric: false,
      sortVal: (p) => p.player_position || '',
      render: (p) => (
        <span className={`px-2 py-1 text-xs font-semibold rounded ${positionColors[p.player_position] || 'bg-gray-100 text-gray-800'}`}>
          {p.player_position}
        </span>
      ),
    },
    {
      key: 'team', label: 'Team', align: 'text-left', numeric: false,
      sortVal: (p) => p.player_team || null,
      render: (p) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-gray-600">
          <TeamLogo team={p.player_team} className="w-4 h-4 shrink-0" /> {p.player_team || '-'}
        </span>
      ),
    },
    {
      key: 'bye', label: 'Bye', align: 'text-center', numeric: true,
      sortVal: (p) => p.bye_week ?? null,
      render: (p) => <span className="text-gray-600">{p.bye_week ? `W${p.bye_week}` : '-'}</span>,
    },
    {
      key: 'price', label: 'Price', align: 'text-right', numeric: true,
      sortVal: (p) => num(p.current_price),
      render: (p) => <span className="font-semibold">${p.current_price}M</span>,
    },
    {
      key: 'points',
      label: isPreseason ? `${currentSeason - 1} Pts` : 'Avg Points',
      align: 'text-right', numeric: true,
      sortVal: (p) => (isPreseason ? num(p.prev_season_total) : num(p.avg_points)),
      render: (p) => (
        <span className="font-bold text-primary-600">
          {isPreseason
            ? (p.prev_season_total ? parseFloat(p.prev_season_total).toFixed(1) : '-')
            : (p.avg_points ? parseFloat(p.avg_points).toFixed(1) : '-')}
        </span>
      ),
    },
    {
      key: 'seasonTotal', label: 'Season Pts', align: 'text-right', numeric: true,
      sortVal: (p) => num(p.season_total),
      render: (p) => <span className="text-gray-700">{p.season_total ? parseFloat(p.season_total).toFixed(1) : '-'}</span>,
    },
    {
      key: 'fixtures', label: 'Next 3', align: 'text-left', numeric: false, sortable: false,
      sortVal: () => null,
      render: (p) => (
        <span className="text-xs text-gray-600 whitespace-nowrap">
          {p.fixture_week_1 || 'BYE'}, {p.fixture_week_2 || 'BYE'}, {p.fixture_week_3 || 'BYE'}
        </span>
      ),
    },
  ];

  const activeCols = COLUMN_DEFS.filter((c) => visibleCols.includes(c.key));
  const sortCol = COLUMN_DEFS.find((c) => c.key === sort.key);

  // Client-side filtering + sorting
  const players = allPlayers
    .filter((player) => {
      if (filters.position && player.player_position !== filters.position) return false;
      if (filters.search && !player.player_name.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.minPrice && parseFloat(player.current_price) < parseFloat(filters.minPrice)) return false;
      if (filters.maxPrice && parseFloat(player.current_price) > parseFloat(filters.maxPrice)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort.key === 'name') {
        const cmp = a.player_name.localeCompare(b.player_name);
        return sort.dir === 'asc' ? cmp : -cmp;
      }
      if (!sortCol) return 0;
      const av = sortCol.sortVal(a);
      const bv = sortCol.sortVal(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls last either direction
      if (bv === null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });

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

  const sortIndicator = (key) => sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Player Search</h1>
        <div className="flex items-center gap-2">
          {/* Column picker */}
          <div className="relative">
            <button onClick={() => setColumnsOpen(!columnsOpen)} className="btn-secondary">
              Columns
            </button>
            {columnsOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColumnsOpen(false)} />
                <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-md shadow-lg border border-gray-200 z-20 py-2 px-3 space-y-1.5">
                  {COLUMN_DEFS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleCols.includes(c.key)}
                        onChange={() => toggleColumn(c.key)}
                      />
                      {c.key === 'points' ? (isPreseason ? `${currentSeason - 1} Pts` : 'Avg Points') : c.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button onClick={clearFilters} className="btn-secondary">
            Clear Filters
          </button>
        </div>
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
        {loading ? 'Loading...' : `${players.length} of ${allPlayers.length} players`}
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
          <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200 sticky top-0 z-10">
              <tr>
                {showBuyButton && <th className="px-2 py-3 w-10"></th>}
                <th
                  className="px-4 py-3 text-left text-sm font-semibold text-gray-600 cursor-pointer select-none hover:text-gray-900"
                  onClick={() => handleSort('name', false)}
                >
                  Player{sortIndicator('name')}
                </th>
                {activeCols.map((c) => (
                  <th
                    key={c.key}
                    className={`px-4 py-3 ${c.align} text-sm font-semibold text-gray-600 ${c.sortable === false ? '' : 'cursor-pointer select-none hover:text-gray-900'}`}
                    onClick={c.sortable === false ? undefined : () => handleSort(c.key, c.numeric)}
                  >
                    {c.key === 'points' ? (isPreseason ? `${currentSeason - 1} Pts` : 'Avg Points') : c.label}
                    {c.sortable === false ? '' : sortIndicator(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {players.map((player) => (
                <tr key={player.player_id} className="hover:bg-gray-50 transition-colors">
                  {showBuyButton && (
                    <td className="px-2 py-4 text-center">
                      <Link
                        href={`/teams/${userTeamId}/transfers?buyPlayer=${player.player_id}`}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-positive-100 text-positive-700 hover:bg-positive-200 hover:text-positive-800 transition-colors border border-positive-300"
                        title={`Buy ${player.player_name}`}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </Link>
                    </td>
                  )}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold">{player.player_name}</div>
                      <button
                        onClick={(e) => handleOpenStats(player, e)}
                        className="text-primary-500 hover:text-primary-700 cursor-pointer"
                        title={`View ${player.player_name}'s stats`}
                      >
                        ℹ️
                      </button>
                    </div>
                  </td>
                  {activeCols.map((c) => (
                    <td key={c.key} className={`px-4 py-4 ${c.align}`}>
                      {c.render(player)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <PlayerStatsModal
        player={selectedPlayer}
        isOpen={isStatsModalOpen}
        onClose={handleCloseStats}
      />
    </div>
  );
}
