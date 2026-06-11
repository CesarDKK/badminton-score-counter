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

// GET /api/match-history/:courtId/latest - Newest match on court across all sources (public)
// match_history rummer kun ad-hoc kampe og holdkampe (turneringskampe gemmes ikke
// dér for at undgaa duplikater i Historik-fanen). Saa for at "Seneste kamp"-knappen
// paa admin-baneoversigten kan vise den faktisk-nyeste kamp, queryer vi alle tre
// kilder og vaelger den nyeste paa finished_at / match_date.
router.get('/:courtId/latest', async (req, res, next) => {
    try {
        const courtNumber = parseInt(req.params.courtId, 10);
        if (!Number.isInteger(courtNumber)) {
            return res.status(400).json({ error: 'Ugyldig courtId' });
        }

        const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtNumber]);
        if (!court) {
            return res.json(null);
        }

        const histMatch = await queryOne(
            `SELECT id, winner_name, loser_name, games_won, duration, set_scores, match_date
             FROM match_history
             WHERE court_id = ?
             ORDER BY match_date DESC LIMIT 1`,
            [court.id]
        );

        const tournMatch = await queryOne(
            `SELECT tm.id, tm.doubles, tm.label,
                    tm.side1_player1, tm.side1_player2,
                    tm.side2_player1, tm.side2_player2,
                    tm.winner_team, tm.set_scores, tm.finished_at,
                    t.name AS tournament_name
             FROM tournament_matches tm
             LEFT JOIN tournaments t ON t.id = tm.tournament_id
             WHERE tm.court_number = ? AND tm.status = 'finished' AND tm.finished_at IS NOT NULL
             ORDER BY tm.finished_at DESC LIMIT 1`,
            [courtNumber]
        );

        const teamGame = await queryOne(
            `SELECT tmg.id, tmg.category,
                    tmg.team1_player1, tmg.team1_player2,
                    tmg.team2_player1, tmg.team2_player2,
                    tmg.winner_team, tmg.set_scores, tmg.finished_at,
                    tm.team1_name, tm.team2_name
             FROM team_match_games tmg
             LEFT JOIN team_matches tm ON tm.id = tmg.team_match_id
             WHERE tmg.court_number = ? AND tmg.status = 'finished' AND tmg.finished_at IS NOT NULL
             ORDER BY tmg.finished_at DESC LIMIT 1`,
            [courtNumber]
        );

        const candidates = [];
        if (histMatch) {
            candidates.push({ source: 'history', ts: histMatch.match_date, row: histMatch });
        }
        if (tournMatch) {
            candidates.push({ source: 'tournament', ts: tournMatch.finished_at, row: tournMatch });
        }
        if (teamGame) {
            candidates.push({ source: 'team', ts: teamGame.finished_at, row: teamGame });
        }

        if (!candidates.length) {
            return res.json(null);
        }

        candidates.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
        const winner = candidates[0];

        // Sammensaet "Jens & Bo" (doubles) eller "Jens" (singles) i samme format som
        // court-script bruger til winner/loser-navne, saa parseHistorySetScores
        // kan matche navne mod set_scores-strengen.
        const pair = (a, b) => (a && b) ? `${a} & ${b}` : (a || b || '');

        const countSets = (raw, winnerName) => {
            if (!raw || raw === 'W.O.') return { w: 0, l: 0 };
            const sets = String(raw).split(',').map(s => s.trim()).filter(Boolean);
            let w = 0, l = 0;
            for (const s of sets) {
                const m = s.match(/^(.*?)\s+(\d+)\s*-\s*(\d+)\s+(.*?)$/);
                if (!m) continue;
                const leftName = m[1].trim();
                const leftScore = parseInt(m[2], 10);
                const rightScore = parseInt(m[3], 10);
                const leftWon = leftScore > rightScore;
                const leftIsWinner = winnerName && leftName === winnerName;
                if (leftIsWinner ? leftWon : !leftWon) w++;
                else l++;
            }
            return { w, l };
        };

        let payload;
        if (winner.source === 'history') {
            const r = winner.row;
            payload = {
                source: 'history',
                id: r.id,
                winner_name: r.winner_name,
                loser_name: r.loser_name,
                games_won: r.games_won,
                duration: r.duration,
                set_scores: r.set_scores,
                match_date: r.match_date
            };
        } else if (winner.source === 'tournament') {
            const r = winner.row;
            const side1 = pair(r.side1_player1, r.side1_player2);
            const side2 = pair(r.side2_player1, r.side2_player2);
            const winnerName = r.winner_team === 1 ? side1 : side2;
            const loserName = r.winner_team === 1 ? side2 : side1;
            const setsCount = countSets(r.set_scores, winnerName);
            payload = {
                source: 'tournament',
                id: r.id,
                winner_name: winnerName,
                loser_name: loserName,
                games_won: `${setsCount.w}-${setsCount.l}`,
                duration: '',
                set_scores: r.set_scores,
                match_date: r.finished_at,
                tournament_name: r.tournament_name,
                label: r.label
            };
        } else {
            const r = winner.row;
            const side1 = pair(r.team1_player1, r.team1_player2);
            const side2 = pair(r.team2_player1, r.team2_player2);
            const winnerName = r.winner_team === 1 ? side1 : side2;
            const loserName = r.winner_team === 1 ? side2 : side1;
            const setsCount = countSets(r.set_scores, winnerName);
            payload = {
                source: 'team',
                id: r.id,
                winner_name: winnerName,
                loser_name: loserName,
                games_won: `${setsCount.w}-${setsCount.l}`,
                duration: '',
                set_scores: r.set_scores,
                match_date: r.finished_at,
                team1_name: r.team1_name,
                team2_name: r.team2_name,
                category: r.category
            };
        }

        res.json(payload);
    } catch (error) {
        next(error);
    }
});

// GET /api/match-history/:courtId - Get history for specific court (public)
// courtId i URL'en er court_number — vi mapper til court.id (DB primary key),
// da match_history.court_id altid lagrer den interne id (sat ved POST).
router.get('/:courtId', async (req, res, next) => {
    try {
        const { courtId } = req.params;

        // Validate and sanitize limit to prevent SQL injection via interpolation
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 1000); // 1-1000

        // Verify it's a valid integer (not NaN)
        if (!Number.isInteger(limit)) {
            return res.status(400).json({ error: 'Ugyldig limit parameter' });
        }

        const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtId]);
        if (!court) {
            // Bane findes ikke — returner tomt array i stedet for 404,
            // saa frontend kan vise "ingen kampe" uden at fejl-haandtere.
            return res.json([]);
        }

        // Use string interpolation for LIMIT as MySQL doesn't support placeholders for it
        const history = await query(
            `SELECT id, winner_name, loser_name, games_won, duration, set_scores, match_date
             FROM match_history
             WHERE court_id = ?
             ORDER BY match_date DESC
             LIMIT ${limit}`,
            [court.id]
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
