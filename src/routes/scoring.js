const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { requireAdmin } = require('../middleware/requireAuth');

// GET /api/scoring - Get all current scoring rules grouped by section
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.scoring_id, s.scoring_type, s.points, s.league_format, s.description,
              s.scoring_section, ss.section_name
       FROM scoring s
       LEFT JOIN scoring_sections ss ON s.scoring_section = ss.section_id
       ORDER BY s.scoring_section, s.scoring_id`
    );

    // Group by section
    const sections = {};
    result.rows.forEach(row => {
      const sectionName = row.section_name || 'Other';
      if (!sections[sectionName]) {
        sections[sectionName] = {
          section_id: row.scoring_section,
          section_name: sectionName,
          rules: []
        };
      }
      sections[sectionName].rules.push({
        scoring_id: row.scoring_id,
        scoring_type: row.scoring_type,
        points: parseFloat(row.points),
        league_format: row.league_format,
        description: row.description
      });
    });

    res.json({
      success: true,
      count: result.rows.length,
      sections: Object.values(sections),
      rules: result.rows
    });
  } catch (error) {
    console.error('Error fetching scoring rules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/scoring/:id - Update a scoring rule's points value (admin only)
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { points } = req.body;

    if (points === undefined || points === null) {
      return res.status(400).json({ success: false, error: 'points value is required' });
    }

    const result = await pool.query(
      `UPDATE scoring SET points = $1 WHERE scoring_id = $2 RETURNING *`,
      [parseFloat(points), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Scoring rule not found' });
    }

    res.json({
      success: true,
      message: `Scoring rule updated: ${result.rows[0].scoring_type} = ${points} points`,
      rule: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating scoring rule:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/scoring/archive - Get archived scoring rules for a previous season
router.get('/archive', async (req, res) => {
  try {
    const season = parseInt(req.query.season);
    if (!season) {
      return res.status(400).json({ success: false, error: 'season parameter is required' });
    }

    const result = await pool.query(
      `SELECT * FROM scoring_archive
       WHERE season = $1
       ORDER BY scoring_section, archive_id`,
      [season]
    );

    // Group by section
    const sections = {};
    result.rows.forEach(row => {
      const sectionName = row.section_name || 'Other';
      if (!sections[sectionName]) {
        sections[sectionName] = {
          section_name: sectionName,
          rules: []
        };
      }
      sections[sectionName].rules.push({
        scoring_type: row.scoring_type,
        points: parseFloat(row.points),
        league_format: row.league_format,
        description: row.description
      });
    });

    res.json({
      success: true,
      season,
      count: result.rows.length,
      sections: Object.values(sections)
    });
  } catch (error) {
    console.error('Error fetching archived scoring rules:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
