'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/AuthContext';
import PlayerStatsModal from '../../../../components/PlayerStatsModal';

export default function TransfersPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const teamId = params.id;
  const { user, loading: authLoading, refreshUserTeam, currentSeason } = useAuth();
  const buyPlayerProcessed = useRef(false);

  const [team, setTeam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [currentWeek, setCurrentWeek] = useState(null);

  // Transfers apply to next week's lineup
  // During Preseason, transfers apply to Week 1
  // During regular season, transfers apply to next week
  const transferWeek = currentWeek !== null
    ? (currentWeek === 'Setup' || currentWeek === 'Preseason' ? 1 : currentWeek + 1)
    : null;

  const [playersToSell, setPlayersToSell] = useState([]);
  const [playersToBuy, setPlayersToBuy] = useState([]);
  const [preview, setPreview] = useState(null);

  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [autoPickToast, setAutoPickToast] = useState(null); // { message, type: 'success' | 'error' }

  const [filterPosition, setFilterPosition] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMinPrice, setFilterMinPrice] = useState('');
  const [filterMaxPrice, setFilterMaxPrice] = useState('');
  const [filterNflTeam, setFilterNflTeam] = useState('all');

  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);

  useEffect(() => {
    async function loadCurrentWeek() {
      // Wait for auth to complete before loading data
      if (authLoading) return;

      if (!user) {
        router.push('/login');
        return;
      }

      try {
        const weekData = await api.getCurrentWeek();
        setCurrentWeek(weekData);
      } catch (error) {
        console.error('Error loading current week:', error);
        setCurrentWeek(11);
      }
    }
    loadCurrentWeek();
  }, [authLoading, user, router]);

  useEffect(() => {
    if (teamId && transferWeek !== null && user && !authLoading) {
      fetchData();
    }
  }, [teamId, transferWeek, user, authLoading]);

  useEffect(() => {
    if (playersToSell.length > 0 || playersToBuy.length > 0) {
      updatePreview();
    } else {
      setPreview(null);
    }
  }, [playersToSell, playersToBuy, transferWeek]);

  // Auto-update position filter based on players selected to sell
  useEffect(() => {
    if (playersToSell.length === 0) {
      // Reset to all when no players selected
      setFilterPosition('all');
    } else {
      // Get positions of players being sold
      const selectedPositions = playersToSell
        .map(playerId => roster.find(p => p.player_id === playerId)?.player_position)
        .filter(Boolean);

      // Get unique positions
      const uniquePositions = [...new Set(selectedPositions)];

      // If all selected players are the same position, filter to that position
      if (uniquePositions.length === 1) {
        setFilterPosition(uniquePositions[0]);
      } else {
        // Multiple positions selected, show all
        setFilterPosition('all');
      }
    }
  }, [playersToSell, roster]);

  // Auto-select player from buyPlayer URL param (from Player Stats page)
  useEffect(() => {
    if (buyPlayerProcessed.current) return;
    const buyPlayerParam = searchParams.get('buyPlayer');
    if (!buyPlayerParam || availablePlayers.length === 0) return;

    const buyPlayerId = parseInt(buyPlayerParam);
    const player = availablePlayers.find(p => p.player_id === buyPlayerId);
    const alreadyInRoster = roster.find(p => p.player_id === buyPlayerId);

    if (player && !alreadyInRoster && !playersToBuy.includes(buyPlayerId)) {
      setPlayersToBuy(prev => [...prev, buyPlayerId]);
    }

    buyPlayerProcessed.current = true;
    // Remove the query param from URL to prevent re-triggering
    router.replace(`/teams/${teamId}/transfers`, { scroll: false });
  }, [availablePlayers, roster, searchParams, teamId, router, playersToBuy]);

  async function fetchData() {
    setLoading(true);
    setError('');
    try {
      const [teamData, playersData] = await Promise.all([
        api.getTeam(teamId),
        api.getPlayers({ season: currentSeason, available: true, limit: 1000 }),
      ]);

      setTeam(teamData.team);

      // Try to get target week's roster
      let rosterData;
      try {
        rosterData = await api.getTeamRoster(teamId, { week: transferWeek, season: currentSeason });
      } catch (err) {
        // If roster doesn't exist for target week, return empty roster
        // (Preseason won't have any previous roster to copy from)
        console.log(`Week ${transferWeek} roster not found, starting with empty roster`);
        rosterData = { starters: [], bench: [] };
      }

      // Combine starters and bench
      const allRosterPlayers = [
        ...(rosterData.starters || []),
        ...(rosterData.bench || []),
      ];
      setRoster(allRosterPlayers);

      setAvailablePlayers(playersData.players || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function updatePreview() {
    if (!transferWeek || !teamId) return;

    try {
      const response = await api.previewTransfer({
        teamId: parseInt(teamId),
        playersOut: playersToSell,
        playersIn: playersToBuy,
        week: transferWeek,
        season: currentSeason,
      });

      setPreview(response.preview);
    } catch (error) {
      console.error('Error previewing transfer:', error);
      setPreview(null);
    }
  }

  async function handleExecuteTransfer() {
    if (!preview?.isAffordable) {
      setError('Transfer not affordable!');
      return;
    }

    setExecuting(true);
    setError('');
    setSuccess('');

    try {
      await api.executeTransfer({
        teamId: parseInt(teamId),
        playersOut: playersToSell,
        playersIn: playersToBuy,
        week: transferWeek,
        season: currentSeason,
      });

      setSuccess(`Transfer executed successfully for Week ${transferWeek}! Redirecting to lineup...`);
      setPlayersToSell([]);
      setPlayersToBuy([]);
      setPreview(null);

      // Refresh data
      await fetchData();

      // Refresh user team in auth context (updates navigation menu)
      await refreshUserTeam();

      // Redirect to lineup page after a short delay
      setTimeout(() => {
        router.push(`/teams/${teamId}/lineup`);
      }, 2000);
    } catch (error) {
      console.error('Error executing transfer:', error);
      setError(error.message || 'Failed to execute transfer');
    } finally {
      setExecuting(false);
    }
  }

  function togglePlayerToSell(playerId) {
    setPlayersToSell((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId]
    );
  }

  function togglePlayerToBuy(playerId) {
    setPlayersToBuy((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId]
    );
  }

  function handleOpenStats(player, e) {
    e.stopPropagation(); // Prevent card click
    setSelectedPlayer(player);
    setIsStatsModalOpen(true);
  }

  function handleCloseStats() {
    setIsStatsModalOpen(false);
    setSelectedPlayer(null);
  }

  function showAutoPickToast(message, type) {
    setAutoPickToast({ message, type });
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setAutoPickToast(null);
    }, 5000);
  }

  async function handleAutoPick() {
    try {
      // Calculate current roster composition including incoming players
      const currentRosterPlayers = [
        ...roster.filter(p => !playersToSell.includes(p.player_id)),
        ...playersToBuy.map(id => availablePlayers.find(p => p.player_id === id)).filter(Boolean)
      ];

      const positionCounts = {
        QB: currentRosterPlayers.filter(p => p.player_position === 'QB').length,
        RB: currentRosterPlayers.filter(p => p.player_position === 'RB').length,
        WR: currentRosterPlayers.filter(p => p.player_position === 'WR').length,
        TE: currentRosterPlayers.filter(p => p.player_position === 'TE').length,
        K: currentRosterPlayers.filter(p => p.player_position === 'K').length,
        DEF: currentRosterPlayers.filter(p => p.player_position === 'DEF').length,
      };

      const currentRosterCount = currentRosterPlayers.length;
      const spotsRemaining = 15 - currentRosterCount;

      if (spotsRemaining === 0) {
        setError('Your roster is already full!');
        return;
      }

      // Calculate budget from pending transfers
      let currentBudget = parseFloat(team.remaining_budget);
      if (preview) {
        currentBudget = preview.remainingBudget;
      }
      const fullBudget = currentBudget; // Track original budget for desperation mode

      // Target 99M total budget (leave 1M for flexibility)
      // Subtract 1M from available budget to leave buffer
      const bufferAmount = 1.0;
      const targetBudget = Math.max(0, currentBudget - bufferAmount);

      // Minimum player price constraint
      const MIN_PLAYER_PRICE = 4.5;

      // Calculate target price per player to maximize budget usage
      const targetPricePerPlayer = targetBudget / spotsRemaining;

      // Define requirements in priority order with budget weights
      // Higher weight = allocate more budget to this position
      // Total roster spots: 15
      // Min requirements: 10 (1 QB, 3 RB, 3 WR, 1 TE, 1 K, 1 DEF)
      // Flex spots: 5 (2nd QB, 2nd TE, 4th WR, 2nd K, 2nd DEF)
      const requirements = [
        // Minimum requirements (10 players)
        { position: 'QB', min: 1, priority: 1, budgetWeight: 1.3 },
        { position: 'RB', min: 3, priority: 2, budgetWeight: 1.2 },
        { position: 'WR', min: 3, priority: 3, budgetWeight: 1.2 },
        { position: 'TE', min: 1, priority: 4, budgetWeight: 1.0 },
        { position: 'K', min: 1, priority: 5, budgetWeight: 0.7 },
        { position: 'DEF', min: 1, priority: 6, budgetWeight: 0.7 },
        // Additional positions after minimum requirements (5 more players to reach 15)
        { position: 'QB', min: 2, priority: 7, budgetWeight: 1.1 },
        { position: 'TE', min: 2, priority: 8, budgetWeight: 0.9 },
        { position: 'WR', min: 4, priority: 9, budgetWeight: 1.1 },
        { position: 'K', min: 2, priority: 10, budgetWeight: 0.65 },
        { position: 'DEF', min: 2, priority: 11, budgetWeight: 0.65 },
      ];

      const selectedPlayerIds = [];
      let budgetExceeded = false;
      let budgetSpent = 0; // Track spending against target budget

      // Filter available players (not in roster)
      const eligiblePlayers = availablePlayers.filter(p =>
        !currentRosterPlayers.find(rp => rp.player_id === p.player_id) &&
        !selectedPlayerIds.includes(p.player_id)
      );

      // Sort requirements by priority
      requirements.sort((a, b) => a.priority - b.priority);

      // Calculate total positions still needed
      const calculateTotalNeeded = () => {
        return requirements.reduce((sum, req) => {
          const needed = Math.max(0, req.min - positionCounts[req.position]);
          return sum + needed;
        }, 0);
      };

      for (const req of requirements) {
        const needed = Math.max(0, req.min - positionCounts[req.position]);

        if (needed > 0 && selectedPlayerIds.length < spotsRemaining) {
          // Calculate how many positions we still need to fill after this one
          const totalStillNeeded = calculateTotalNeeded();
          const positionsAfterThis = totalStillNeeded - needed;

          // Reserve budget for remaining positions (minimum price each)
          const reservedBudget = positionsAfterThis * MIN_PLAYER_PRICE;
          const availableForThisPosition = currentBudget - reservedBudget;

          console.log(`Trying to fill ${needed} ${req.position}(s), current budget: $${currentBudget.toFixed(1)}M, reserved for future: $${reservedBudget.toFixed(1)}M, available: $${availableForThisPosition.toFixed(1)}M`);

          // Calculate target price for this position
          // Use the available budget (after reservation) to set an aggressive target
          const maxAffordable = availableForThisPosition / needed;
          const baseTargetPrice = targetPricePerPlayer * req.budgetWeight;

          // Target should be aggressive - use 90% of available budget per player
          // but respect the base target as a guide
          const aggressiveTarget = maxAffordable * 0.9;
          const targetPrice = Math.max(MIN_PLAYER_PRICE, Math.max(baseTargetPrice, aggressiveTarget));

          // Get players for this position, sorted by how close they are to target price
          const positionPlayers = eligiblePlayers
            .filter(p => p.player_position === req.position && !selectedPlayerIds.includes(p.player_id))
            .map(p => ({
              ...p,
              priceDiff: Math.abs(parseFloat(p.current_price) - targetPrice)
            }))
            .sort((a, b) => a.priceDiff - b.priceDiff); // Closest to target price first

          console.log(`  Found ${positionPlayers.length} ${req.position} players available, base target: $${baseTargetPrice.toFixed(1)}M, adjusted target: $${targetPrice.toFixed(1)}M`);

          for (let i = 0; i < needed && selectedPlayerIds.length < spotsRemaining; i++) {
            // Calculate how much we need to reserve for remaining spots AFTER this pick
            const spotsLeftAfterThis = spotsRemaining - selectedPlayerIds.length - 1;
            const reserveForRemainingSpots = spotsLeftAfterThis * MIN_PLAYER_PRICE;
            const maxWeCanSpend = currentBudget - reserveForRemainingSpots;

            // Get all affordable players for this position
            const affordablePlayers = positionPlayers.filter(p =>
              !selectedPlayerIds.includes(p.player_id) &&
              parseFloat(p.current_price) <= maxWeCanSpend
            );

            if (affordablePlayers.length > 0) {
              // Randomly select from top 5 affordable players (or all if fewer than 5)
              const poolSize = Math.min(5, affordablePlayers.length);
              const randomIndex = Math.floor(Math.random() * poolSize);
              const selectedPlayer = affordablePlayers[randomIndex];

              const playerPrice = parseFloat(selectedPlayer.current_price);
              console.log(`  Selected ${selectedPlayer.player_name} (${req.position}) for $${playerPrice.toFixed(1)}M (max allowed: $${maxWeCanSpend.toFixed(1)}M, picked from top ${poolSize})`);
              selectedPlayerIds.push(selectedPlayer.player_id);
              positionCounts[req.position]++;
              currentBudget -= playerPrice;
              budgetSpent += playerPrice;
            } else {
              // No affordable player found for this position
              console.log(`  FAILED: No affordable ${req.position} found with max spend $${maxWeCanSpend.toFixed(1)}M (budget: $${currentBudget.toFixed(1)}M, reserved: $${reserveForRemainingSpots.toFixed(1)}M)`);
              budgetExceeded = true;
              break; // Stop trying to fill this position requirement
            }
          }
        }
      }

      // Fill remaining spots with RBs and WRs closest to target price
      if (selectedPlayerIds.length < spotsRemaining) {
        const remainingSpots = spotsRemaining - selectedPlayerIds.length;

        // Be aggressive with remaining budget - aim to use 90% of what's left
        // Reserve minimum for future spots, use 90% of the rest per spot
        const reserveForAll = remainingSpots * MIN_PLAYER_PRICE;
        const budgetToSpend = currentBudget - reserveForAll;
        const aggressiveFlexTarget = (currentBudget - MIN_PLAYER_PRICE * (remainingSpots - 1)) * 0.9;

        const targetPriceForFlex = Math.max(MIN_PLAYER_PRICE, aggressiveFlexTarget);

        // Use full budget for filtering, not the buffer-reduced currentBudget
        const actualRemainingForFlex = fullBudget - budgetSpent;

        const flexPlayers = eligiblePlayers
          .filter(p =>
            (p.player_position === 'RB' || p.player_position === 'WR') &&
            !selectedPlayerIds.includes(p.player_id) &&
            parseFloat(p.current_price) <= actualRemainingForFlex
          )
          .map(p => ({
            ...p,
            priceDiff: Math.abs(parseFloat(p.current_price) - targetPriceForFlex)
          }))
          .sort((a, b) => a.priceDiff - b.priceDiff);

        while (selectedPlayerIds.length < spotsRemaining && flexPlayers.length > 0) {
          const spotsLeft = spotsRemaining - selectedPlayerIds.length;

          // Reserve budget for remaining spots (use actual remaining budget)
          const remainingAfterThis = spotsLeft - 1;
          const reserveForRemaining = remainingAfterThis * MIN_PLAYER_PRICE;
          const actualBudgetNow = fullBudget - budgetSpent;
          const maxWeCanSpend = actualBudgetNow - reserveForRemaining;

          // Filter to affordable players
          const affordableFlexPlayers = flexPlayers.filter(p =>
            !selectedPlayerIds.includes(p.player_id) &&
            parseFloat(p.current_price) <= maxWeCanSpend
          );

          if (affordableFlexPlayers.length === 0) break;

          // Randomly select from top 5 affordable flex players
          const poolSize = Math.min(5, affordableFlexPlayers.length);
          const randomIndex = Math.floor(Math.random() * poolSize);
          const selectedPlayer = affordableFlexPlayers[randomIndex];

          const playerPrice = parseFloat(selectedPlayer.current_price);
          selectedPlayerIds.push(selectedPlayer.player_id);
          budgetSpent += playerPrice;
          currentBudget = fullBudget - budgetSpent;

          // Recalculate target for next pick and re-sort
          const stillRemaining = spotsRemaining - selectedPlayerIds.length;
          if (stillRemaining > 0) {
            const reserveForRest = (stillRemaining - 1) * MIN_PLAYER_PRICE;
            const availableForNext = currentBudget - reserveForRest;
            const newTarget = Math.max(MIN_PLAYER_PRICE, availableForNext * 0.9);
            flexPlayers.forEach(p => {
              p.priceDiff = Math.abs(parseFloat(p.current_price) - newTarget);
            });
            flexPlayers.sort((a, b) => a.priceDiff - b.priceDiff);
          }
        }
      }

      // If still not full, fill remaining spots with ANY affordable players (desperation mode)
      // In desperation mode, use the FULL remaining budget (ignore buffer) to fill roster
      if (selectedPlayerIds.length < spotsRemaining) {
        // Recalculate actual remaining budget from full budget minus what we've spent
        let desperationBudget = fullBudget - budgetSpent;
        console.log(`Desperation mode: Need ${spotsRemaining - selectedPlayerIds.length} more players, actual budget remaining: $${desperationBudget.toFixed(1)}M`);

        const anyPlayers = eligiblePlayers
          .filter(p =>
            !selectedPlayerIds.includes(p.player_id) &&
            parseFloat(p.current_price) <= desperationBudget
          )
          .sort((a, b) => parseFloat(a.current_price) - parseFloat(b.current_price)); // Cheapest first

        console.log(`Found ${anyPlayers.length} affordable players to choose from`);

        while (selectedPlayerIds.length < spotsRemaining) {
          const spotsLeft = spotsRemaining - selectedPlayerIds.length;
          const reserveForRemaining = (spotsLeft - 1) * MIN_PLAYER_PRICE;
          const maxWeCanSpend = desperationBudget - reserveForRemaining;

          // Filter to currently affordable players
          const affordableNow = anyPlayers.filter(p =>
            !selectedPlayerIds.includes(p.player_id) &&
            parseFloat(p.current_price) <= maxWeCanSpend
          );

          if (affordableNow.length === 0) break;

          // Randomly select from top 5 cheapest affordable players
          const poolSize = Math.min(5, affordableNow.length);
          const randomIndex = Math.floor(Math.random() * poolSize);
          const selectedPlayer = affordableNow[randomIndex];

          const playerPrice = parseFloat(selectedPlayer.current_price);
          console.log(`Desperation mode selecting: ${selectedPlayer.player_name} (${selectedPlayer.player_position}) for $${playerPrice}M`);
          selectedPlayerIds.push(selectedPlayer.player_id);
          desperationBudget -= playerPrice;
          budgetSpent += playerPrice;
        }

        // Update currentBudget to reflect desperation spending
        currentBudget = fullBudget - budgetSpent;
        console.log(`After desperation mode: ${selectedPlayerIds.length} players selected`);
      }

      if (selectedPlayerIds.length === 0) {
        showAutoPickToast('No affordable players found to add to your roster.', 'error');
        return;
      }

      // Add selected players to buy list
      setPlayersToBuy([...playersToBuy, ...selectedPlayerIds]);

      const budgetRemaining = currentBudget;

      // Show message
      if (budgetExceeded) {
        showAutoPickToast(`Auto-pick complete! Selected ${selectedPlayerIds.length} players (spent $${budgetSpent.toFixed(1)}M), but couldn't fill all positions due to budget constraints. $${budgetRemaining.toFixed(1)}M remaining.`, 'error');
      } else {
        showAutoPickToast(`Auto-pick complete! Added ${selectedPlayerIds.length} players to your roster (spent $${budgetSpent.toFixed(1)}M). $${budgetRemaining.toFixed(1)}M remaining for flexibility.`, 'success');
      }

    } catch (error) {
      console.error('Error in auto-pick:', error);
      showAutoPickToast('Failed to auto-pick players', 'error');
    }
  }

  // Redirect if not authenticated or not the team owner
  useEffect(() => {
    if (!authLoading && !user) {
      // Not authenticated - redirect to login
      router.push('/login');
      return;
    }

    if (team && user && team.user_email !== user.email) {
      // Not the team owner - redirect to team page
      router.push(`/teams/${teamId}`);
    }
  }, [team, user, teamId, router, authLoading]);

  if (authLoading || loading) {
    return (
      <div className="text-center py-12">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <p className="mt-4 text-gray-600">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect to login
  }

  if (!team) {
    return <div className="text-center py-12 text-gray-500">Team not found</div>;
  }

  if (currentWeek === 'Setup') {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">The season is being prepared. Team selection will open during Preseason.</p>
      </div>
    );
  }

  const positionColors = {
    QB: 'pos-qb',
    RB: 'pos-rb',
    WR: 'pos-wr',
    TE: 'pos-te',
    K: 'pos-k',
    DEF: 'pos-def',
  };

  // Position order for sorting
  const positionOrder = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6 };

  // Sort roster by position then price
  const sortedRoster = [...roster].sort((a, b) => {
    const posA = positionOrder[a.player_position] || 99;
    const posB = positionOrder[b.player_position] || 99;
    if (posA !== posB) return posA - posB;
    return parseFloat(b.current_price) - parseFloat(a.current_price); // Higher price first
  });

  // Calculate effective roster count (current + incoming - outgoing)
  const effectiveRosterCount = roster.length - playersToSell.length + playersToBuy.length;

  // Get unique NFL teams for filter dropdown
  const nflTeams = [...new Set(availablePlayers.map(p => p.player_team).filter(Boolean))].sort();

  // Filter available players
  const filteredPlayers = availablePlayers.filter((player) => {
    const matchesPosition = filterPosition === 'all' || player.player_position === filterPosition;
    const matchesSearch = (player.player_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
                         (player.player_team?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesMinPrice = !filterMinPrice || parseFloat(player.current_price) >= parseFloat(filterMinPrice);
    const matchesMaxPrice = !filterMaxPrice || parseFloat(player.current_price) <= parseFloat(filterMaxPrice);
    const matchesNflTeam = filterNflTeam === 'all' || player.player_team === filterNflTeam;
    // Don't show players already in roster
    const notInRoster = !roster.find(p => p.player_id === player.player_id);
    return matchesPosition && matchesSearch && matchesMinPrice && matchesMaxPrice && matchesNflTeam && notInRoster;
  });

  return (
    <div className="space-y-6">
      {/* Auto-Pick Toast Notification */}
      {autoPickToast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`px-4 py-3 rounded-lg shadow-lg max-w-md flex items-start gap-3 ${
            autoPickToast.type === 'success'
              ? 'bg-positive-100 border border-positive-400 text-positive-800'
              : 'bg-danger-100 border border-danger-400 text-danger-800'
          }`}>
            <span className="text-lg">{autoPickToast.type === 'success' ? '✓' : '⚠'}</span>
            <div className="flex-1">
              <p className="font-medium text-sm">{autoPickToast.message}</p>
            </div>
            <button
              onClick={() => setAutoPickToast(null)}
              className="text-gray-500 hover:text-gray-700 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {roster.length > 0 && (
        <Link href={`/teams/${teamId}`} className="text-link-600 hover:text-link-700 hover:underline">
          ← Back to Team
        </Link>
      )}

      <div className="card">
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1">
            <h1 className="text-3xl font-bold mb-2">
              {roster.length === 0 ? 'Build Your Roster' : 'Transfers'} - {team.team_name}
            </h1>
            {roster.length === 0 ? (
              <div className="bg-primary-50 border border-primary-300 rounded-lg p-4 mt-2">
                <p className="text-primary-900 font-semibold">Welcome! Let's build your team</p>
                <p className="text-primary-700 text-sm mt-1">
                  Select 15 players from the available players below or use Auto-Pick to fill your roster automatically.
                </p>
                <p className="text-primary-700 text-sm mt-1">
                  <strong>Minimum requirements:</strong> 1 QB, 3 RB, 3 WR, 1 TE, 1 K, 1 DEF
                </p>
              </div>
            ) : (
              <p className="text-primary-700 font-semibold text-lg">
                {currentWeek === 'Preseason' ? 'Building Week 1 roster' : `Making transfers for Week ${transferWeek} lineup`}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 ml-6">
            <div className="flex items-center gap-2 justify-end">
              <div className="text-xs text-gray-600 whitespace-nowrap text-right w-28">Team Value:</div>
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-1">
                <div className="text-lg font-bold text-primary-600">
                  ${parseFloat(team.current_value || 0).toFixed(1)}M
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <div className="text-xs text-gray-600 whitespace-nowrap text-right w-28">Budget Remaining:</div>
              <div className="bg-white border border-gray-200 rounded-lg px-3 py-1">
                <div className="text-lg font-bold text-positive-600">
                  ${parseFloat(team.remaining_budget).toFixed(1)}M
                </div>
              </div>
            </div>
          </div>
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

      {/* Transfer Summary and Execute Button - Always Visible */}
      <div className="card bg-gradient-to-r from-primary-50 to-positive-50 border-2 border-primary-300 sticky top-4 z-10">
        {/* Header with Roster Total */}
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold">{roster.length === 0 ? 'Roster Selection' : 'Transfer Summary'}</h2>
          <div className="flex items-center">
            <span className="text-xs text-gray-600 mr-2">Roster:</span>
            <div className="bg-white rounded px-3 py-1 border border-primary-200">
              <span className={`text-lg font-bold ${(preview?.rosterCount || roster.length) === 15 ? 'text-primary-600' : 'text-danger-600'}`}>
                {preview?.rosterCount || roster.length}/15
              </span>
            </div>
          </div>
        </div>

        {/* Players In/Out Summary - Only show when roster exists */}
        {roster.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-white rounded px-3 py-1 border border-danger-200 flex justify-between items-center">
              <span className="text-xs text-gray-600">Players Out</span>
              <span className="text-lg font-bold text-danger-600">{playersToSell.length}</span>
            </div>
            <div className="bg-white rounded px-3 py-1 border border-positive-200 flex justify-between items-center">
              <span className="text-xs text-gray-600">Players In</span>
              <span className="text-lg font-bold text-positive-600">{playersToBuy.length}</span>
            </div>
          </div>
        )}

        {/* Financial Details */}
        {preview && (
          <div className="bg-white rounded p-2 mb-2 border border-primary-200 text-sm">
            {/* Player Values - hide during initial roster selection */}
            {roster.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="bg-danger-50 rounded p-2 border border-danger-200">
                  <div className="text-xs text-gray-600">Players Out</div>
                  <div className="text-base font-bold text-danger-600">
                    ${preview.moneyFreed.toFixed(1)}M
                  </div>
                </div>
                <div className="bg-positive-50 rounded p-2 border border-positive-200">
                  <div className="text-xs text-gray-600">Players In</div>
                  <div className="text-base font-bold text-positive-600">
                    ${preview.moneyNeeded.toFixed(1)}M
                  </div>
                </div>
              </div>
            )}

            {/* Budget After Transfer */}
            <div className={roster.length > 0 ? "pt-2 border-t border-gray-200" : ""}>
              <div className="flex justify-between items-center text-base">
                <div>
                  <span className="text-gray-600">Budget: </span>
                  <span className="font-bold text-gray-700">${parseFloat(team.remaining_budget).toFixed(1)}M</span>
                </div>
                <div>
                  <span className="text-gray-600">{roster.length === 0 ? 'Spending: ' : 'Change: '}</span>
                  <span className={`font-bold ${(preview.moneyNeeded - preview.moneyFreed) > 0 ? 'text-danger-600' : 'text-positive-600'}`}>
                    {roster.length === 0 ? '' : ((preview.moneyNeeded - preview.moneyFreed) > 0 ? '-' : '+')}${Math.abs(preview.moneyNeeded - preview.moneyFreed).toFixed(1)}M
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Remaining: </span>
                  <span className={`font-bold ${preview.isAffordable ? 'text-positive-600' : 'text-danger-600'}`}>
                    ${preview.remainingBudget.toFixed(1)}M
                  </span>
                </div>
              </div>
            </div>

            {/* Free Transfers and Point Cost - hide during initial roster selection */}
            {roster.length > 0 && (
              <div className="pt-2 border-t border-gray-200 mt-2">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-gray-600">Free Transfers: </span>
                    <span className="font-bold text-primary-600">
                      {currentWeek === 'Preseason' ? '∞' : preview.freeTransfersAvailable}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-600">Using: </span>
                    <span className="font-bold text-gray-700">{preview.transfersCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Point Cost: </span>
                    <span className={`font-bold ${preview.pointCost > 0 ? 'text-danger-600' : 'text-positive-600'}`}>
                      {preview.pointCost > 0 ? `-${preview.pointCost}` : '0'}
                    </span>
                  </div>
                </div>
                {currentWeek === 'Preseason' && (
                  <div className="text-xs text-primary-600 mt-1">
                    ℹ️ Unlimited free transfers during Preseason
                  </div>
                )}
                {currentWeek !== 'Preseason' && preview.pointCost > 0 && (
                  <div className="text-xs text-danger-600 mt-1">
                    ⚠️ Extra transfers cost 6 points each
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Execute Button */}
        {playersToSell.length === 0 && playersToBuy.length === 0 ? (
          <div className="bg-gray-100 border border-gray-300 text-gray-600 px-3 py-2 rounded text-center text-sm">
            {roster.length === 0 ? 'Select players to add to your roster' : 'Select players to buy or sell'}
          </div>
        ) : preview && !preview.positionValid ? (
          roster.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-400 text-yellow-800 px-3 py-2 rounded text-sm">
              ⚠ {preview.missingPositions}
            </div>
          ) : (
            <div className="bg-danger-100 border border-danger-400 text-danger-700 px-3 py-2 rounded text-sm">
              ❌ {preview.missingPositions}
            </div>
          )
        ) : preview && !preview.isAffordable ? (
          <div className="bg-danger-100 border border-danger-400 text-danger-700 px-3 py-2 rounded text-sm">
            ❌ Not enough budget!
          </div>
        ) : (
          <button
            onClick={handleExecuteTransfer}
            disabled={executing || !preview || !preview.isAffordable || !preview.positionValid}
            className="w-full bg-link-600 hover:bg-link-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:bg-gray-400 disabled:cursor-not-allowed text-base"
          >
            {executing ? 'Executing...' : roster.length === 0 ? 'Confirm Roster' : (playersToBuy.length + playersToSell.length > 2 ? 'Confirm Transfers' : 'Confirm Transfer')}
          </button>
        )}
      </div>

      {/* Current Roster */}
      <div className="card">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-2xl font-bold">Your Roster</h2>
          {effectiveRosterCount < 15 && (
            <button
              onClick={handleAutoPick}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium text-sm cursor-pointer"
            >
              Auto-Pick Remaining
            </button>
          )}
        </div>
        {roster.length > 0 && (
          <p className="text-sm text-gray-600 mb-4">
            Transfers will be applied to Week {transferWeek} lineup
          </p>
        )}
{(() => {
          // Combine current roster and incoming players
          const currentPlayers = sortedRoster.map(player => ({
            ...player,
            isIncoming: false
          }));

          const incomingPlayers = playersToBuy
            .map(playerId => availablePlayers.find(p => p.player_id === playerId))
            .filter(Boolean)
            .map(player => ({
              ...player,
              player_position: player.player_position,
              isIncoming: true
            }));

          // Combine and sort all players together
          const allPlayers = [...currentPlayers, ...incomingPlayers].sort((a, b) => {
            const posA = positionOrder[a.player_position] || 99;
            const posB = positionOrder[b.player_position] || 99;
            if (posA !== posB) return posA - posB;
            return parseFloat(b.current_price) - parseFloat(a.current_price);
          });

          if (allPlayers.length === 0) {
            return <div className="text-gray-500">No players in roster</div>;
          }

          return (
            <div className="space-y-2">
              {allPlayers.map((player) => {
                const isIncoming = player.isIncoming;
                const isSelected = playersToSell.includes(player.player_id);

                return (
                  <div
                    key={isIncoming ? `incoming-${player.player_id}` : player.player_id}
                    onClick={() => isIncoming ? togglePlayerToBuy(player.player_id) : togglePlayerToSell(player.player_id)}
                    className={`flex items-center justify-between p-3 rounded-lg border-2 transition-all cursor-pointer ${
                      isIncoming
                        ? 'bg-yellow-100 border-yellow-400 shadow-md hover:bg-yellow-200'
                        : isSelected
                          ? 'bg-red-100 border-red-400 shadow-md'
                          : 'bg-gray-50 border-gray-200 hover:border-red-300 hover:bg-red-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <span
                        className={`px-3 py-1 text-sm font-semibold rounded ${
                          positionColors[player.player_position] || 'bg-gray-100'
                        }`}
                      >
                        {player.player_position}
                      </span>
                      <div className="flex-1 flex items-center gap-2">
                        <div>
                          <div className="font-semibold">{player.player_name || 'Unknown Player'}</div>
                          <div className="text-sm text-gray-600">
                            {player.player_team || 'N/A'}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleOpenStats(player, e)}
                          className="text-primary-500 hover:text-primary-700 text-lg"
                          title="View player stats"
                        >
                          ℹ️
                        </button>
                      </div>
                      {isIncoming && (
                        <div className="text-xs font-semibold text-yellow-700 bg-yellow-200 px-2 py-1 rounded">
                          INCOMING
                        </div>
                      )}
                    </div>
                    {isIncoming ? (
                      <div className="flex gap-3 items-center">
                        <div className="text-center w-32">
                          <div className="text-xs text-gray-500 mb-1">Next 3 Fixtures</div>
                          <div className="text-xs font-medium text-gray-700">
                            {player.fixture_week_1 || '-'}, {player.fixture_week_2 || '-'}, {player.fixture_week_3 || '-'}
                          </div>
                        </div>
                        <div className="w-8"></div>
                        <div className="text-center w-16">
                          <div className="text-xs text-gray-500 mb-1">{currentWeek === 'Preseason' ? `${currentSeason - 1} Pts` : 'Total Pts'}</div>
                          <div className="text-sm font-semibold text-gray-700">
                            {currentWeek === 'Preseason'
                              ? (player.prev_season_total ? parseFloat(player.prev_season_total).toFixed(1) : '0')
                              : (player.season_total ? parseFloat(player.season_total).toFixed(1) : '-')}
                          </div>
                        </div>
                        <div className="w-8"></div>
                        <div className="w-20"></div>
                        <div className="w-20"></div>
                        <div className="text-center w-20">
                          <div className="text-xs text-gray-500 mb-1">Price</div>
                          <div className="text-sm font-semibold text-gray-700">
                            ${parseFloat(player.current_price).toFixed(1)}M
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3 items-center">
                        <div className="text-center w-32">
                          <div className="text-xs text-gray-500 mb-1">Next 3 Fixtures</div>
                          <div className="text-xs font-medium text-gray-700">
                            {player.fixture_week_1 || '-'}, {player.fixture_week_2 || '-'}, {player.fixture_week_3 || '-'}
                          </div>
                        </div>
                        <div className="w-8"></div>
                        <div className="text-center w-16">
                          <div className="text-xs text-gray-500 mb-1">{currentWeek === 'Preseason' ? `${currentSeason - 1} Pts` : 'Total Pts'}</div>
                          <div className="text-sm font-semibold text-gray-700">
                            {currentWeek === 'Preseason'
                              ? (player.prev_season_total ? parseFloat(player.prev_season_total).toFixed(1) : '0')
                              : (player.season_total ? parseFloat(player.season_total).toFixed(1) : '-')}
                          </div>
                        </div>
                        <div className="w-8"></div>
                        <div className="text-center w-20">
                          <div className="text-xs text-gray-500 mb-1">Purchase</div>
                          <div className="text-sm font-semibold text-gray-700">
                            ${parseFloat(player.purchase_price || player.current_price).toFixed(1)}M
                          </div>
                        </div>
                        <div className="text-center w-20">
                          <div className="text-xs text-gray-500 mb-1">Current</div>
                          <div className="text-sm font-semibold text-gray-700">
                            ${parseFloat(player.current_price).toFixed(1)}M
                          </div>
                        </div>
                        <div className="text-center w-20">
                          <div className="text-xs text-gray-500 mb-1">Sell</div>
                          <div className="text-sm font-semibold text-gray-700">
                            ${parseFloat(player.sell_price || player.current_price).toFixed(1)}M
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Available Players */}
      <div className="card">
        <h2 className="text-2xl font-bold mb-2">Available Players</h2>
        <p className="text-sm text-gray-600 mb-4">
          Players you buy will be added to your Week {transferWeek} roster
        </p>

        {/* Filters */}
        <div className="space-y-3 mb-4">
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Search players..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            />
            <select
              value={filterPosition}
              onChange={(e) => setFilterPosition(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            >
              <option value="all">All Positions</option>
              <option value="QB">QB</option>
              <option value="RB">RB</option>
              <option value="WR">WR</option>
              <option value="TE">TE</option>
              <option value="K">K</option>
              <option value="DEF">DEF</option>
            </select>
          </div>
          <div className="flex gap-3">
            <input
              type="number"
              placeholder="Min Price"
              value={filterMinPrice}
              onChange={(e) => setFilterMinPrice(e.target.value)}
              step="0.1"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            />
            <input
              type="number"
              placeholder="Max Price"
              value={filterMaxPrice}
              onChange={(e) => setFilterMaxPrice(e.target.value)}
              step="0.1"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            />
            <select
              value={filterNflTeam}
              onChange={(e) => setFilterNflTeam(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
            >
              <option value="all">All NFL Teams</option>
              {nflTeams.map((team) => (
                <option key={team} value={team}>{team}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredPlayers.length === 0 ? (
          <div className="text-gray-500">No players found</div>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {filteredPlayers.map((player) => (
              <div
                key={player.player_id}
                onClick={() => togglePlayerToBuy(player.player_id)}
                className={`flex items-center justify-between p-3 rounded-lg border-2 transition-all cursor-pointer ${
                  playersToBuy.includes(player.player_id)
                    ? 'bg-green-100 border-green-400 shadow-md'
                    : 'bg-gray-50 border-gray-200 hover:border-green-300 hover:bg-green-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-3 py-1 text-sm font-semibold rounded ${
                      positionColors[player.player_position] || 'bg-gray-100'
                    }`}
                  >
                    {player.player_position}
                  </span>
                  <div className="flex items-center gap-2">
                    <div>
                      <div className="font-semibold">{player.player_name || 'Unknown Player'}</div>
                      <div className="text-sm text-gray-600">
                        {player.player_team || 'N/A'}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleOpenStats(player, e)}
                      className="text-primary-500 hover:text-primary-700 text-lg"
                      title="View player stats"
                    >
                      ℹ️
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 items-center">
                  <div className="text-center w-32">
                    <div className="text-xs text-gray-500 mb-1">Next 3 Fixtures</div>
                    <div className="text-xs font-medium text-gray-700">
                      {player.fixture_week_1 || '-'}, {player.fixture_week_2 || '-'}, {player.fixture_week_3 || '-'}
                    </div>
                  </div>
                  <div className="w-8"></div>
                  <div className="text-center w-16">
                    <div className="text-xs text-gray-500 mb-1">{currentWeek === 'Preseason' ? `${currentSeason - 1} Pts` : 'Total Pts'}</div>
                    <div className="text-sm font-semibold text-gray-700">
                      {currentWeek === 'Preseason'
                        ? (player.prev_season_total ? parseFloat(player.prev_season_total).toFixed(1) : '0')
                        : (player.season_total ? parseFloat(player.season_total).toFixed(1) : '-')}
                    </div>
                  </div>
                  <div className="w-8"></div>
                  <div className="w-20"></div>
                  <div className="w-20"></div>
                  <div className="text-center w-20">
                    <div className="text-xs text-gray-500 mb-1">Price</div>
                    <div className="text-sm font-semibold text-gray-700">
                      ${parseFloat(player.current_price).toFixed(1)}M
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Player Stats Modal */}
      <PlayerStatsModal
        player={selectedPlayer}
        isOpen={isStatsModalOpen}
        onClose={handleCloseStats}
      />
    </div>
  );
}
