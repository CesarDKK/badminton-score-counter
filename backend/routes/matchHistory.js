const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/match-history/all - Get all match history (public)
// NOTE: This route must come BEFORE /:courtId to avoid matching "all" as a courtId
router.get('/all', async (req, res, next) => {
    try {
        // Validate and sanitize limit/offset to prevent SQL injection via interpolation
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 1000); // 1-1000
        const offset = Math.max(parseInt(req.query.offset) || 0, 0); // 0+

        // Verify they are valid integers (not NaN)
        if (!Number.isInteger(limit) || !Number.isInteger(offset)) {
            return res.status(400).json({ error: 'Ugyldige limit/offset parametre' });
        }

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

        // Validate and sanitize limit to prevent SQL injection via interpolation
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 1000); // 1-1000

        // Verify it's a valid integer (not NaN)
        if (!Number.isInteger(limit)) {
            return res.status(400).json({ error: 'Ugyldig limit parameter' });
        }

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

// DELETE /api/match-history/all - Delete all match history (protected - requires authentication)
router.delete('/all', authMiddleware, async (req, res, next) => {
    try {
        await query('DELETE FROM match_history');

        res.json({
            success: true,
            message: 'Alt kamphistorik er blevet slettet'
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
