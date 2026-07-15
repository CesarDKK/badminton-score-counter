const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware, requireWriteAuthInClubMode } = require('../middleware/auth');
const { invalidateCourtTokens } = require('./matchSessionTokens');
const { publishGameStateChange, subscribeGameStateChanges } = require('../events/gameStateEvents');

// Hvor længe (i minutter) et "last finished match" snapshot vises på TV efter Ryd bane
const FINISHED_SNAPSHOT_TTL_MINUTES = 5;

function parseSetScores(raw) {
    if (!raw) return [];
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return []; }
    }
    return raw;
}

// Formaterer en game_states-raekke til API-formatet — bruges af GET, 409-konflikt-
// svar og PUT, saa klienterne altid ser praecis samme felt-struktur.
function formatStateRow(row, court) {
    return {
        player1: {
            name: row.player1_name,
            name2: row.player1_name2,
            score: row.player1_score,
            games: row.player1_games
        },
        player2: {
            name: row.player2_name,
            name2: row.player2_name2,
            score: row.player2_score,
            games: row.player2_games
        },
        timerSeconds: row.timer_seconds,
        decidingGameSwitched: !!row.deciding_game_switched,
        restBreakActive: !!row.rest_break_active,
        restBreakSecondsLeft: row.rest_break_seconds_left || 0,
        restBreakTitle: row.rest_break_title || '',
        setScoresHistory: parseSetScores(row.set_scores_history),
        matchStartTime: row.match_start_time,
        matchEndTime: row.match_end_time,
        // Serverberegnet forløbet tid (sekunder) — samme ur som match_start_time,
        // så klienter slipper for at sammenligne serverens og eget ur
        elapsedSeconds: typeof row.elapsed_seconds === 'number' ? row.elapsed_seconds : null,
        matchCompleted: !!row.match_completed,
        isActive: !!court.is_active,
        isDoubles: !!court.is_doubles,
        gameMode: court.game_mode,
        servingPlayer: row.serving_player,
        initialServer: row.initial_server,
        servingTeam: row.serving_team,
        servingPlayerOnTeam: row.serving_player_on_team,
        team1RightCourt: row.team1_right_court || 1,
        team2RightCourt: row.team2_right_court || 1,
        betweenSets: !!row.between_sets,
        version: row.version || 0
    };
}

// Henter og auto-udløber snapshot for en bane. Returnerer null hvis intet/udløbet.
async function fetchFinishedSnapshot(courtPk) {
    const snap = await queryOne(
        `SELECT player1_name, player1_name2, player2_name, player2_name2,
                player1_games, player2_games, set_scores_history, is_doubles,
                match_end_time, cleared_at,
                TIMESTAMPDIFF(SECOND, cleared_at, NOW()) AS age_seconds
         FROM last_finished_matches WHERE court_id = ?`,
        [courtPk]
    );
    if (!snap) return null;
    if (snap.age_seconds >= FINISHED_SNAPSHOT_TTL_MINUTES * 60) {
        await query('DELETE FROM last_finished_matches WHERE court_id = ?', [courtPk]);
        return null;
    }
    return {
        player1: {
            name: snap.player1_name,
            name2: snap.player1_name2,
            games: snap.player1_games
        },
        player2: {
            name: snap.player2_name,
            name2: snap.player2_name2,
            games: snap.player2_games
        },
        setScoresHistory: parseSetScores(snap.set_scores_history),
        isDoubles: !!snap.is_doubles,
        matchEndTime: snap.match_end_time,
        clearedAt: snap.cleared_at,
        ttlSeconds: Math.max(0, FINISHED_SNAPSHOT_TTL_MINUTES * 60 - snap.age_seconds)
    };
}

// GET /api/game-states/batch/all - Get all game states in one request (public, for overview page)
// NOTE: This route must be defined BEFORE /:courtId to avoid matching "batch" as a courtId
router.get('/batch/all', async (req, res, next) => {
    try {
        // Get all courts with their game states in a single optimized query
        const results = await query(`
            SELECT
                c.court_number as courtId,
                c.is_active as isActive,
                c.is_doubles as isDoubles,
                c.game_mode as gameMode,
                gs.player1_name, gs.player1_name2, gs.player1_score, gs.player1_games,
                gs.player2_name, gs.player2_name2, gs.player2_score, gs.player2_games,
                gs.timer_seconds, gs.deciding_game_switched,
                gs.rest_break_active, gs.rest_break_seconds_left, gs.rest_break_title,
                gs.set_scores_history, gs.match_start_time, gs.match_end_time, gs.match_completed,
                gs.version,
                TIMESTAMPDIFF(SECOND, gs.match_start_time, COALESCE(gs.match_end_time, NOW())) AS elapsed_seconds
            FROM courts c
            LEFT JOIN game_states gs ON c.id = gs.court_id
            ORDER BY c.court_number ASC
        `);

        // Format results
        const courtStates = results.map(row => {
            const setScoresHistory = row.set_scores_history
                ? (typeof row.set_scores_history === 'string'
                    ? JSON.parse(row.set_scores_history)
                    : row.set_scores_history)
                : [];

            // If no game state exists, return default values
            if (!row.player1_name) {
                return {
                    courtId: row.courtId,
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
                    matchCompleted: false,
                    isActive: !!row.isActive,
                    isDoubles: !!row.isDoubles,
                    gameMode: row.gameMode,
                    version: 0
                };
            }

            return {
                courtId: row.courtId,
                player1: {
                    name: row.player1_name,
                    name2: row.player1_name2,
                    score: row.player1_score,
                    games: row.player1_games
                },
                player2: {
                    name: row.player2_name,
                    name2: row.player2_name2,
                    score: row.player2_score,
                    games: row.player2_games
                },
                timerSeconds: row.timer_seconds,
                decidingGameSwitched: !!row.deciding_game_switched,
                restBreakActive: !!row.rest_break_active,
                restBreakSecondsLeft: row.rest_break_seconds_left || 0,
                restBreakTitle: row.rest_break_title || '',
                setScoresHistory: setScoresHistory,
                matchStartTime: row.match_start_time,
                matchEndTime: row.match_end_time,
                elapsedSeconds: typeof row.elapsed_seconds === 'number' ? row.elapsed_seconds : null,
                matchCompleted: !!row.match_completed,
                isActive: !!row.isActive,
                isDoubles: !!row.isDoubles,
                gameMode: row.gameMode,
                version: row.version || 0
            };
        });

        res.json(courtStates);
    } catch (error) {
        next(error);
    }
});

// GET /api/game-states/events/stream - Server-Sent Events med "poke"-events (public)
// Klienter (TV/admin/oversigt) faar {courtId, type} ved hver aendring og henter
// derefter selv frisk state via GET — saa er payload-formatet altid det samme
// som ved almindelig polling, og eventet kan aldrig vise u-committet data.
// ?court=N filtrerer til een bane (TV); uden filter sendes alle baner (admin/oversigt).
// NOTE: Skal defineres FOER /:courtId saa "events" ikke matches som courtId.
router.get('/events/stream', (req, res) => {
    const courtFilter = req.query.court ? parseInt(req.query.court, 10) : null;

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        // Beder nginx om ikke at buffere denne response — ellers naar events
        // foerst frem naar bufferen er fuld
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    // res.flush findes naar compression-middleware er aktiv — uden flush
    // holder den paa dataene og eventet kommer aldrig ud
    const send = (payload) => {
        res.write(payload);
        if (typeof res.flush === 'function') res.flush();
    };

    // Genforbind hurtigt ved tab af forbindelse (EventSource auto-reconnect)
    send('retry: 2000\n\n');

    const unsubscribe = subscribeGameStateChanges(req, (event) => {
        // Config-events (sponsorer/settings/tema/logoer) gaelder alle skaerme og
        // filtreres ikke pr. bane — kun bane-specifikke game-state-events goer.
        if (event.type !== 'config' && courtFilter !== null && event.courtId !== courtFilter) return;
        send(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Heartbeat holder forbindelsen aaben gennem nginx' proxy_read_timeout (90s)
    const heartbeat = setInterval(() => send(': ping\n\n'), 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
});

// GET /api/game-states/:courtId - Get current game state for court (public)
router.get('/:courtId', async (req, res, next) => {
    try {
        const { courtId } = req.params;

        // Get court info by court_number (not id)
        const court = await queryOne('SELECT id, is_active, is_doubles, game_mode FROM courts WHERE court_number = ?', [courtId]);

        if (!court) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        // Get game state using the actual court id from database.
        // elapsed_seconds beregnes af databasen så starttid og "nu" måles
        // med samme ur — klientens ur kan være skævt ift. serverens.
        const gameState = await queryOne(
            `SELECT *,
                    TIMESTAMPDIFF(SECOND, match_start_time, COALESCE(match_end_time, NOW())) AS elapsed_seconds
             FROM game_states WHERE court_id = ?`,
            [court.id]
        );

        if (!gameState) {
            // Return default state if no game state exists, men evt. med snapshot
            const lastFinishedMatch = await fetchFinishedSnapshot(court.id);
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
                matchCompleted: false,
                isActive: !!court.is_active,
                isDoubles: !!court.is_doubles,
                gameMode: court.game_mode,
                servingPlayer: null,
                initialServer: null,
                servingTeam: null,
                servingPlayerOnTeam: null,
                team1RightCourt: 1,
                team2RightCourt: 1,
                betweenSets: false,
                version: 0,
                lastFinishedMatch
            });
        }

        // Snapshot er kun relevant når banen ikke længere er aktiv —
        // mens en kamp kører ses snapshot ikke (og kan ikke eksistere samtidig
        // med game_state, da PUT rydder snapshottet ved aktivitet).
        const lastFinishedMatch = !court.is_active
            ? await fetchFinishedSnapshot(court.id)
            : null;

        res.json({
            ...formatStateRow(gameState, court),
            lastFinishedMatch
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/game-states/:courtId - Update/create game state
// Kræver et gyldigt adgangslink i club-mode; åben i direct-mode (se middleware)
//
// Merge-semantik: felter der IKKE er med i request body beholder deres nuvaerende
// vaerdi, saa klienter kan noejes med at sende det de aendrer (fx admin: kun navne).
// Tidligere overskrev PUT alle felter — en admin-navnerettelse midt i en kamp
// nulstillede derfor saethistorik og servestatus til defaults.
//
// Optimistic concurrency: klienter medsender expectedVersion (fra seneste GET/PUT-svar).
// Ved mismatch svares 409 + serverens aktuelle tilstand, saa klienten kan merge og
// proeve igen i stedet for stiltiende at overskrive en anden enheds aendring.
// Klienter uden expectedVersion (aeldre court/tv-sider) beholder last-write-wins.
router.put('/:courtId', requireWriteAuthInClubMode, async (req, res, next) => {
    try {
        const { courtId } = req.params;
        const body = req.body || {};
        const has = (key) => Object.prototype.hasOwnProperty.call(body, key);

        // Check if we should skip auto-updating active status (for admin edits)
        const skipAutoActive = req.query.skipAutoActive === 'true';

        // Verify court exists by court_number
        const court = await queryOne(
            'SELECT id, is_active, is_doubles, game_mode FROM courts WHERE court_number = ?',
            [courtId]
        );

        if (!court) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        const existing = await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);

        const conflictResponse = (row) => res.status(409).json({
            error: 'Banens tilstand er ændret af en anden enhed',
            conflict: true,
            version: row ? (row.version || 0) : 0,
            state: row ? formatStateRow(row, court) : null
        });

        const expectedVersion = has('expectedVersion') ? Number(body.expectedVersion) : null;
        if (expectedVersion !== null) {
            if (!existing && expectedVersion > 0) {
                // Rækken er slettet siden klientens seneste læsning — banen er nulstillet
                return conflictResponse(null);
            }
            if (existing && (existing.version || 0) !== expectedVersion) {
                return conflictResponse(existing);
            }
        }

        // Ved oprettelse kræves spillerdata (som før); på eksisterende række er partiel opdatering ok
        if (!existing && (!body.player1 || !body.player2)) {
            return res.status(400).json({ error: 'Spillerdata mangler' });
        }

        // Update court's is_active status if provided
        if (typeof body.isActive === 'boolean') {
            await query(
                'UPDATE courts SET is_active = ? WHERE court_number = ?',
                [body.isActive, courtId]
            );
        }

        // ---- Merge body med eksisterende række ----
        const mergePlayer = (provided, prefix, defName, defName2) => {
            const p = provided || {};
            const hasP = (k) => Object.prototype.hasOwnProperty.call(p, k);
            const ex = (col, def) => existing ? existing[col] : def;
            return {
                name:  hasP('name')  ? (p.name  || defName)  : ex(`${prefix}_name`, defName),
                name2: hasP('name2') ? (p.name2 || defName2) : ex(`${prefix}_name2`, defName2),
                score: hasP('score') ? (p.score || 0) : ex(`${prefix}_score`, 0),
                games: hasP('games') ? (p.games || 0) : ex(`${prefix}_games`, 0)
            };
        };
        const player1 = mergePlayer(body.player1, 'player1', 'Spiller 1', 'Makker 1');
        const player2 = mergePlayer(body.player2, 'player2', 'Spiller 2', 'Makker 2');

        const timerSeconds = has('timerSeconds') ? (body.timerSeconds || 0) : (existing ? existing.timer_seconds : 0);
        const decidingGameSwitched = has('decidingGameSwitched') ? (body.decidingGameSwitched || false) : (existing ? !!existing.deciding_game_switched : false);
        const restBreakActive = has('restBreakActive') ? (body.restBreakActive || false) : (existing ? !!existing.rest_break_active : false);
        const restBreakSecondsLeft = has('restBreakSecondsLeft') ? (body.restBreakSecondsLeft || 0) : (existing ? existing.rest_break_seconds_left : 0);
        const restBreakTitle = has('restBreakTitle') ? (body.restBreakTitle || '') : (existing ? (existing.rest_break_title || '') : '');
        const matchCompleted = has('matchCompleted') ? (body.matchCompleted || false) : (existing ? !!existing.match_completed : false);
        const servingPlayer = has('servingPlayer') ? (body.servingPlayer || null) : (existing ? existing.serving_player : null);
        const initialServer = has('initialServer') ? (body.initialServer || null) : (existing ? existing.initial_server : null);
        const servingTeam = has('servingTeam') ? (body.servingTeam || null) : (existing ? existing.serving_team : null);
        const servingPlayerOnTeam = has('servingPlayerOnTeam') ? (body.servingPlayerOnTeam || null) : (existing ? existing.serving_player_on_team : null);
        const team1RightCourt = has('team1RightCourt') ? (body.team1RightCourt || 1) : (existing ? (existing.team1_right_court || 1) : 1);
        const team2RightCourt = has('team2RightCourt') ? (body.team2RightCourt || 1) : (existing ? (existing.team2_right_court || 1) : 1);
        const betweenSets = has('betweenSets') ? (body.betweenSets || false) : (existing ? !!existing.between_sets : false);
        const setScoresHistoryJson = has('setScoresHistory')
            ? (body.setScoresHistory ? JSON.stringify(body.setScoresHistory) : '[]')
            : (existing && existing.set_scores_history
                ? (typeof existing.set_scores_history === 'string'
                    ? existing.set_scores_history
                    : JSON.stringify(existing.set_scores_history))
                : '[]');

        // Check if frontend explicitly provided matchStartTime
        const hasExplicitStartTime = has('matchStartTime') && !!body.matchStartTime;

        // Sentinel 'now': klienten beder serveren stemple starttiden med sit
        // eget ur (NOW()) — klient-ure kan være skæve, og skævheden ville ellers
        // lande direkte i den viste kamptid på TV/oversigt.
        const startTimeIsNow = hasExplicitStartTime && body.matchStartTime === 'now';

        // Convert ISO 8601 timestamp to MySQL datetime format
        let mysqlStartTime = null;
        if (hasExplicitStartTime && !startTimeIsNow) {
            // Convert '2026-01-21T10:34:08.440Z' to '2026-01-21 10:34:08'
            mysqlStartTime = new Date(body.matchStartTime).toISOString().slice(0, 19).replace('T', ' ');
        }

        // Check if frontend explicitly wants to clear matchEndTime (undo scenario)
        const shouldClearMatchEndTime = has('matchEndTime') && body.matchEndTime === null;

        // Aktivitet vurderes på den MERGEDE tilstand — en partiel opdatering
        // (fx navnerettelse) midt i en kamp må ikke ligne et reset
        const existingStartTime = existing ? existing.match_start_time : null;
        const hasActivity =
            (player1.score > 0) ||
            (player2.score > 0) ||
            (player1.games > 0) ||
            (player2.games > 0) ||
            (timerSeconds > 0) ||
            hasExplicitStartTime ||
            (!has('matchStartTime') && existingStartTime !== null);

        // Check if this is a reset (no activity at all)
        const isReset = !hasActivity;

        // Check if match is ending (someone won 2 games)
        const matchEnding = (player1.games >= 2 || player2.games >= 2);

        // Hvis match_start_time ændres fra null til værdi, invalidér QR-tokens for banen
        const matchIsStarting =
            (!existing || existing.match_start_time === null) &&
            (hasExplicitStartTime || player1.score > 0 || player2.score > 0);

        // Ryd snapshot når en ny kamp/tildeling påvirker banen:
        //  - der er reel aktivitet (point/games/start)
        //  - eller navne er ikke længere defaults (typisk fordi en holdkamp/
        //    turneringskamp er tildelt eller en bruger har indtastet spillere)
        const hasRealPlayerNames =
            (player1.name && player1.name !== 'Spiller 1') ||
            (player2.name && player2.name !== 'Spiller 2');
        if (hasActivity || hasRealPlayerNames) {
            await query('DELETE FROM last_finished_matches WHERE court_id = ?', [court.id]);
        }

        // ---- Skriv rækken ----
        // match_start_time/match_end_time har betinget logik — udtrykkene bygges
        // som SQL-fragmenter så NOW() evalueres i databasen præcis som før
        const columnValues = [
            player1.name, player1.name2, player1.score, player1.games,
            player2.name, player2.name2, player2.score, player2.games,
            timerSeconds, decidingGameSwitched,
            restBreakActive, restBreakSecondsLeft, restBreakTitle,
            setScoresHistoryJson, matchCompleted,
            servingPlayer, initialServer, servingTeam, servingPlayerOnTeam,
            team1RightCourt, team2RightCourt, betweenSets
        ];

        if (existing) {
            let startExpr;
            let startParams = [];
            if (isReset) {
                startExpr = 'NULL';
            } else if (startTimeIsNow) {
                // Bevar en allerede sat starttid — 'now' må ikke nulstille et
                // gentaget/forsinket start-kald midt i en kamp
                startExpr = 'COALESCE(match_start_time, NOW())';
            } else if (hasExplicitStartTime) {
                startExpr = '?';
                startParams = [mysqlStartTime];
            } else {
                startExpr = `COALESCE(match_start_time, ${hasActivity ? 'NOW()' : 'NULL'})`;
            }

            let endExpr;
            if (isReset || shouldClearMatchEndTime) {
                endExpr = 'NULL';
            } else if (matchEnding) {
                endExpr = 'NOW()';
            } else {
                endExpr = 'match_end_time';
            }

            // Compare-and-swap: med expectedVersion opdateres kun hvis versionen
            // stadig matcher — ellers har en anden enhed skrevet imellem, og vi
            // svarer 409 i stedet for at overskrive dens ændring
            const casClause = expectedVersion !== null ? ' AND version = ?' : '';
            const casParams = expectedVersion !== null ? [expectedVersion] : [];

            const result = await query(
                `UPDATE game_states SET
                    player1_name = ?, player1_name2 = ?, player1_score = ?, player1_games = ?,
                    player2_name = ?, player2_name2 = ?, player2_score = ?, player2_games = ?,
                    timer_seconds = ?, deciding_game_switched = ?,
                    rest_break_active = ?, rest_break_seconds_left = ?, rest_break_title = ?,
                    set_scores_history = ?, match_completed = ?,
                    serving_player = ?, initial_server = ?, serving_team = ?, serving_player_on_team = ?,
                    team1_right_court = ?, team2_right_court = ?, between_sets = ?,
                    match_start_time = ${startExpr},
                    match_end_time = ${endExpr},
                    version = version + 1
                 WHERE court_id = ?${casClause}`,
                [...columnValues, ...startParams, court.id, ...casParams]
            );

            if (result.affectedRows === 0) {
                const fresh = await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
                return conflictResponse(fresh);
            }
        } else {
            const startExprInsert = startTimeIsNow ? 'NOW()'
                : hasExplicitStartTime ? '?'
                : (hasActivity ? 'NOW()' : 'NULL');
            const startParamsInsert = (hasExplicitStartTime && !startTimeIsNow) ? [mysqlStartTime] : [];
            try {
                await query(
                    `INSERT INTO game_states (
                        court_id,
                        player1_name, player1_name2, player1_score, player1_games,
                        player2_name, player2_name2, player2_score, player2_games,
                        timer_seconds, deciding_game_switched,
                        rest_break_active, rest_break_seconds_left, rest_break_title,
                        set_scores_history, match_completed,
                        serving_player, initial_server, serving_team, serving_player_on_team,
                        team1_right_court, team2_right_court, between_sets,
                        match_start_time, match_end_time, version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${startExprInsert}, NULL, 1)`,
                    [court.id, ...columnValues, ...startParamsInsert]
                );
            } catch (error) {
                if (error && error.code === 'ER_DUP_ENTRY') {
                    // To klienter oprettede tilstanden samtidig — den anden vandt
                    const fresh = await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
                    return conflictResponse(fresh);
                }
                throw error;
            }
        }

        // Auto-update court active status based on activity (unless skipped by admin)
        // Only set to active if there IS activity, never set to inactive
        // This allows admin to manually mark courts as active without gameplay interference
        if (!skipAutoActive && hasActivity) {
            await query('UPDATE courts SET is_active = TRUE WHERE id = ?', [court.id]);
        }

        // Update court's isDoubles setting if provided
        if (body.isDoubles !== undefined && typeof body.isDoubles === 'boolean') {
            await query('UPDATE courts SET is_doubles = ? WHERE id = ?', [body.isDoubles, court.id]);
        }

        // Update court's gameMode (21/30 vs 15/21) if provided — synker court-sidens
        // toggle med DB saa periodic sync ikke ruller den tilbage.
        if (body.gameMode !== undefined && (body.gameMode === '15' || body.gameMode === '21')) {
            await query('UPDATE courts SET game_mode = ? WHERE id = ?', [body.gameMode, court.id]);
        }

        // NB: QR-token'et slettes IKKE ved kampstart mere. Det bevares under hele
        // kampen, så en gæst der lukker browseren kan scanne QR'en på TV'et igen
        // og genoptage kampen med stillingen intakt. Token'et ryddes først når
        // banen nulstilles (DELETE) eller tildeles en holdkamp/turnering.
        // matchIsStarting bruges ikke længere her, men beholdes hvis anden logik
        // senere skal reagere på kampstart.
        void matchIsStarting;

        const updatedRow = await queryOne('SELECT version FROM game_states WHERE court_id = ?', [court.id]);

        publishGameStateChange(req, courtId, 'update');

        res.json({ success: true, version: updatedRow ? updatedRow.version : 1 });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/game-states/:courtId - Reset court (public - used during gameplay)
router.delete('/:courtId', requireWriteAuthInClubMode, async (req, res, next) => {
    try {
        const { courtId } = req.params;

        // Get court by court_number
        const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtId]);

        if (!court) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        // Hvis en kamp er afsluttet (mindst én side vandt 2 sæt eller match_completed=true),
        // gem et snapshot så TV kan vise resultatet i et par minutter efter Ryd bane.
        const existing = await queryOne(
            `SELECT player1_name, player1_name2, player1_games,
                    player2_name, player2_name2, player2_games,
                    set_scores_history, match_end_time, match_completed
             FROM game_states WHERE court_id = ?`,
            [court.id]
        );

        if (existing) {
            const finished = !!existing.match_completed ||
                             existing.player1_games >= 2 ||
                             existing.player2_games >= 2;

            if (finished) {
                const courtRow = await queryOne(
                    'SELECT is_doubles FROM courts WHERE id = ?',
                    [court.id]
                );
                const setScoresJson = existing.set_scores_history
                    ? (typeof existing.set_scores_history === 'string'
                        ? existing.set_scores_history
                        : JSON.stringify(existing.set_scores_history))
                    : '[]';
                await query(
                    `INSERT INTO last_finished_matches
                        (court_id, player1_name, player1_name2, player2_name, player2_name2,
                         player1_games, player2_games, set_scores_history,
                         is_doubles, match_end_time, cleared_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                     ON DUPLICATE KEY UPDATE
                        player1_name = VALUES(player1_name),
                        player1_name2 = VALUES(player1_name2),
                        player2_name = VALUES(player2_name),
                        player2_name2 = VALUES(player2_name2),
                        player1_games = VALUES(player1_games),
                        player2_games = VALUES(player2_games),
                        set_scores_history = VALUES(set_scores_history),
                        is_doubles = VALUES(is_doubles),
                        match_end_time = VALUES(match_end_time),
                        cleared_at = NOW()`,
                    [
                        court.id,
                        existing.player1_name,
                        existing.player1_name2,
                        existing.player2_name,
                        existing.player2_name2,
                        existing.player1_games || 0,
                        existing.player2_games || 0,
                        setScoresJson,
                        courtRow ? !!courtRow.is_doubles : false,
                        existing.match_end_time
                    ]
                );
            }
        }

        // Delete game state
        await query('DELETE FROM game_states WHERE court_id = ?', [court.id]);

        // Set court to inactive and reset doubles mode
        await query('UPDATE courts SET is_active = FALSE, is_doubles = FALSE WHERE id = ?', [court.id]);

        // Frigiv aktive tildelinger fra holdkamp/turnering — ellers vil court-sidens
        // næste sync re-binde den samme tildeling og bringe navnene tilbage straks
        // efter at admin har trykket Nulstil bane. Kun status='active' rammes; en
        // 'finished' kamp må ikke nedgraderes til 'pending'.
        try {
            await query(
                `UPDATE team_match_games
                 SET status = 'pending', court_number = NULL
                 WHERE court_number = ? AND status = 'active'`,
                [parseInt(courtId, 10)]
            );
        } catch (e) { console.error('Failed to release team_match_games on court reset:', e); }
        try {
            await query(
                `UPDATE tournament_matches
                 SET status = 'pending', court_number = NULL
                 WHERE court_number = ? AND status = 'active'`,
                [parseInt(courtId, 10)]
            );
        } catch (e) { console.error('Failed to release tournament_matches on court reset:', e); }

        // Invalidér eventuelle aktive QR-tokens — næste TV-request genererer en ny
        try { await invalidateCourtTokens(parseInt(courtId, 10)); } catch (e) { console.error('Token invalidation failed:', e); }

        publishGameStateChange(req, courtId, 'reset');

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
