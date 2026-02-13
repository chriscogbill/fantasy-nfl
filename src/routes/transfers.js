const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { getCurrentSeason } = require('../helpers/settings');

// POST /api/transfers/preview - Preview a transfer (calculate costs)
router.post('/preview', async (req, res) => {
  try {
    const { teamId, playersOut = [], playersIn = [], week } = req.body;
    const season = req.body.season ? parseInt(req.body.season) : await getCurrentSeason(pool);

    if (!teamId || !week) {
      return res.status(400).json({
        success: false,
        error: 'teamId and week are required'
      });
    }

    // Get current week to determine if in preseason
    const weekResult = await pool.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );
    const currentWeek = weekResult.rows[0]?.setting_value || 'Preseason';

    // Use database function to calculate transfer impact
    const result = await pool.query(
      `SELECT * FROM calculate_transfer_impact($1, $2, $3, $4, $5, $6)`,
      [teamId, week, season, playersOut, playersIn, currentWeek]
    );

    const impact = result.rows[0];

    res.json({
      success: true,
      preview: {
        currentSpent: parseFloat(impact.current_spent),
        moneyFreed: parseFloat(impact.money_freed),
        moneyNeeded: parseFloat(impact.money_needed),
        newTotalSpent: parseFloat(impact.new_total_spent),
        remainingBudget: parseFloat(impact.remaining_budget),
        isAffordable: impact.is_affordable,
        positionValid: impact.position_valid,
        missingPositions: impact.missing_positions,
        freeTransfersAvailable: impact.free_transfers_available,
        transfersCount: impact.transfers_count,
        pointCost: impact.point_cost,
        rosterCount: impact.roster_count
      }
    });
  } catch (error) {
    console.error('Error previewing transfer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/transfers/execute - Execute a transfer (buy/sell players)
router.post('/execute', async (req, res) => {
  const client = await pool.connect();

  try {
    const { teamId, playersOut = [], playersIn = [], week } = req.body;
    const season = req.body.season ? parseInt(req.body.season) : await getCurrentSeason(pool);

    if (!teamId || !week) {
      return res.status(400).json({
        success: false,
        error: 'teamId and week are required'
      });
    }

    await client.query('BEGIN');

    // Get current week to determine if in preseason
    const weekResult = await client.query(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'current_week'`
    );
    const currentWeek = weekResult.rows[0]?.setting_value || 'Preseason';

    // Check if roster exists for target week, if not copy from previous week
    const rosterCheck = await client.query(
      `SELECT COUNT(*) as count FROM rosters WHERE team_id = $1 AND week = $2 AND season = $3`,
      [teamId, week, season]
    );

    if (parseInt(rosterCheck.rows[0].count) === 0 && week > 1) {
      // Copy roster from previous week
      const prevWeek = week - 1;
      await client.query(
        `INSERT INTO rosters (team_id, player_id, week, season, position_slot)
         SELECT team_id, player_id, $1, season, position_slot
         FROM rosters
         WHERE team_id = $2 AND week = $3 AND season = $4`,
        [week, teamId, prevWeek, season]
      );
      console.log(`Copied roster from week ${prevWeek} to week ${week} for team ${teamId}`);
    }

    // 1. Check if transfer is affordable and calculate costs
    const affordCheck = await client.query(
      `SELECT * FROM calculate_transfer_impact($1, $2, $3, $4, $5, $6)`,
      [teamId, week, season, playersOut, playersIn, currentWeek]
    );

    if (!affordCheck.rows[0].is_affordable) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Transfer not affordable',
        budget: {
          needed: parseFloat(affordCheck.rows[0].money_needed),
          freed: parseFloat(affordCheck.rows[0].money_freed),
          total: parseFloat(affordCheck.rows[0].new_total_spent),
          remaining: parseFloat(affordCheck.rows[0].remaining_budget)
        }
      });
    }

    // 2. Check if transfer meets position requirements
    if (!affordCheck.rows[0].position_valid) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Transfer would violate position requirements. Missing: ${affordCheck.rows[0].missing_positions}`,
        missingPositions: affordCheck.rows[0].missing_positions
      });
    }

    const transferResults = {
      playersOut: [],
      playersIn: []
    };

    // 2. Remove players (sell)
    for (const playerId of playersOut) {
      // Get player price
      const priceResult = await client.query(
        `SELECT current_price FROM player_current_prices WHERE player_id = $1`,
        [playerId]
      );

      if (priceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: `Player ${playerId} not found`
        });
      }

      const price = parseFloat(priceResult.rows[0].current_price);

      // Remove from roster
      const deleteResult = await client.query(
        `DELETE FROM rosters
         WHERE team_id = $1 AND player_id = $2 AND week = $3 AND season = $4
         RETURNING *`,
        [teamId, playerId, week, season]
      );

      if (deleteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `Player ${playerId} not in roster for week ${week}`
        });
      }

      // Record transfer
      await client.query(
        `INSERT INTO transfers (team_id, player_id, transfer_type, price, week, season)
         VALUES ($1, $2, 'sell', $3, $4, $5)`,
        [teamId, playerId, price, week, season]
      );

      transferResults.playersOut.push({ playerId, price });
    }

    // 3. Add players (buy)
    for (const playerId of playersIn) {
      // Get player price
      const priceResult = await client.query(
        `SELECT current_price FROM player_current_prices WHERE player_id = $1`,
        [playerId]
      );

      if (priceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: `Player ${playerId} not found`
        });
      }

      const price = parseFloat(priceResult.rows[0].current_price);

      // Add to roster (on bench initially)
      await client.query(
        `INSERT INTO rosters (team_id, player_id, week, season, position_slot)
         VALUES ($1, $2, $3, $4, 'BENCH')
         ON CONFLICT (team_id, player_id, week, season) DO NOTHING`,
        [teamId, playerId, week, season]
      );

      // Record transfer
      await client.query(
        `INSERT INTO transfers (team_id, player_id, transfer_type, price, week, season)
         VALUES ($1, $2, 'buy', $3, $4, $5)`,
        [teamId, playerId, price, week, season]
      );

      transferResults.playersIn.push({ playerId, price });
    }

    // 4. Update team budget and free transfers
    const newSpent = parseFloat(affordCheck.rows[0].new_total_spent);
    const transfersUsed = affordCheck.rows[0].transfers_count;
    const pointCost = affordCheck.rows[0].point_cost;
    const freeTransfersAvailable = affordCheck.rows[0].free_transfers_available;

    // Calculate new free transfers remaining
    let newFreeTransfers = freeTransfersAvailable;
    if (currentWeek !== 'Preseason') {
      newFreeTransfers = Math.max(0, freeTransfersAvailable - transfersUsed);
    }

    await client.query(
      `UPDATE teams
       SET current_spent = $1, remaining_budget = 100.0 - $1, free_transfers_remaining = $3
       WHERE team_id = $2`,
      [newSpent, teamId, newFreeTransfers]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Transfer executed successfully',
      transfers: transferResults,
      newBudget: {
        spent: newSpent,
        remaining: 100.0 - newSpent
      },
      freeTransfersRemaining: newFreeTransfers,
      pointCost: pointCost
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error executing transfer:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
});

// POST /api/transfers/validate-roster - Validate a proposed roster
router.post('/validate-roster', async (req, res) => {
  try {
    const { playerIds } = req.body;
    const season = req.body.season ? parseInt(req.body.season) : await getCurrentSeason(pool);

    if (!playerIds || !Array.isArray(playerIds)) {
      return res.status(400).json({
        success: false,
        error: 'playerIds array is required'
      });
    }

    const result = await pool.query(
      `SELECT * FROM validate_roster($1, $2)`,
      [playerIds, season]
    );

    const validation = result.rows[0];

    res.json({
      success: true,
      validation: {
        isValid: validation.is_valid,
        totalCost: parseFloat(validation.total_cost),
        remainingBudget: parseFloat(validation.remaining_budget),
        playerCount: validation.player_count,
        positions: {
          qb: validation.qb_count,
          rb: validation.rb_count,
          wr: validation.wr_count,
          te: validation.te_count,
          k: validation.k_count,
          def: validation.def_count
        },
        message: validation.validation_message
      }
    });
  } catch (error) {
    console.error('Error validating roster:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/transfers/history - Get all transfers (admin/global view)
router.get('/history', async (req, res) => {
  try {
    const season = req.query.season ? parseInt(req.query.season) : await getCurrentSeason(pool);
    const { week, limit = 50 } = req.query;

    let query = `
      SELECT
        t.transfer_id,
        t.team_id,
        tm.team_name,
        t.player_id,
        p.name as player_name,
        p.position,
        t.transfer_type,
        t.price,
        t.week,
        t.season,
        t.transfer_date
      FROM transfers t
      JOIN teams tm ON t.team_id = tm.team_id
      JOIN players p ON t.player_id = p.player_id
      WHERE t.season = $1
    `;

    const params = [season];

    if (week) {
      query += ` AND t.week = $${params.length + 1}`;
      params.push(week);
    }

    query += ` ORDER BY t.transfer_date DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      count: result.rows.length,
      transfers: result.rows
    });
  } catch (error) {
    console.error('Error fetching transfer history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
