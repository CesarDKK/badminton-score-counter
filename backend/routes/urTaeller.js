const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../config/database');
const { requireWriteAuthInClubMode } = require('../middleware/auth');
const { baneFraDestination } = require('../middleware/qrSession');
const { urKodeLimiter } = require('../middleware/rateLimiter');
const { gemTilstand, formatStateRow } = require('./gameStates');
const { urKodeFor } = require('./matchSessionTokens');
const { varighedTekst } = require('../config/matchTiming');
const regler = require('../taeller/regler');
const ejerskab = require('../taeller/ejerskab');

// ---- Tæl fra uret ----
//
// Uret (frontend/ur.html) kan ikke selv reglerne: det sender tryk ("point til
// side 1", "fortryd" …), og serveren regner med de samme regler som tabletten
// (taeller/regler.js) og gemmer med den samme funktion (gemTilstand) — så TV,
// Oversigt og tablet ser kampen præcis, som havde tabletten talt den.
//
// Adgang: uret taster banens ur-kode fra TV'et (eller får den i linket fra
// telefonens QR-side) og får banens QR-session (POST /kobl) — samme rettigheder
// som QR-koden: kun banen, kun almindelig tælling, og kun mens sessionen findes.
// Slås til pr. klub i Indstillinger (settings 'ur_taelling').
//
// Hvert tryk har et løbenummer fra uret. Er svaret gået tabt, sender uret
// trykket igen; serveren kender nummeret og tæller det ikke to gange.

const HANDLINGER = ['S1', 'S2', 'P1', 'P2', 'K', 'B', 'U'];

async function urTaellingSlaaetTil() {
    const r = await queryOne("SELECT setting_value FROM settings WHERE setting_key = 'ur_taelling'");
    return !!(r && r.setting_value === 'true');
}

// Banen, kaldet gælder: QR-sessionens bane (club), ellers body/query (lokal installation)
function baneFor(req) {
    if (req.user && req.user.role === 'device') return baneFraDestination(req.user.destination);
    const n = parseInt((req.body && req.body.bane) || req.query.bane, 10);
    return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}

// POST /api/ur/kobl — ur-koden fra TV'et giver banens QR-session
router.post('/kobl', urKodeLimiter, async (req, res, next) => {
    try {
        if (req.accessMode !== 'club' || !await urTaellingSlaaetTil()) {
            return res.status(404).json({ error: 'Tælling fra ur er ikke slået til' });
        }
        const kode = String((req.body && req.body.kode) || '').replace(/\D/g, '');
        if (kode.length !== 6) return res.status(400).json({ error: 'Koden har 6 cifre' });
        const s = await queryOne(
            `SELECT id, destination, locked, court_number FROM device_tokens
              WHERE token_type = 'match_session' AND is_active = 1 AND ur_kode = ?
              ORDER BY id DESC LIMIT 1`, [kode]);
        if (!s) return res.status(404).json({ error: 'Koden findes ikke — tjek koden på TV\'et' });
        await query('UPDATE device_tokens SET last_used_at = NOW() WHERE id = ?', [s.id]);
        // Samme session som QR-koden giver (routes/deviceTokens.js /validate)
        const token = jwt.sign({
            role: 'device', tokenId: s.id, destination: s.destination, locked: s.locked,
            tokenType: 'match_session', clubSubdomain: req.clubSubdomain
        }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({ token, bane: s.court_number });
    } catch (error) {
        next(error);
    }
});

// GET /api/ur/kode — banens ur-kode til QR-telefonen ("Tæl fra mit Apple Watch")
router.get('/kode', requireWriteAuthInClubMode, async (req, res, next) => {
    try {
        const u = req.user;
        if (req.accessMode !== 'club' || !u || u.tokenType !== 'match_session' || !await urTaellingSlaaetTil()) {
            return res.status(404).json({ error: 'Tælling fra ur er ikke slået til' });
        }
        const row = await queryOne("SELECT token FROM device_tokens WHERE id = ? AND token_type = 'match_session' AND is_active = 1", [u.tokenId]);
        const kode = row && await urKodeFor(row.token);
        if (!kode) return res.status(404).json({ error: 'Ingen kode til banen' });
        res.json({ kode, bane: baneFraDestination(u.destination) });
    } catch (error) {
        next(error);
    }
});

// Reglernes tilstand for banen: den gemte række, ellers en ny kamp med banens
// opsætning. Fortryd-historikken gælder kun, hvis ingen anden enhed har gemt
// siden urets seneste tryk (versionen er den samme)
function tilstandFra(row, court) {
    if (!row) {
        return regler.nyKamp({ isDoubles: !!court.is_doubles, gameMode: court.game_mode || '15' });
    }
    const f = formatStateRow(row, court);
    const st = regler.nyKamp({ isDoubles: f.isDoubles, gameMode: f.gameMode });
    for (const k of Object.keys(st)) {
        if (k !== 'history' && f[k] !== undefined) st[k] = f[k];
    }
    st.player1 = { ...f.player1 };
    st.player2 = { ...f.player2 };
    st.setScoresHistory = Array.isArray(f.setScoresHistory) ? f.setScoresHistory : [];
    try {
        const h = row.fortryd_historik ? JSON.parse(row.fortryd_historik) : null;
        if (h && h.version === row.version && Array.isArray(h.historik)) st.history = h.historik;
    } catch { /* ødelagt historik: intet at fortryde */ }
    return st;
}

// Kroppen til gemTilstand, som tabletten ville have sendt den
function kropFra(st, haendelser, version, taellerId) {
    const krop = {
        player1: st.player1, player2: st.player2,
        isActive: st.isActive, isDoubles: st.isDoubles, gameMode: st.gameMode,
        servingPlayer: st.servingPlayer, initialServer: st.initialServer,
        servingTeam: st.servingTeam, servingPlayerOnTeam: st.servingPlayerOnTeam,
        team1RightCourt: st.team1RightCourt, team2RightCourt: st.team2RightCourt,
        betweenSets: st.betweenSets, decidingGameSwitched: st.decidingGameSwitched,
        sidesManuallySwitched: st.sidesManuallySwitched,
        setScoresHistory: st.setScoresHistory,
        restBreakActive: st.restBreakActive, restBreakTaken: st.restBreakTaken,
        restBreakSecondsLeft: st.restBreakActive ? st.restBreakSecondsLeft : 0,
        restBreakTitle: st.restBreakTitle, restBreakStartedAt: st.restBreakStartedAt,
        restBreakDuration: st.restBreakDuration,
        matchCompleted: st.matchCompleted,
        expectedVersion: version,
        taellerId, taellerNavn: 'Ur'
    };
    // Starttiden stemples med serverens ur; sluttiden sættes ved kampslut og
    // ryddes, når matchbolden fortrydes
    if (haendelser.includes('start')) krop.matchStartTime = 'now';
    if (!st.matchCompleted) krop.matchEndTime = null;
    // Kun servervalget fortrudt: kampen er ikke begyndt
    if (haendelser.includes('server-fortrudt')) krop.matchStartTime = null;
    return krop;
}

// Det, uret viser
function visning(row, court, extra = {}) {
    const f = row ? formatStateRow(row, court) : null;
    const st = f || regler.nyKamp({ isDoubles: !!court.is_doubles, gameMode: court.game_mode || '15' });
    const navn = (p) => (st.isDoubles && p.name2 && !/^Makker [12]$/.test(p.name2) ? `${p.name} & ${p.name2}` : p.name);
    const slutter = st.restBreakActive && st.restBreakStartedAt
        ? Number(st.restBreakStartedAt) + (st.restBreakDuration || 60) * 1000 : null;
    return {
        bane: court.court_number,
        sider: [1, 2].map(i => {
            const p = st[`player${i}`];
            return { navn: navn(p), point: p.score || 0, saet: p.games || 0 };
        }),
        server: st.isDoubles ? st.servingTeam || null : st.servingPlayer || null,
        startet: !!st.matchStartTime,
        pause: st.restBreakActive ? { titel: st.restBreakTitle, slutter, saet: regler.erSaetAfgjort(st) } : null,
        slut: !!st.matchCompleted,
        saethistorik: (st.setScoresHistory || []).map(s => s.score),
        nr: row && row.tryk_nr != null ? row.tryk_nr : 0,
        taeller: row ? row.tryk_taeller || null : null,
        version: row ? row.version || 0 : 0,
        nu: Date.now(),
        // Reglernes tilstand (uden fortryd-historikken): uret regner selv med
        // reglerne og viser et tryk med det samme, før svaret kommer
        tilstand: tilstandUdenHistorik(row, court),
        ...extra
    };
}

function tilstandUdenHistorik(row, court) {
    const st = tilstandFra(row, court);
    delete st.history;
    return st;
}

const hentBane = (bane) => queryOne('SELECT id, court_number, is_active, is_doubles, game_mode FROM courts WHERE court_number = ?', [bane]);
const hentRaekke = (courtPk) => queryOne('SELECT * FROM game_states WHERE court_id = ?', [courtPk]);

// GET /api/ur/bane — stillingen på urets bane
router.get('/bane', requireWriteAuthInClubMode, async (req, res, next) => {
    try {
        const bane = baneFor(req);
        const court = bane && await hentBane(bane);
        if (!court) return res.status(404).json({ error: 'Bane ikke fundet' });
        const row = await hentRaekke(court.id);
        const taellerId = ejerskab.rensId(req.query.taellerId);
        res.json(visning(row, court, { spaerret: !!(taellerId && row && !ejerskab.maaGemme(row, taellerId, Date.now())) }));
    } catch (error) {
        next(error);
    }
});

// Kampen er vundet på uret: i kamphistorikken, som tabletten gemmer den
async function gemKampresultat(court, st) {
    const vinder = st.player1.games > st.player2.games ? st.player1 : st.player2;
    const taber = vinder === st.player1 ? st.player2 : st.player1;
    const navn = (p) => (st.isDoubles && p.name2 && !/^Makker [12]$/.test(p.name2) ? `${p.name} & ${p.name2}` : p.name);
    const saet = st.setScoresHistory.map(s => `${navn({ name: s.player1Name, name2: s.player1Name2 })} ${s.score} ${navn({ name: s.player2Name, name2: s.player2Name2 })}`).join(', ');
    const row = await hentRaekke(court.id);
    const r = await query(
        `INSERT INTO match_history (court_id, winner_name, loser_name, games_won, duration, set_scores)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [court.id, navn(vinder), navn(taber), `${vinder.games}-${taber.games}`,
            varighedTekst(row && row.match_start_time, row && row.match_end_time) || '00:00', saet || null]);
    await query('UPDATE game_states SET result_history_id = ? WHERE court_id = ?', [r.insertId, court.id]);
}

// POST /api/ur/tryk — { handling, nr, taellerId }
//   handling: S1/S2 vælg server, P1/P2 point, K start, B afslut pausen, U fortryd
router.post('/tryk', requireWriteAuthInClubMode, async (req, res, next) => {
    try {
        const body = req.body || {};
        const handling = String(body.handling || '');
        const nr = Number(body.nr);
        const taellerId = ejerskab.rensId(body.taellerId);
        if (!HANDLINGER.includes(handling) || !Number.isInteger(nr) || nr < 1 || !taellerId) {
            return res.status(400).json({ error: 'Ugyldigt tryk' });
        }
        if (req.accessMode === 'club' && !await urTaellingSlaaetTil()) {
            return res.status(404).json({ error: 'Tælling fra ur er ikke slået til' });
        }
        const bane = baneFor(req);
        const court = bane && await hentBane(bane);
        if (!court) return res.status(404).json({ error: 'Bane ikke fundet' });

        // Skriver en tablet imellem (409), regnes trykket igen på dens tilstand
        for (let forsoeg = 0; forsoeg < 3; forsoeg++) {
            const row = await hentRaekke(court.id);
            // Samme tryk igen (svaret gik tabt): tæl det ikke to gange
            if (row && row.tryk_taeller === taellerId && row.tryk_nr != null) {
                if (nr <= row.tryk_nr) return res.json(visning(row, court, { dublet: true }));
                if (nr > row.tryk_nr + 1) return res.status(409).json(visning(row, court, { hul: true }));
            }

            const nu = Date.now();
            // Kun én tæller ad gangen — også for tryk, reglerne afviser
            if (row && !ejerskab.maaGemme(row, taellerId, nu)) {
                return res.status(423).json({
                    error: 'En anden enhed tæller denne kamp', taellerSpaerret: true,
                    ...ejerskab.status(row, taellerId, nu), version: row.version || 0
                });
            }

            const st = tilstandFra(row, court);
            const haendelser = [];
            // Er pausen ved 11 (8) løbet ud, slutter den, før trykket regnes. Sætpausen
            // slutter kun med "B" (uret sender det, når nedtællingen er slut): næste
            // sæt bytter siderne, så et point regnet efter et skjult sideskift ville
            // ramme den forkerte spiller — reglerne afviser point i sætpausen
            if (st.restBreakActive && !regler.erSaetAfgjort(st) && st.restBreakStartedAt &&
                nu >= Number(st.restBreakStartedAt) + (st.restBreakDuration || 60) * 1000 && handling !== 'U') {
                haendelser.push(...regler.afslutPause(st).haendelser);
            }
            const n = Number(handling[1]);
            const r = handling[0] === 'S' ? regler.vaelgServer(st, n)
                : handling[0] === 'P' ? regler.point(st, n, nu)
                : handling === 'K' ? regler.startKamp(st, nu)
                : handling === 'B' ? regler.afslutPause(st)
                : regler.fortryd(st);
            haendelser.push(...r.haendelser);

            if (!r.ok && !haendelser.length) {
                // Afvist (fx point i sætpausen): intet at gemme, men nummeret huskes
                if (row) await query('UPDATE game_states SET tryk_taeller = ?, tryk_nr = ? WHERE court_id = ?', [taellerId, nr, court.id]);
                return res.json(visning(row && { ...row, tryk_taeller: taellerId, tryk_nr: nr }, court, { afvist: true, haendelser }));
            }

            const g = await gemTilstand(req, court.court_number, kropFra(st, haendelser, row ? row.version || 0 : 0, taellerId));
            if (g.status === 409) continue;   // en anden enhed skrev imellem — regn igen
            if (g.status !== 200) return res.status(g.status).json(g.json);

            await query('UPDATE game_states SET tryk_taeller = ?, tryk_nr = ?, fortryd_historik = ? WHERE court_id = ?',
                [taellerId, nr, JSON.stringify({ version: g.json.version, historik: st.history }), court.id]);
            if (haendelser.includes('kamp')) {
                try { await gemKampresultat(court, st); } catch (e) { console.error('[ur] kamphistorik:', e.message); }
            }
            return res.json(visning(await hentRaekke(court.id), court, { haendelser }));
        }
        res.status(409).json({ error: 'Banen blev ændret samtidig — prøv igen' });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
module.exports.urTaellingSlaaetTil = urTaellingSlaaetTil;
