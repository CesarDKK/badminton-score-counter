const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { fetchAndParseTournamentMatches, resolveClubNames, buildPlayerClubRows } = require('./importTournament');

// Best-effort: hent klub pr. spiller fra TS og upsert i tournament_player_clubs.
// Må ALDRIG kaste videre — klub-logoer er sekundære ift. selve importen.
async function captureTournamentClubs(tournamentId, sourceTournamentId) {
    if (!sourceTournamentId) return;
    try {
        const { matches } = await fetchAndParseTournamentMatches(sourceTournamentId);
        const clubIdToName = await resolveClubNames(sourceTournamentId, matches);
        const rows = buildPlayerClubRows(matches, clubIdToName);
        for (const r of rows) {
            await query(
                `INSERT INTO tournament_player_clubs (tournament_id, player_name, club, source_player_id)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE club = VALUES(club), source_player_id = VALUES(source_player_id)`,
                [tournamentId, r.player_name, r.club, r.source_player_id]
            );
        }
        console.log(`✓ Klub-opsamling: ${rows.length} spiller-klubber for turnering ${tournamentId}`);
    } catch (e) {
        console.error(`Klub-opsamling fejlede for turnering ${tournamentId}:`, e.message);
    }
}

// Et "rigtigt" navn er en faktisk spiller — ikke tomt, ikke en TS-placeholder.
// Bruges både til indkommende TS-navne og til at afgøre om en DB-værdi allerede
// er udfyldt (så vi ikke overskriver en rigtig spiller med "?"/tomt ved sync).
function isRealName(s) {
    if (!s) return false;
    const t = String(s).trim();
    if (!t || t === '?') return false;
    const lower = t.toLowerCase();
    if (lower === 'bye' || lower.startsWith('winner of') || lower.startsWith('vinder af')) return false;
    // Kun et seed-mærke som "[1]" uden navn
    if (/^\[\d+\]$/.test(t)) return false;
    return true;
}

// Normaliser et navn til sammenligning: fjern seed-suffiks "[1]" og kollaps whitespace.
function normalizeName(s) {
    return String(s || '').replace(/\s*\[\d+\]\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Trunkér til kolonne-grænsen (VARCHAR(100)) så et langt navn ikke fejler hele UPDATE'en.
function clampName(s) {
    if (s == null) return s;
    const t = String(s);
    return t.length > 100 ? t.substring(0, 100) : t;
}

// Beregn hvilke navne-/doubles-kolonner der skal opdateres for en pending-kamp ved sync.
// Regel (brugerens valg): skriv kun et indkommende TS-navn hvis det er RIGTIGT — så både
// "?"→navn og spiller-udskiftninger propagerer. Overskriv ALDRIG et eksisterende navn med
// tomt/"?" (ingen regression til placeholder). Returnerer {kolonne: ny værdi} for ændringer.
function computeFillOnlyChanges(row, incoming) {
    const dbS1 = [row.side1_player1, row.side1_player2];
    const dbS2 = [row.side2_player1, row.side2_player2];
    let inS1 = [incoming.side1Player1, incoming.side1Player2];
    let inS2 = [incoming.side2Player1, incoming.side2Player2];

    // Side-mapping: hvis DB allerede har rigtige navne, afgør via navne-overlap om TS
    // viser siderne ombyttet, så vi ikke lander navne på den forkerte side. Ingen overlap
    // (ren placeholder) → behold rækkefølgen (uskadeligt, der var intet at bytte om).
    const overlap = (a, b) => {
        const bset = new Set(b.filter(isRealName).map(normalizeName));
        return a.filter(isRealName).map(normalizeName).filter(n => bset.has(n)).length;
    };
    if (overlap(inS1, dbS2) + overlap(inS2, dbS1) > overlap(inS1, dbS1) + overlap(inS2, dbS2)) {
        const t = inS1; inS1 = inS2; inS2 = t;
    }

    const changes = {};
    const apply = (dbVal, inVal, col) => {
        if (isRealName(inVal) && String(inVal) !== String(dbVal || '')) {
            changes[col] = clampName(inVal);
        }
    };
    apply(dbS1[0], inS1[0], 'side1_player1');
    apply(dbS1[1], inS1[1], 'side1_player2');
    apply(dbS2[0], inS2[0], 'side2_player1');
    apply(dbS2[1], inS2[1], 'side2_player2');

    if (!!incoming.doubles !== !!row.doubles) changes.doubles = incoming.doubles ? 1 : 0;
    return changes;
}

// Per-turnering in-flight guard mod samtidige sync-kald (dobbeltklik / overlap).
const _syncingTournaments = new Set();

// Hjælper: hent alle matches for en turnering (sorteret efter match_order)
async function getMatchesForTournament(tournamentId) {
    return query(
        `SELECT id, match_order, label, doubles, source_match_id,
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
            `SELECT id, name, status, source_tournament_id, created_at
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
        const { name, sourceTournamentId } = req.body;
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
            `INSERT INTO tournaments (name, status, source_tournament_id) VALUES (?, 'active', ?)`,
            [name.trim(), sourceTournamentId || null]
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
                 (tournament_id, match_order, label, doubles, source_match_id,
                  side1_player1, side1_player2, side2_player1, side2_player2)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, nextOrder, m.label || null, m.doubles ? 1 : 0, m.sourceMatchId || null,
                    clampName(m.side1Player1) || null, clampName(m.side1Player2) || null,
                    clampName(m.side2Player1) || null, clampName(m.side2Player2) || null
                ]
            );
            nextOrder++;
            inserted++;
        }

        // Best-effort klub-opsamling hvis turneringen er TS-importeret (ikke-blokerende for svaret).
        const t = await queryOne('SELECT source_tournament_id FROM tournaments WHERE id = ?', [id]);
        if (t && t.source_tournament_id) {
            await captureTournamentClubs(id, t.source_tournament_id);
        }

        res.json({ success: true, inserted });
    } catch (error) {
        next(error);
    }
});

// POST /api/tournaments/:id/sync-import - Genhent TS-data og opdatér turneringen (kræver auth).
// Opdaterer KUN pending-kampe (fill-only, jf. computeFillOnlyChanges), rører aldrig
// aktive/afsluttede kampe, og returnerer nye TS-kampe som kandidater (indsættes ikke her —
// brugeren bekræfter dem via det normale bulk-endpoint).
router.post('/:id/sync-import', authMiddleware, async (req, res, next) => {
    const { id } = req.params;
    const key = String(id);
    if (_syncingTournaments.has(key)) {
        return res.status(409).json({ error: 'Opdatering kører allerede for denne turnering — vent til den er færdig.' });
    }
    _syncingTournaments.add(key);
    try {
        const tournament = await queryOne(
            'SELECT id, source_tournament_id FROM tournaments WHERE id = ?', [id]
        );
        if (!tournament) return res.status(404).json({ error: 'Turnering ikke fundet' });
        if (!tournament.source_tournament_id) {
            return res.status(400).json({
                error: 'Denne turnering er ikke importeret fra Tournament Software og kan ikke opdateres automatisk. Genimportér for at aktivere opdatering.'
            });
        }

        const { matches: incoming } = await fetchAndParseTournamentMatches(tournament.source_tournament_id);
        const existing = await getMatchesForTournament(id);

        const byKey = new Map();
        for (const row of existing) {
            if (row.source_match_id) byKey.set(row.source_match_id, row);
        }

        let updated = 0, unchanged = 0, skipped = 0;
        const newCandidates = [];

        for (const m of incoming) {
            const row = m.sourceMatchId ? byKey.get(m.sourceMatchId) : null;

            if (!row) {
                // Findes ikke i turneringen → ny kamp-kandidat (indsættes ikke automatisk).
                newCandidates.push({
                    sourceMatchId: m.sourceMatchId,
                    label: m.round ? `${m.category} — ${m.round}` : m.category,
                    category: m.category,
                    round: m.round,
                    dayLabel: m.dayLabel || '',
                    doubles: !!m.doubles,
                    side1Player1: m.side1Player1, side1Player2: m.side1Player2,
                    side2Player1: m.side2Player1, side2Player2: m.side2Player2
                });
                continue;
            }

            if (row.status !== 'pending') { skipped++; continue; } // aktiv/afsluttet — rør aldrig

            const changes = computeFillOnlyChanges(row, m);
            if (Object.keys(changes).length === 0) { unchanged++; continue; }

            const cols = Object.keys(changes);
            const setSql = cols.map(c => `${c} = ?`).join(', ');
            const vals = cols.map(c => changes[c]);
            // status='pending'-guard: hvis en bane lige har aktiveret kampen midt i sync,
            // rammer UPDATE'en 0 rækker → tæl som skipped i stedet for at overskrive.
            const result = await query(
                `UPDATE tournament_matches SET ${setSql} WHERE id = ? AND status = 'pending'`,
                [...vals, row.id]
            );
            if (result.affectedRows > 0) updated++; else skipped++;
        }

        await captureTournamentClubs(id, tournament.source_tournament_id);

        res.json({ updated, unchanged, skipped, newCandidates });
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return res.status(504).json({ error: 'Forbindelsen til tournamentsoftware.com timed out — prøv igen' });
        }
        console.error('Tournament sync-import failed:', error);
        res.status(502).json({ error: error.message || 'Opdatering fejlede' });
    } finally {
        _syncingTournaments.delete(key);
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
        if (status !== undefined) {
            fields.push('status = ?'); values.push(status);
            // Naar en kamp markeres 'finished', stempler vi tidspunktet saa
            // admin-baneoversigtens "Seneste kamp" kan sortere paa tvaers af
            // match_history, tournament_matches og team_match_games.
            if (status === 'finished') {
                fields.push('finished_at = CURRENT_TIMESTAMP');
            }
        }
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
