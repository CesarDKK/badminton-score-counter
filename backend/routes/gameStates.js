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
                    timer_seconds, deciding_game_switched,
                    rest_break_active, rest_break_seconds_left, rest_break_title,
                    set_scores_history, match_start_time, match_end_time
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
                restBreakActive: false,
                restBreakSecondsLeft: 0,
                restBreakTitle: '',
                setScoresHistory: [],
                matchStartTime: null,
                matchEndTime: null,
                isActive: !!court.is_active,
                isDoubles: !!court.is_doubles,
                gameMode: court.game_mode
            });
        }

        // Format response
        const setScoresHistory = gameState.set_scores_history
            ? (typeof gameState.set_scores_history === 'string'
                ? JSON.parse(gameState.set_scores_history)
                : gameState.set_scores_history)
            : [];

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
            restBreakActive: !!gameState.rest_break_active,
            restBreakSecondsLeft: gameState.rest_break_seconds_left || 0,
            restBreakTitle: gameState.rest_break_title || '',
            setScoresHistory: setScoresHistory,
            matchStartTime: gameState.match_start_time,
            matchEndTime: gameState.match_end_time,
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
        const { player1, player2, timerSeconds, decidingGameSwitched, restBreakActive, restBreakSecondsLeft, restBreakTitle, isDoubles, setScoresHistory } = req.body;

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

        // Serialize setScoresHistory for storage
        const setScoresHistoryJson = setScoresHistory
            ? JSON.stringify(setScoresHistory)
            : '[]';

        // Check if match is ending (someone won 2 games)
        const matchEnding = (player1.games >= 2 || player2.games >= 2);

        // Check for match activity to set start time
        const hasActivity =
            (player1.score > 0) ||
            (player2.score > 0) ||
            (player1.games > 0) ||
            (player2.games > 0) ||
            (timerSeconds > 0);

        // Check if this is a reset (no activity at all)
        const isReset = !hasActivity;

        // Upsert game state (insert or update) using actual court.id
        await query(
            `INSERT INTO game_states (
                court_id, player1_name, player1_name2, player1_score, player1_games,
                player2_name, player2_name2, player2_score, player2_games,
                timer_seconds, deciding_game_switched,
                rest_break_active, rest_break_seconds_left, rest_break_title,
                set_scores_history, match_start_time, match_end_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL)
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
                deciding_game_switched = VALUES(deciding_game_switched),
                rest_break_active = VALUES(rest_break_active),
                rest_break_seconds_left = VALUES(rest_break_seconds_left),
                rest_break_title = VALUES(rest_break_title),
                set_scores_history = VALUES(set_scores_history),
                match_start_time = IF(? = 1, NULL, COALESCE(match_start_time, IF(? = 1, NOW(), NULL))),
                match_end_time = IF(? = 1, NULL, IF(? = 1, NOW(), match_end_time))`,
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
                decidingGameSwitched || false,
                restBreakActive || false,
                restBreakSecondsLeft || 0,
                restBreakTitle || '',
                setScoresHistoryJson,
                isReset ? 1 : 0,       // For resetting match_start_time
                hasActivity ? 1 : 0,   // For setting match_start_time on first activity
                isReset ? 1 : 0,       // For resetting match_end_time
                matchEnding ? 1 : 0    // For setting match_end_time when match ends
            ]
        );

        // Auto-update court active status based on activity (unless skipped by admin)
        // Only set to active if there IS activity, never set to inactive
        // This allows admin to manually mark courts as active without gameplay interference
        if (!skipAutoActive && hasActivity) {
            await query('UPDATE courts SET is_active = TRUE WHERE id = ?', [court.id]);
        }

        // Update court's isDoubles setting if provided
        if (isDoubles !== undefined && typeof isDoubles === 'boolean') {
            await query('UPDATE courts SET is_doubles = ? WHERE id = ?', [isDoubles, court.id]);
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
