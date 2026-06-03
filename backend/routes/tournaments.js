const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// Hjælper: hent alle matches for en turnering (sorteret efter match_order)
async function getMatchesForTournament(tournamentId) {
    return query(
        `SELECT id, match_order, label, doubles,
                side1_player1, side1_player2, side2_player1, side2_player2,
                court_number, status, winner_team, set_scores, created_at
         FROM tournament_matches
         WHERE tournament_id = ?
         ORDER BY match_order ASC`,
        [tournamentId]
    );
}

// GET /api/tournaments/active - Alle aktive turneringer med matches (public)
router.get('/active', async (req, res, next) => {
    try {
        const tournaments = await query(
            `SELECT id, name, status, created_at
             FROM tournaments WHERE status = 'active'
             ORDER BY created_at DESC`
        );

        const result = [];
        for (const t of tournaments) {
            const matches = await getMatchesForTournament(t.id);
            result.push({ ...t, matches });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/tournaments/history - Alle afsluttede turneringer (public)
router.get('/history', async (req, res, next) => {
    try {
        const tournaments = await query(
            `SELECT id, name, status, created_at
             FROM tournaments WHERE status = 'finished'
             ORDER BY created_at DESC`
        );

        const result = [];
        for (const t of tournaments) {
            const matches = await getMatchesForTournament(t.id);
            result.push({ ...t, matches });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// POST /api/tournaments - Opret turnering (kræver auth)
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Navn er påkrævet' });
        }

        // Bloker hvis der findes en aktiv holdkamp — én type ad gangen
        const activeTeamMatch = await queryOne(
            `SELECT id, team1_name, team2_name FROM team_matches WHERE status = 'active' LIMIT 1`
        );
        if (activeTeamMatch) {
            return res.status(409).json({
                error: `Du har en aktiv holdkamp ("${activeTeamMatch.team1_name} vs ${activeTeamMatch.team2_name}"). Afslut eller slet den før du opretter en turnering.`
            });
        }

        const result = await query(
            `INSERT INTO tournaments (name, status) VALUES (?, 'active')`,
            [name.trim()]
        );

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        next(error);
    }
});

// POST /api/tournaments/:id/matches - Tilføj kamp (kræver auth)
router.post('/:id/matches', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            label, doubles,
            side1Player1, side1Player2,
            side2Player1, side2Player2
        } = req.body;

        const tournament = await queryOne('SELECT id FROM tournaments WHERE id = ?', [id]);
        if (!tournament) {
            return res.status(404).json({ error: 'Turnering ikke fundet' });
        }

        const maxRow = await queryOne(
            'SELECT COALESCE(MAX(match_order), 0) AS max_order FROM tournament_matches WHERE tournament_id = ?',
            [id]
        );
        const matchOrder = (maxRow?.max_order || 0) + 1;

        const result = await query(
            `INSERT INTO tournament_matches
             (tournament_id, match_order, label, doubles,
              side1_player1, side1_player2, side2_player1, side2_player2)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, matchOrder, label || null, doubles ? 1 : 0,
                side1Player1 || null, side1Player2 || null,
                side2Player1 || null, side2Player2 || null
            ]
        );

        res.json({ success: true, id: result.insertId, matchOrder });
    } catch (error) {
        next(error);
    }
});

// POST /api/tournaments/:id/matches/bulk - Tilføj mange kampe på én gang (kræver auth)
// Bruges af import-flowet så vi ikke laver hundredvis af enkelt-kald.
router.post('/:id/matches/bulk', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { matches } = req.body;

        if (!Array.isArray(matches) || matches.length === 0) {
            return res.status(400).json({ error: 'Ingen kampe at tilføje' });
        }

        const tournament = await queryOne('SELECT id FROM tournaments WHERE id = ?', [id]);
        if (!tournament) {
            return res.status(404).json({ error: 'Turnering ikke fundet' });
        }

        const maxRow = await queryOne(
            'SELECT COALESCE(MAX(match_order), 0) AS max_order FROM tournament_matches WHERE tournament_id = ?',
            [id]
        );
        let nextOrder = (maxRow?.max_order || 0) + 1;
        let inserted = 0;

        for (const m of matches) {
            await query(
                `INSERT INTO tournament_matches
                 (tournament_id, match_order, label, doubles,
                  side1_player1, side1_player2, side2_player1, side2_player2)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, nextOrder, m.label || null, m.doubles ? 1 : 0,
                    m.side1Player1 || null, m.side1Player2 || null,
                    m.side2Player1 || null, m.side2Player2 || null
                ]
            );
            nextOrder++;
            inserted++;
        }

        res.json({ success: true, inserted });
    } catch (error) {
        next(error);
    }
});

// PUT /api/tournaments/:id/matches/:matchId - Opdater kamp (public — bruges fra court)
router.put('/:id/matches/:matchId', async (req, res, next) => {
    try {
        const { id, matchId } = req.params;
        const {
            courtNumber, status, winnerTeam, setScores,
            label, doubles, matchOrder,
            side1Player1, side1Player2, side2Player1, side2Player2
        } = req.body;

        const match = await queryOne(
            'SELECT id FROM tournament_matches WHERE id = ? AND tournament_id = ?',
            [matchId, id]
        );
        if (!match) {
            return res.status(404).json({ error: 'Kamp ikke fundet' });
        }

        const fields = [];
        const values = [];

        if (courtNumber !== undefined) {
            // Frigør banen fra andre matches i samme turnering hvis den re-allokeres
            if (courtNumber !== null) {
                await query(
                    `UPDATE tournament_matches
                     SET court_number = NULL, status = 'pending'
                     WHERE tournament_id = ? AND court_number = ? AND id != ? AND status != 'finished'`,
                    [id, courtNumber, matchId]
                );
            }
            fields.push('court_number = ?');
            values.push(courtNumber);
        }
        if (status !== undefined) { fields.push('status = ?'); values.push(status); }
        if (winnerTeam !== undefined) { fields.push('winner_team = ?'); values.push(winnerTeam); }
        if (setScores !== undefined) { fields.push('set_scores = ?'); values.push(setScores); }
        if (label !== undefined) { fields.push('label = ?'); values.push(label || null); }
        if (doubles !== undefined) { fields.push('doubles = ?'); values.push(doubles ? 1 : 0); }
        if (matchOrder !== undefined) { fields.push('match_order = ?'); values.push(matchOrder); }
        if (side1Player1 !== undefined) { fields.push('side1_player1 = ?'); values.push(side1Player1 || null); }
        if (side1Player2 !== undefined) { fields.push('side1_player2 = ?'); values.push(side1Player2 || null); }
        if (side2Player1 !== undefined) { fields.push('side2_player1 = ?'); values.push(side2Player1 || null); }
        if (side2Player2 !== undefined) { fields.push('side2_player2 = ?'); values.push(side2Player2 || null); }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'Ingen felter at opdatere' });
        }

        values.push(matchId);
        await query(`UPDATE tournament_matches SET ${fields.join(', ')} WHERE id = ?`, values);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/tournaments/:id/finish - Marker turnering som afsluttet (kræver auth)
router.put('/:id/finish', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await query(`UPDATE tournaments SET status = 'finished' WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/tournaments - Slet alle AFSLUTTEDE turneringer (kræver auth)
// Bevarer aktive turneringer — det er en "ryd historik"-handling, ikke en nuke.
// CASCADE på tournament_matches.tournament_id fjerner deres kampe automatisk.
// NB: skal stå FØR /:id-routen ellers fanger den ikke den tomme path.
router.delete('/', authMiddleware, async (req, res, next) => {
    try {
        const result = await query(`DELETE FROM tournaments WHERE status = 'finished'`);
        res.json({ success: true, deleted: result.affectedRows || 0 });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/tournaments/:id/matches/:matchId - Slet enkelt kamp (kræver auth)
router.delete('/:id/matches/:matchId', authMiddleware, async (req, res, next) => {
    try {
        const { id, matchId } = req.params;
        await query(
            'DELETE FROM tournament_matches WHERE id = ? AND tournament_id = ?',
            [matchId, id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/tournaments/:id - Slet turnering (kræver auth, cascade fjerner matches)
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        await query('DELETE FROM tournaments WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
