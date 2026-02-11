const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { requireAdmin } = require('../middleware/requireAuth');

// GET /api/deadlines?season=2024 — Get all deadlines for a season
router.get('/', async (req, res) => {
  try {
    const season = parseInt(req.query.season) || 2024;
    const result = await pool.query(
      'SELECT * FROM lineup_deadlines WHERE season = $1 ORDER BY week',
      [season]
    );
    res.json({ success: true, deadlines: result.rows });
  } catch (error) {
    console.error('Error fetching deadlines:', error);
    res.json({ success: false, error: 'Failed to fetch deadlines' });
  }
});

// GET /api/deadlines/:season/:week — Get deadline for a specific week
router.get('/:season/:week', async (req, res) => {
  try {
    const { season, week } = req.params;
    const result = await pool.query(
      'SELECT * FROM lineup_deadlines WHERE season = $1 AND week = $2',
      [parseInt(season), parseInt(week)]
    );
    if (result.rows.length === 0) {
      return res.json({ success: true, deadline: null });
    }
    res.json({ success: true, deadline: result.rows[0] });
  } catch (error) {
    console.error('Error fetching deadline:', error);
    res.json({ success: false, error: 'Failed to fetch deadline' });
  }
});

// PUT /api/deadlines/:season/:week — Admin: set/update a deadline manually
router.put('/:season/:week', requireAdmin, async (req, res) => {
  try {
    const { season, week } = req.params;
    const { deadline_datetime, description } = req.body;

    if (!deadline_datetime) {
      return res.status(400).json({ success: false, error: 'deadline_datetime is required' });
    }

    const dt = new Date(deadline_datetime);
    const deadline_day = getDayOfWeek(dt);

    const result = await pool.query(
      `INSERT INTO lineup_deadlines (season, week, deadline_datetime, deadline_day, description, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (season, week) DO UPDATE SET
         deadline_datetime = EXCLUDED.deadline_datetime,
         deadline_day = EXCLUDED.deadline_day,
         description = EXCLUDED.description,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [parseInt(season), parseInt(week), dt.toISOString(), deadline_day, description || null]
    );

    res.json({ success: true, deadline: result.rows[0] });
  } catch (error) {
    console.error('Error updating deadline:', error);
    res.status(500).json({ success: false, error: 'Failed to update deadline' });
  }
});

// POST /api/deadlines/import — Admin: import deadlines from ESPN API for a season
router.post('/import', requireAdmin, async (req, res) => {
  try {
    const season = parseInt(req.body.season) || 2024;
    const results = [];

    for (let week = 1; week <= 18; week++) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`;
        const response = await fetch(url);
        const data = await response.json();

        const events = data.events || [];
        if (events.length === 0) {
          results.push({ week, status: 'no games found' });
          continue;
        }

        // Find the earliest game date (first kickoff of the week)
        let earliestDate = null;
        let earliestName = '';
        for (const event of events) {
          const gameDate = new Date(event.date);
          if (!earliestDate || gameDate < earliestDate) {
            earliestDate = gameDate;
            earliestName = event.shortName || event.name || '';
          }
        }

        if (!earliestDate) {
          results.push({ week, status: 'no valid dates' });
          continue;
        }

        const deadline_day = getDayOfWeek(earliestDate);

        await pool.query(
          `INSERT INTO lineup_deadlines (season, week, deadline_datetime, deadline_day, description, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (season, week) DO UPDATE SET
             deadline_datetime = EXCLUDED.deadline_datetime,
             deadline_day = EXCLUDED.deadline_day,
             description = EXCLUDED.description,
             updated_at = CURRENT_TIMESTAMP`,
          [season, week, earliestDate.toISOString(), deadline_day, `First kickoff: ${earliestName}`]
        );

        results.push({ week, status: 'imported', datetime: earliestDate.toISOString(), description: earliestName });
      } catch (weekError) {
        console.error(`Error importing week ${week}:`, weekError);
        results.push({ week, status: 'error', error: weekError.message });
      }
    }

    res.json({ success: true, season, results });
  } catch (error) {
    console.error('Error importing deadlines:', error);
    res.status(500).json({ success: false, error: 'Failed to import deadlines' });
  }
});

// Helper: Convert a Date to day-of-week (Mon=1, Tue=2, ... Sun=7)
function getDayOfWeek(date) {
  const jsDay = date.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  // Convert to Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=7
  return jsDay === 0 ? 7 : jsDay;
}

module.exports = router;
