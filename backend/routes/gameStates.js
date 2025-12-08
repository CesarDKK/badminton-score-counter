const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/game-states/:courtId - Get current game state for court (public)
router.get('/:courtId', async (req, res, next) => {
    try {
        const { courtId } = req.params;

        // Get court info by court_number (not id)
        const court = await queryOne('SELECT id, is_active, is_doubles, game_mode FROM courts WHERE court_number = ?', [courtId]);

        if (!court) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        // Get game state using the actual court id from database
        const gameState = await queryOne(
            `SELECT player1_name, player1_name2, player1_score, player1_games,
                    player2_name, player2_name2, player2_score, player2_games,
                    timer_seconds, deciding_game_switched
             FROM game_states WHERE court_id = ?`,
            [court.id]
        );

        if (!gameState) {
            // Return default state if no game state exists
            return res.json({
                player1: { name: 'Spiller 1', name2: 'Makker 1', score: 0, games: 0 },
                player2: { name: 'Spiller 2', name2: 'Makker 2', score: 0, games: 0 },
                timerSeconds: 0,
                decidingGameSwitched: false,
                isActive: !!court.is_active,
                isDoubles: !!court.is_doubles,
                gameMode: court.game_mode
            });
        }

        // Format response
        res.json({
            player1: {
                name: gameState.player1_name,
                name2: gameState.player1_name2,
                score: gameState.player1_score,
                games: gameState.player1_games
            },
            player2: {
                name: gameState.player2_name,
                name2: gameState.player2_name2,
                score: gameState.player2_score,
                games: gameState.player2_games
            },
            timerSeconds: gameState.timer_seconds,
            decidingGameSwitched: !!gameState.deciding_game_switched,
            isActive: !!court.is_active,
            isDoubles: !!court.is_doubles,
            gameMode: court.game_mode
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/game-states/:courtId - Update/create game state (public - used during gameplay)
router.put('/:courtId', async (req, res, next) => {
    try {
        const { courtId } = req.params;
        const { player1, player2, timerSeconds, decidingGameSwitched } = req.body;

        // Check if we should skip auto-updating active status (for admin edits)
        const skipAutoActive = req.query.skipAutoActive === 'true';

        // Verify court exists by court_number
        const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtId]);

        if (!court) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        // Validate input
        if (!player1 || !player2) {
            return res.status(400).json({ error: 'Spillerdata mangler' });
        }

        // Upsert game state (insert or update) using actual court.id
        await query(
            `INSERT INTO game_states (
                court_id, player1_name, player1_name2, player1_score, player1_games,
                player2_name, player2_name2, player2_score, player2_games,
                timer_seconds, deciding_game_switched
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                player1_name = VALUES(player1_name),
                player1_name2 = VALUES(player1_name2),
                player1_score = VALUES(player1_score),
                player1_games = VALUES(player1_games),
                player2_name = VALUES(player2_name),
                player2_name2 = VALUES(player2_name2),
                player2_score = VALUES(player2_score),
                player2_games = VALUES(player2_games),
                timer_seconds = VALUES(timer_seconds),
                deciding_game_switched = VALUES(deciding_game_switched)`,
            [
                court.id,  // Use actual database id, not court number
                player1.name || 'Spiller 1',
                player1.name2 || 'Makker 1',
                player1.score || 0,
                player1.games || 0,
                player2.name || 'Spiller 2',
                player2.name2 || 'Makker 2',
                player2.score || 0,
                player2.games || 0,
                timerSeconds || 0,
                decidingGameSwitched || false
            ]
        );

        // Auto-update court active status based on activity (unless skipped by admin)
        // Only set to active if there IS activity, never set to inactive
        // This allows admin to manually mark courts as active without gameplay interference
        if (!skipAutoActive) {
            const hasActivity =
                (player1.score > 0) ||
                (player2.score > 0) ||
                (player1.games > 0) ||
                (player2.games > 0) ||
                (timerSeconds > 0);

            // Only update if there IS activity (set active), don't clear it if no activity
            if (hasActivity) {
                await query('UPDATE courts SET is_active = TRUE WHERE id = ?', [court.id]);
            }
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/game-states/:courtId - Reset court (requires auth)
router.delete('/:courtId', authMiddleware, async (req, res, next) => {
    try {
        const { courtId } = req.params;

        // Get court by court_number
        const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtId]);

        if (!court) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        // Delete game state
        await query('DELETE FROM game_states WHERE court_id = ?', [court.id]);

        // Set court to inactive
        await query('UPDATE courts SET is_active = FALSE WHERE id = ?', [court.id]);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
