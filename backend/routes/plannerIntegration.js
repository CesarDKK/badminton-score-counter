/**
 * API for badmintonplanner.dk.
 *
 * badmintonplanner.dk sender én "runde" pr. rundestart på en træningsaften:
 * spillernavne pr. bane. Navnene skrives ind på banerne (game_states), så TV
 * og oversigt viser dem præcis som når admin tildeler en kamp — og tælles der
 * på en bane, kører tælleren som i dag. Baner i tokenets baneliste som IKKE er
 * med i runden ryddes, så gamle navne ikke bliver hængende.
 *
 * Adgang: Bearer <API-nøgle> (oprettes under fanen Badmintonplanner). Klubben
 * afgøres af Host-headeren (tenant-middleware), og nøglen slås op i klubbens
 * egen database — en nøgle kan derfor aldrig ramme en anden klub. Uden for
 * klubbens ugentlige tidsvinduer svares 403 uanset indhold.
 *
 * Alle kald logges i planner_log (fanen har en "Vis log"-knap til fejlsøgning).
 *
 * Routes:
 *   POST /api/integrations/planned-round
 *   GET  /api/integrations/status
 */
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { currentTenant } = require('../config/tenantPools');
const { invalidateCourtTokens } = require('./matchSessionTokens');
const { publishGameStateChange } = require('../events/gameStateEvents');
const { plannerTokenLimiter, plannerIpLimiter, klientIp } = require('../middleware/rateLimiter');
const { varighedTekst } = require('../config/matchTiming');
const tid = require('../config/plannerTid');

const ENDPOINT_STI = '/api/integrations/planned-round';
const LOG_MAKS = 200;

// ---------- Hjælpere ----------

async function hentConfig() {
    const row = await queryOne(`SELECT setting_value FROM settings WHERE setting_key = 'planner_config'`);
    if (!row || !row.setting_value) return tid.tomConfig();
    try {
        const n = tid.normaliserConfig(JSON.parse(row.setting_value));
        return n.value || tid.tomConfig();
    } catch {
        return tid.tomConfig();
    }
}

async function gemConfig(config) {
    const json = JSON.stringify(config);
    await query(
        `INSERT INTO settings (setting_key, setting_value) VALUES ('planner_config', ?)
         ON DUPLICATE KEY UPDATE setting_value = ?`,
        [json, json]
    );
}

// Event-hub'en er keyet på tenant; uden et rigtigt req (scheduler) laver vi et
// req-lignende objekt ud fra den aktuelle tenant-kontekst.
function eventReq() {
    const t = currentTenant();
    return { clubDbName: t === 'direct' ? null : t };
}

async function gemLog({ req, tokenName, endpoint, status, roundId, label, matchCount, result, error }) {
    try {
        await query(
            `INSERT INTO planner_log (token_name, ip, endpoint, http_status, round_id, label, match_count, result_json, error_text)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tokenName || null,
                req ? klientIp(req).slice(0, 64) : null,
                endpoint,
                status,
                roundId || null,
                label || null,
                matchCount === undefined ? null : matchCount,
                result ? JSON.stringify(result) : null,
                error ? String(error).slice(0, 255) : null
            ]
        );
        await query(
            `DELETE FROM planner_log WHERE id NOT IN (
                SELECT id FROM (SELECT id FROM planner_log ORDER BY id DESC LIMIT ${LOG_MAKS}) x)`
        );
    } catch (e) {
        console.error('planner_log fejlede:', e.message);
    }
}

function parseSetScores(raw) {
    if (!raw) return [];
    if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return []; } }
    return Array.isArray(raw) ? raw : [];
}

function erDefaultMakker(n) {
    return !n || /^Makker [12]$/.test(n);
}

// Tælles der på banen lige nu? Navne alene tæller IKKE — kun point/sæt.
function kampIGang(gs) {
    return !!gs && !gs.match_completed &&
        (gs.player1_score > 0 || gs.player2_score > 0 || gs.player1_games > 0 || gs.player2_games > 0);
}

/** Det der stod på banen før skiftet — sendes tilbage som `previous`. */
function tidligereTilstand(gs, court) {
    if (!gs) return null;
    const navn = (a, b) => (court.is_doubles && !erDefaultMakker(b)) ? `${a} / ${b}` : a;
    const saet = parseSetScores(gs.set_scores_history).map(s => (typeof s === 'string' ? s : s.score)).filter(Boolean);
    if (!gs.match_completed && (gs.player1_score > 0 || gs.player2_score > 0)) {
        saet.push(`${gs.player1_score}-${gs.player2_score}`);
    }
    return {
        side1: navn(gs.player1_name, gs.player1_name2),
        side2: navn(gs.player2_name, gs.player2_name2),
        sets: `${gs.player1_games || 0}-${gs.player2_games || 0}`,
        score: saet.join(', '),
        completed: !!gs.match_completed,
        counted: kampIGang(gs) || !!gs.match_completed
    };
}

/**
 * En talt kamp med mindst ét færdigt sæt, som overskrives eller ryddes,
 * gemmes i Kamphistorik så resultatet ikke går tabt. Færdigspillede kampe har
 * bane-siden allerede gemt selv — dem rører vi ikke.
 */
async function gemAfbrudtIKamphistorik(courtPk, gs, court) {
    if (!kampIGang(gs) || (gs.player1_games === 0 && gs.player2_games === 0)) return false;
    const navn = (a, b) => (court.is_doubles && !erDefaultMakker(b)) ? `${a} / ${b}` : a;
    const s1 = navn(gs.player1_name, gs.player1_name2);
    const s2 = navn(gs.player2_name, gs.player2_name2);
    const forende1 = gs.player1_games >= gs.player2_games;
    const saetTekst = parseSetScores(gs.set_scores_history).map(s => {
        if (typeof s === 'string') return s;
        return `${s.player1Name}${s.player1Name2 && !erDefaultMakker(s.player1Name2) ? ' / ' + s.player1Name2 : ''} ${s.score} ${s.player2Name}${s.player2Name2 && !erDefaultMakker(s.player2Name2) ? ' / ' + s.player2Name2 : ''}`;
    }).join(', ');
    await query(
        `INSERT INTO match_history (court_id, winner_name, loser_name, games_won, duration, set_scores)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            courtPk,
            forende1 ? s1 : s2,
            forende1 ? s2 : s1,
            forende1 ? `${gs.player1_games}-${gs.player2_games}` : `${gs.player2_games}-${gs.player1_games}`,
            varighedTekst(gs.match_start_time, new Date()) || '00:00',
            saetTekst || null
        ]
    );
    return true;
}

// Frigiv holdkamp-/turneringstildelinger på banen (som "Ryd bane" gør) —
// ellers re-binder bane-siden dem og navnene kommer tilbage.
async function frigivTildelinger(courtNumber) {
    await query(`UPDATE team_match_games SET status = 'pending', court_number = NULL, started_at = NULL
                 WHERE court_number = ? AND status = 'active'`, [courtNumber]);
    await query(`UPDATE tournament_matches SET status = 'pending', court_number = NULL, started_at = NULL
                 WHERE court_number = ? AND status = 'active'`, [courtNumber]);
}

/** Skriv rundens navne på banen — frisk game_state, banen aktiv, ingen snapshot. */
async function visNavne(court, m) {
    const erDouble = !!(m.side1[1] || m.side2[1]);
    await query('DELETE FROM game_states WHERE court_id = ?', [court.id]);
    await query(
        `INSERT INTO game_states (court_id, player1_name, player1_name2, player2_name, player2_name2)
         VALUES (?, ?, ?, ?, ?)`,
        [court.id, m.side1[0], m.side1[1] || 'Makker 1', m.side2[0], m.side2[1] || 'Makker 2']
    );
    await query('UPDATE courts SET is_active = TRUE, is_doubles = ? WHERE id = ?', [erDouble, court.id]);
    await query('DELETE FROM last_finished_matches WHERE court_id = ?', [court.id]);
    await frigivTildelinger(court.court_number);
    try { await invalidateCourtTokens(court.court_number); } catch (e) { console.error('QR-token oprydning fejlede:', e.message); }
    publishGameStateChange(eventReq(), court.court_number, 'update');
}

/** Ryd banen helt (tilbage til sponsor-slideshow). */
async function rydBane(court) {
    await query('DELETE FROM game_states WHERE court_id = ?', [court.id]);
    await query('UPDATE courts SET is_active = FALSE, is_doubles = FALSE WHERE id = ?', [court.id]);
    await query('DELETE FROM last_finished_matches WHERE court_id = ?', [court.id]);
    await frigivTildelinger(court.court_number);
    try { await invalidateCourtTokens(court.court_number); } catch (e) { console.error('QR-token oprydning fejlede:', e.message); }
    publishGameStateChange(eventReq(), court.court_number, 'reset');
}

/**
 * Anvender en valideret runde på de tilladte baner.
 * Returnerer results-listen (status pr. bane).
 */
async function anvendRunde(runde, tilladteBaner) {
    const results = [];
    const pr = new Map(runde.matches.map(m => [m.courtNumber, m]));
    const tilladt = new Set(tilladteBaner);

    // Baner i runden som klubben ikke har åbnet for i dag
    for (const m of runde.matches) {
        if (!tilladt.has(m.courtNumber)) {
            results.push({ courtNumber: m.courtNumber, status: 'rejected', reason: 'court_not_allowed', previous: null });
        }
    }

    for (const courtNumber of [...tilladt].sort((a, b) => a - b)) {
        const m = pr.get(courtNumber) || null;
        const court = await queryOne('SELECT id, court_number, is_active, is_doubles FROM courts WHERE court_number = ?', [courtNumber]);
        if (!court) {
            if (m) results.push({ courtNumber, status: 'rejected', reason: 'court_not_found', previous: null });
            continue;
        }
        const gs = await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
        const previous = tidligereTilstand(gs, court);

        if (kampIGang(gs) && !runde.forceNewMatch) {
            results.push({ courtNumber, status: 'rejected', reason: 'match_in_progress', previous });
            continue;
        }
        if (gs) await gemAfbrudtIKamphistorik(court.id, gs, court);

        if (m) {
            await visNavne(court, m);
            results.push({ courtNumber, status: 'shown', previous });
        } else {
            if (gs || court.is_active) await rydBane(court);
            results.push({ courtNumber, status: 'cleared', previous });
        }
    }
    return results;
}

/** Gem runden som "aktuel runde" (kun én ad gangen) med bane-tildelinger. */
async function gemRunde(runde, tokenId, results) {
    await query('DELETE FROM planner_rounds');
    const naeste = runde.nextRoundStartsAt ? tid.klokkeslaetIDagTilUtc(runde.nextRoundStartsAt) : null;
    const r = await query(
        `INSERT INTO planner_rounds (round_id, sequence, label, note, next_round_at, token_id, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [runde.roundId, runde.sequence, runde.label || null, runde.note || null,
         naeste ? naeste.toISOString().slice(0, 19).replace('T', ' ') : null,
         tokenId, JSON.stringify(results)]
    );
    const vist = new Set(results.filter(x => x.status === 'shown').map(x => x.courtNumber));
    for (const m of runde.matches) {
        if (!vist.has(m.courtNumber)) continue;
        await query(
            `INSERT INTO planner_court_assignments
                (court_number, round_id, side1_player1, side1_player2, side2_player1, side2_player2, substitutes, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.courtNumber, r.insertId, m.side1[0], m.side1[1], m.side2[0], m.side2[1],
             m.substitutes.length ? JSON.stringify(m.substitutes) : null, m.note || null]
        );
    }
    return r.insertId;
}

/**
 * Kaldes hvert minut af scheduler'en. Er der en runde på skærmene, men
 * vinduet er lukket (eller integrationen slået fra), ryddes planner-banerne
 * så klubben er tilbage i normal drift. En bane hvor der tælles, får lov at
 * spille færdig — den rydder inaktivitets- og midnats-oprydningen som i dag.
 */
async function plannerVindueLuk() {
    const runde = await queryOne('SELECT id FROM planner_rounds ORDER BY id DESC LIMIT 1');
    if (!runde) return;
    const config = await hentConfig();
    if (tid.aabneBaner(config).aaben) return;

    const baner = await query('SELECT court_number FROM planner_court_assignments');
    const ryddet = [];
    for (const { court_number } of baner) {
        const court = await queryOne('SELECT id, court_number, is_active, is_doubles FROM courts WHERE court_number = ?', [court_number]);
        if (!court) continue;
        const gs = await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
        if (kampIGang(gs)) continue;
        if (gs || court.is_active) await rydBane(court);
        ryddet.push(court_number);
    }
    await query('DELETE FROM planner_rounds');
    await gemLog({
        endpoint: 'auto-clear', status: 200, matchCount: ryddet.length,
        result: { cleared: ryddet }, error: config.enabled ? 'Tidsvindue lukket — baner ryddet' : 'Integration slået fra — baner ryddet'
    });
}

// ---------- Middleware ----------

async function plannerAuth(req, res, next) {
    try {
        const h = req.headers.authorization || '';
        const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
        const row = /^[a-f0-9]{64}$/.test(token)
            ? await queryOne('SELECT id, name FROM planner_tokens WHERE token = ? AND is_active = 1', [token])
            : null;
        if (!row) {
            await gemLog({ req, endpoint: req.path, status: 401, error: 'Ugyldig eller tilbagekaldt API-nøgle' });
            return res.status(401).json({ error: 'Ugyldig eller manglende API-nøgle', code: 'invalid_token' });
        }
        req.plannerToken = row;
        query('UPDATE planner_tokens SET last_used_at = NOW() WHERE id = ?', [row.id]).catch(() => {});
        next();
    } catch (e) {
        next(e);
    }
}

function statusFor(config, nu = new Date()) {
    const aaben = tid.aabneBaner(config, nu);
    const naeste = tid.naesteVindue(config, nu);
    return {
        integrationEnabled: !!config.enabled,
        openNow: aaben.aaben,
        courtsNow: aaben.baner,
        window: aaben.vindue,
        nextWindow: naeste,
        serverTime: nu.toISOString()
    };
}

// ---------- Routes ----------

// GET /api/integrations/status — lader badmintonplanner tjekke nøgle og vindue
router.get('/status', plannerIpLimiter, plannerAuth, plannerTokenLimiter, async (req, res, next) => {
    try {
        const config = await hentConfig();
        const runde = await queryOne('SELECT round_id, label, received_at FROM planner_rounds ORDER BY id DESC LIMIT 1');
        res.json({
            ...statusFor(config),
            tokenName: req.plannerToken.name,
            currentRound: runde ? { roundId: runde.round_id, label: runde.label, receivedAt: runde.received_at } : null
        });
    } catch (e) {
        next(e);
    }
});

// POST /api/integrations/planned-round — én runde
router.post('/planned-round', plannerIpLimiter, plannerAuth, plannerTokenLimiter, async (req, res, next) => {
    const tokenName = req.plannerToken.name;
    const log = (status, ekstra) => gemLog({ req, tokenName, endpoint: 'planned-round', status, ...ekstra });
    try {
        const v = tid.validerRunde(req.body);
        if (v.error) {
            await log(422, { error: v.details.join('; ') });
            return res.status(422).json({ error: v.error, code: 'invalid_payload', details: v.details });
        }
        const runde = v.runde;
        const logFelter = { roundId: runde.roundId, label: runde.label, matchCount: runde.matches.length };

        const config = await hentConfig();
        const status = statusFor(config);
        if (!config.enabled) {
            await log(403, { ...logFelter, error: 'Integrationen er slået fra' });
            return res.status(403).json({ error: 'Integrationen er slået fra i klubbens opsætning', code: 'integration_disabled', ...status });
        }
        if (!status.openNow) {
            await log(403, { ...logFelter, error: 'Uden for tidsvindue' });
            return res.status(403).json({ error: 'Uden for klubbens tidsvindue', code: 'outside_window', ...status });
        }

        // Idempotens: samme roundId som sidst → samme svar, banerne røres ikke.
        const sidste = await queryOne('SELECT round_id, sequence, result_json FROM planner_rounds ORDER BY id DESC LIMIT 1');
        if (sidste && runde.roundId && sidste.round_id === runde.roundId) {
            let results = [];
            try { results = JSON.parse(sidste.result_json) || []; } catch { /* tomt */ }
            await log(200, { ...logFelter, error: 'Gentaget kald (samme roundId) — ikke anvendt igen' });
            return res.json({ results, roundId: runde.roundId, replayed: true });
        }
        if (sidste && runde.sequence !== null && sidste.sequence !== null && runde.sequence < sidste.sequence) {
            await log(409, { ...logFelter, error: `Ældre runde (sequence ${runde.sequence} < ${sidste.sequence})` });
            return res.status(409).json({ error: 'En nyere runde er allerede modtaget', code: 'round_superseded' });
        }

        const results = await anvendRunde(runde, status.courtsNow);
        await gemRunde(runde, req.plannerToken.id, results);
        await log(200, { ...logFelter, result: results });
        res.json({ results, roundId: runde.roundId, receivedAt: new Date().toISOString() });
    } catch (e) {
        await log(500, { error: e.message });
        next(e);
    }
});

module.exports = router;
module.exports.hentConfig = hentConfig;
module.exports.gemConfig = gemConfig;
module.exports.statusFor = statusFor;
module.exports.plannerVindueLuk = plannerVindueLuk;
module.exports.anvendRunde = anvendRunde;
module.exports.tidligereTilstand = tidligereTilstand;
module.exports.kampIGang = kampIGang;
module.exports.ENDPOINT_STI = ENDPOINT_STI;
