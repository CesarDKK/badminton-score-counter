'use strict';
/**
 * Livescore til badmintonplayer.dk — opsætning i admin og afsendelsen.
 *
 *   GET /api/bp-livescore/:teamMatchId   status for holdkampen (admin)
 *   PUT /api/bp-livescore/:teamMatchId   { til: true, kode } slår til, { til: false } fra
 *
 * Når den er slået til, sendes stillingen på en bane med en koblet delkamp til
 * badmintonplayer.dk hver gang banen ændrer sig (onAnyGameStateChange) — samlet
 * over et øjeblik, så en byge af gemninger bliver til én besked. Se
 * config/bpLivescore.js for, hvordan badmintonplayers egen tæller gør.
 *
 * Koden vises aldrig igen efter, den er gemt (de offentlige holdkamp-svar
 * sender den heller ikke) — admin ser kun, at den er sat.
 */
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { requirePage } = require('../middleware/pagePermission');
const { query, queryOne } = require('../config/database');
const { runWithTenant } = require('../config/tenantPools');
const { onAnyGameStateChange } = require('../events/gameStateEvents');
const bpl = require('../config/bpLivescore');

const hub = new bpl.Hub();
const SAMLE_MS = 400;

// ── Status og opsætning (admin) ─────────────────────────────────────────────

function statusSvar(tm, games) {
    const koblede = games.filter(g => g.bp_kamp_id != null).length;
    return {
        kanBruges: !!tm.aktiv_kilde_id,
        kampnr: tm.aktiv_kilde_id || null,
        til: !!Number(tm.bp_livescore),
        kodeSat: !!tm.bp_livescore_kode,
        koblede,
        delkampe: games.length,
        ukoblede: games.filter(g => g.bp_kamp_id == null).map(g => ({ id: g.id, kategori: g.category, nr: g.game_number })),
        status: tm.bp_livescore_status || null,
        sidstSendt: tm.bp_livescore_sendt || null,
    };
}

async function hentTm(id) {
    const tm = await queryOne(
        `SELECT id, status, aktiv_kilde_id, bp_livescore, bp_livescore_kode, bp_livescore_status, bp_livescore_sendt
           FROM team_matches WHERE id = ?`, [id]);
    if (!tm) return null;
    const games = await query(
        `SELECT id, game_number, category, team1_player1, team1_player2, team2_player1, team2_player2,
                court_number, status, bp_kamp_id
           FROM team_match_games WHERE team_match_id = ? ORDER BY game_number`, [id]);
    return { tm, games };
}

router.get('/:id', authMiddleware, requirePage('holdkamp'), async (req, res, next) => {
    try {
        const r = await hentTm(Number(req.params.id));
        if (!r) return res.status(404).json({ error: 'Holdkampen findes ikke' });
        res.json(statusSvar(r.tm, r.games));
    } catch (e) { next(e); }
});

router.put('/:id', authMiddleware, requirePage('holdkamp'), async (req, res, next) => {
    try {
        const id = Number(req.params.id);
        const r = await hentTm(id);
        if (!r) return res.status(404).json({ error: 'Holdkampen findes ikke' });
        const { tm, games } = r;
        const body = req.body || {};

        if (!body.til) {
            await query('UPDATE team_matches SET bp_livescore = 0, bp_livescore_status = NULL WHERE id = ?', [id]);
            const n = await hentTm(id);
            return res.json(statusSvar(n.tm, n.games));
        }

        if (tm.status !== 'active') return res.status(409).json({ error: 'Holdkampen er afsluttet' });
        if (!tm.aktiv_kilde_id) {
            return res.status(409).json({ error: 'Kun holdkampe hentet fra badmintonplayer.dk kan sende livescore' });
        }
        const kode = typeof body.kode === 'string' ? body.kode.trim().slice(0, 64) : '';

        let model;
        try {
            model = await bpl.hentHoldkamp(tm.aktiv_kilde_id);
        } catch (e) {
            const tekst = e.name === 'TimeoutError' ? 'badmintonplayer.dk svarer ikke' : e.message;
            return res.status(502).json({ error: `Kunne ikke hente holdkampen fra badmintonplayer.dk: ${tekst}` });
        }
        const tjek = bpl.kodeTjek(model, kode);
        if (!tjek.ok) return res.status(422).json({ error: tjek.grund });

        const { koblinger } = bpl.kobDelkampe(games, model);
        for (const g of games) {
            const k = koblinger.get(g.id);
            await query('UPDATE team_match_games SET bp_kamp_id = ?, bp_spillere = ? WHERE id = ?',
                [k ? k.bpKampId : null,
                 k ? JSON.stringify({ hjemme: k.hjemme, ude: k.ude, hold1ErHjemme: k.hold1ErHjemme }) : null,
                 g.id]);
        }
        await query(
            `UPDATE team_matches SET bp_livescore = 1, bp_livescore_kode = ?, bp_venue_id = ?,
                    bp_livescore_status = NULL WHERE id = ?`,
            [kode || null, model.match.venueId != null ? Number(model.match.venueId) : null, id]);

        // Delkampe, der allerede er i gang, sendes med det samme
        const klub = req.clubDbName && req.clubDbName !== 'direct' ? req.clubDbName : null;
        for (const g of games) {
            if (g.status === 'active' && g.court_number) planlaeg(klub, g.court_number);
        }

        const n = await hentTm(id);
        res.json(statusSvar(n.tm, n.games));
    } catch (e) { next(e); }
});

// ── Afsendelsen ─────────────────────────────────────────────────────────────

const _ventende = new Map();      // `${klub}|${bane}` → timer
const _sidstSendt = new Map();    // matchId → JSON af seneste besked (send kun ændringer)
const _sidstStatus = new Map();   // teamMatchId → { tekst, tid } (skriv ikke status hvert point)

function planlaeg(klub, bane) {
    const noegle = `${klub || ''}|${bane}`;
    if (_ventende.has(noegle)) return;
    const t = setTimeout(() => {
        _ventende.delete(noegle);
        const koer = () => sendBane(bane).catch(e => console.error(`Livescore til badmintonplayer (bane ${bane}):`, e.message));
        if (klub) runWithTenant(klub, koer); else koer();
    }, SAMLE_MS);
    if (t.unref) t.unref();
    _ventende.set(noegle, t);
}

async function gemStatus(tmId, tekst, sendt) {
    const nu = Date.now();
    const f = _sidstStatus.get(tmId);
    // Samme status skrives højst hvert minut (sidst sendt flytter sig ellers hvert point)
    if (f && f.tekst === tekst && nu - f.tid < 60000) return;
    _sidstStatus.set(tmId, { tekst, tid: nu });
    await query(
        `UPDATE team_matches SET bp_livescore_status = ?${sendt ? ', bp_livescore_sendt = UTC_TIMESTAMP()' : ''} WHERE id = ?`,
        [tekst, tmId]);
}

/** Send stillingen på banen, hvis den spiller en koblet delkamp med livescore slået til. */
async function sendBane(bane) {
    const g = await queryOne(
        `SELECT g.id, g.team_match_id, g.game_number, g.status, g.finished_at,
                g.team1_player1, g.team1_player2, g.team2_player1, g.team2_player2,
                g.bp_kamp_id, g.bp_spillere, tm.aktiv_kilde_id, tm.bp_venue_id
           FROM team_match_games g JOIN team_matches tm ON tm.id = g.team_match_id
          WHERE g.court_number = ? AND tm.status = 'active' AND tm.bp_livescore = 1
                AND g.bp_kamp_id IS NOT NULL AND g.started_at IS NOT NULL
          ORDER BY g.status = 'active' DESC, g.started_at DESC, g.id DESC LIMIT 1`, [bane]);
    if (!g || !g.aktiv_kilde_id) return null;
    // En afsluttet delkamp: kun lige efter (slutstillingen), ikke en gammel kamp på banen
    if (g.status === 'finished' && !(g.finished_at && Date.now() - new Date(g.finished_at).getTime() < 5 * 60000)) return null;

    const gs = await queryOne(
        `SELECT gs.*, c.is_doubles FROM game_states gs JOIN courts c ON c.id = gs.court_id WHERE c.court_number = ?`, [bane]);
    let k;
    try { k = JSON.parse(g.bp_spillere || 'null'); } catch { k = null; }
    if (!gs || !k) return null;

    const besked = bpl.byggeBesked({
        gs, game: g, bane,
        kobling: { bpKampId: g.bp_kamp_id, hjemme: k.hjemme || [], ude: k.ude || [], hold1ErHjemme: k.hold1ErHjemme !== false },
        bp: { leagueMatchId: g.aktiv_kilde_id, venueId: g.bp_venue_id },
    });
    if (!besked) {
        await gemStatus(g.team_match_id, `Bane ${bane}: spillerne på banen passer ikke med delkampen — intet sendt`, false);
        return null;
    }
    const json = JSON.stringify(besked);
    if (_sidstSendt.get(besked.matchId) === json) return besked;
    try {
        await hub.send(besked);
        _sidstSendt.set(besked.matchId, json);
        await gemStatus(g.team_match_id, 'ok', true);
    } catch (e) {
        await gemStatus(g.team_match_id, `Kunne ikke sende til badmintonplayer.dk: ${String(e.message || e).slice(0, 200)}`, false);
        // Ingen throw: fejlen står i admin (status), og loggen fyldes ikke ved hvert point
        return null;
    }
    return besked;
}

onAnyGameStateChange((klub, bane, type) => {
    if (type === 'update' || type === 'assignment') planlaeg(klub, bane);
});

module.exports = router;
module.exports.sendBane = sendBane;
module.exports._hub = hub;
module.exports._intern = { statusSvar, planlaeg, _sidstSendt };
