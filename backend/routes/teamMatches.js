const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/team-matches/history - Get all finished team matches with games (public)
router.get('/history', async (req, res, next) => {
    try {
        const teamMatches = await query(
            `SELECT id, format, team1_name, team2_name, status, created_at
             FROM team_matches WHERE status = 'finished'
             ORDER BY created_at DESC`
        );

        const result = [];
        for (const tm of teamMatches) {
            const games = await query(
                `SELECT id, game_number, category,
                        team1_player1, team1_player2, team2_player1, team2_player2,
                        court_number, status, winner_team, set_scores
                 FROM team_match_games
                 WHERE team_match_id = ?
                 ORDER BY game_number ASC`,
                [tm.id]
            );
            result.push({ ...tm, games });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/team-matches/active - Get active team match with all games (public)
router.get('/active', async (req, res, next) => {
    try {
        const teamMatch = await queryOne(
            `SELECT id, format, team1_name, team2_name, status, created_at
             FROM team_matches WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
        );

        if (!teamMatch) {
            return res.json(null);
        }

        const games = await query(
            `SELECT id, game_number, category,
                    team1_player1, team1_player2, team2_player1, team2_player2,
                    court_number, status, winner_team, set_scores
             FROM team_match_games
             WHERE team_match_id = ?
             ORDER BY game_number ASC`,
            [teamMatch.id]
        );

        res.json({ ...teamMatch, games });
    } catch (error) {
        next(error);
    }
});

// GET /api/team-matches/active-all - Alle aktive holdkampe med delkampe (public)
router.get('/active-all', async (req, res, next) => {
    try {
        const teamMatches = await query(
            `SELECT id, format, team1_name, team2_name, status, created_at
             FROM team_matches WHERE status = 'active'
             ORDER BY created_at ASC`
        );

        const result = [];
        for (const tm of teamMatches) {
            const games = await query(
                `SELECT id, game_number, category,
                        team1_player1, team1_player2, team2_player1, team2_player2,
                        court_number, status, winner_team, set_scores
                 FROM team_match_games
                 WHERE team_match_id = ?
                 ORDER BY game_number ASC`,
                [tm.id]
            );
            result.push({ ...tm, games });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/team-matches/by-court/:courtId - Den aktive delkamp på en bane + dens holdkamp (public)
router.get('/by-court/:courtId', async (req, res, next) => {
    try {
        const courtNumber = parseInt(req.params.courtId, 10);
        if (!courtNumber) return res.json(null);

        const game = await queryOne(
            `SELECT g.id, g.team_match_id, g.game_number, g.category,
                    g.team1_player1, g.team1_player2, g.team2_player1, g.team2_player2,
                    g.court_number, g.status, g.winner_team, g.set_scores
             FROM team_match_games g
             JOIN team_matches tm ON tm.id = g.team_match_id
             WHERE g.court_number = ? AND g.status = 'active' AND tm.status = 'active'
             LIMIT 1`,
            [courtNumber]
        );
        if (!game) return res.json(null);

        const teamMatch = await queryOne(
            `SELECT id, format, team1_name, team2_name, status, created_at
             FROM team_matches WHERE id = ?`,
            [game.team_match_id]
        );
        if (!teamMatch) return res.json(null);

        res.json({ ...teamMatch, game });
    } catch (error) {
        next(error);
    }
});

// POST /api/team-matches - Create new team match (requires auth)
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const { format, team1Name, team2Name, games } = req.body;

        if (!format || !team1Name || !team2Name || !games || !Array.isArray(games)) {
            return res.status(400).json({ error: 'Alle felter er påkrævet' });
        }

        // Bloker hvis der findes en aktiv turnering — én type ad gangen
        const activeTournament = await queryOne(
            `SELECT id, name FROM tournaments WHERE status = 'active' LIMIT 1`
        );
        if (activeTournament) {
            return res.status(409).json({
                error: `Du har en aktiv turnering ("${activeTournament.name}"). Afslut eller slet den før du opretter en holdkamp.`
            });
        }

        // Create new team match
        const result = await query(
            `INSERT INTO team_matches (format, team1_name, team2_name, status) VALUES (?, ?, ?, 'active')`,
            [format, team1Name, team2Name]
        );

        const teamMatchId = result.insertId;

        // Insert all games
        for (let i = 0; i < games.length; i++) {
            const g = games[i];
            await query(
                `INSERT INTO team_match_games
                 (team_match_id, game_number, category, team1_player1, team1_player2, team2_player1, team2_player2)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [teamMatchId, i + 1, g.category,
                 g.team1Player1 || null, g.team1Player2 || null,
                 g.team2Player1 || null, g.team2Player2 || null]
            );
        }

        res.json({ success: true, id: teamMatchId });
    } catch (error) {
        next(error);
    }
});

// PUT /api/team-matches/:id/games/:gameId - Update a game (public - used from court)
router.put('/:id/games/:gameId', async (req, res, next) => {
    try {
        const { id, gameId } = req.params;
        const { courtNumber, status, winnerTeam, setScores, team1Player1, team1Player2, team2Player1, team2Player2 } = req.body;

        // Verify game belongs to this team match
        const game = await queryOne(
            `SELECT id FROM team_match_games WHERE id = ? AND team_match_id = ?`,
            [gameId, id]
        );

        if (!game) {
            return res.status(404).json({ error: 'Delkamp ikke fundet' });
        }

        const fields = [];
        const values = [];

        if (courtNumber !== undefined) {
            if (courtNumber !== null) {
                // Find enhver ANDEN aktiv delkamp på samme bane — også i andre holdkampe.
                const occupant = await queryOne(
                    `SELECT g.id, g.team_match_id
                     FROM team_match_games g
                     JOIN team_matches tm ON tm.id = g.team_match_id
                     WHERE g.court_number = ? AND g.status = 'active'
                       AND tm.status = 'active' AND g.id != ?`,
                    [courtNumber, gameId]
                );

                if (occupant) {
                    // Er banen i gang? (samme definition som admin-dropdownen)
                    const gs = await queryOne(
                        `SELECT gs.player1_score, gs.player2_score,
                                gs.player1_games, gs.player2_games, gs.timer_seconds
                         FROM courts c
                         JOIN game_states gs ON c.id = gs.court_id
                         WHERE c.court_number = ?`,
                        [courtNumber]
                    );
                    const inProgress = gs && (
                        gs.player1_score > 0 || gs.player2_score > 0 ||
                        gs.player1_games > 0 || gs.player2_games > 0 ||
                        gs.timer_seconds > 0
                    );
                    if (inProgress) {
                        return res.status(409).json({
                            error: 'Bane optaget — der spilles allerede en kamp på denne bane.'
                        });
                    }
                    // Ikke startet: frigør den siddende delkamp (uanset holdkamp).
                    await query(
                        `UPDATE team_match_games SET court_number = NULL, status = 'pending'
                         WHERE id = ?`,
                        [occupant.id]
                    );
                }
            }
            fields.push('court_number = ?');
            values.push(courtNumber);
        }
        if (status !== undefined) {
            fields.push('status = ?'); values.push(status);
            // Naar en delkamp markeres 'finished', stempler vi tidspunktet saa
            // admin-baneoversigtens "Seneste kamp" kan sortere paa tvaers af
            // match_history, team_match_games og tournament_matches.
            if (status === 'finished') {
                fields.push('finished_at = CURRENT_TIMESTAMP');
            }
        }
        if (winnerTeam !== undefined) { fields.push('winner_team = ?'); values.push(winnerTeam); }
        if (setScores !== undefined) { fields.push('set_scores = ?'); values.push(setScores); }
        if (team1Player1 !== undefined) { fields.push('team1_player1 = ?'); values.push(team1Player1 || null); }
        if (team1Player2 !== undefined) { fields.push('team1_player2 = ?'); values.push(team1Player2 || null); }
        if (team2Player1 !== undefined) { fields.push('team2_player1 = ?'); values.push(team2Player1 || null); }
        if (team2Player2 !== undefined) { fields.push('team2_player2 = ?'); values.push(team2Player2 || null); }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'Ingen felter at opdatere' });
        }

        values.push(gameId);
        await query(`UPDATE team_match_games SET ${fields.join(', ')} WHERE id = ?`, values);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/team-matches/:id/finish - Mark team match as finished (requires auth)
router.put('/:id/finish', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await query(`UPDATE team_matches SET status = 'finished' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/team-matches - Delete ALL team matches (requires auth)
router.delete('/', authMiddleware, async (req, res, next) => {
    try {
        await query(`DELETE FROM team_matches`);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/team-matches/:id - Delete team match (requires auth)
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await query(`DELETE FROM team_matches WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
