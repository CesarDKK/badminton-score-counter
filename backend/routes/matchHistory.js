const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');

// GET /api/match-history/all - Get all match history (public)
// NOTE: This route must come BEFORE /:courtId to avoid matching "all" as a courtId
router.get('/all', async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 30;
        const offset = parseInt(req.query.offset) || 0;

        // Use string interpolation for LIMIT/OFFSET as MySQL doesn't support placeholders for these
        const history = await query(
            `SELECT id, court_id, winner_name, loser_name,
                    games_won, duration, set_scores, match_date
             FROM match_history
             ORDER BY match_date DESC
             LIMIT ${limit} OFFSET ${offset}`
        );

        res.json(history);
    } catch (error) {
        next(error);
    }
});

// GET /api/match-history/:courtId - Get history for specific court (public)
router.get('/:courtId', async (req, res, next) => {
    try {
        const { courtId } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        // Use string interpolation for LIMIT as MySQL doesn't support placeholders for it
        const history = await query(
            `SELECT id, winner_name, loser_name, games_won, duration, set_scores, match_date
             FROM match_history
             WHERE court_id = ?
             ORDER BY match_date DESC
             LIMIT ${limit}`,
            [courtId]
        );

        res.json(history);
    } catch (error) {
        next(error);
    }
});

// POST /api/match-history - Save match result (public - used after match completion)
router.post('/', async (req, res, next) => {
    try {
        const { courtId, winnerName, loserName, gamesWon, duration, setScores } = req.body;

        // Validate input
        if (!courtId || !winnerName || !loserName || !gamesWon || !duration) {
            return res.status(400).json({ error: 'Alle felter er påkrævet' });
        }

        // Get court by court_number to get actual database id
        const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtId]);

        if (!court) {
            return res.status(400).json({ error: 'Bane ikke fundet' });
        }

        // Insert match result using actual court id
        const result = await query(
            `INSERT INTO match_history (court_id, winner_name, loser_name, games_won, duration, set_scores)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [court.id, winnerName, loserName, gamesWon, duration, setScores || null]
        );

        res.json({
            success: true,
            id: result.insertId
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
