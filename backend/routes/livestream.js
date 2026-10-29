const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware, requireWriteAuthInClubMode } = require('../middleware/auth');
const { ikkeQrSession } = require('../middleware/qrSession');
const { clubAdminAuth } = require('../middleware/clubAdminAuth');
const { requirePage } = require('../middleware/pagePermission');
const { klientIp } = require('../middleware/rateLimiter');
const { gyldigtToken } = require('../screens/pcRapport');
const ls = require('../screens/livestream');

// Livestream fra TV-PC'ernes USB-kamera — se screens/livestream.js

const tenantKey = (req) => req.clubDbName || 'direct';

// Samme adgang som Adgangslinks (siden devicetokens); i direct-mode det lokale login
const livestreamAdmin = (req, res, next) => {
    if (req.accessMode !== 'club') return authMiddleware(req, res, next);
    clubAdminAuth(req, res, (err) => {
        if (err) return next(err);
        requirePage('devicetokens')(req, res, next);
    });
};

const baneNr = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
};

const plannerPaaBane = (bane) => queryOne(
    `SELECT a.court_number FROM planner_court_assignments a
       JOIN planner_rounds r ON r.id = a.round_id WHERE a.court_number = ?`, [bane]);

// En delkamp i en holdkamp står på banen — kun dem sendes af sig selv
const holdkampPaaBane = async (bane) => !!await queryOne(
    `SELECT g.id FROM team_match_games g JOIN team_matches tm ON tm.id = g.team_match_id
      WHERE g.court_number = ? AND g.status = 'active' AND tm.status = 'active' LIMIT 1`, [bane]);

// Tablettens og admins oversigt over én bane
async function baneStatus(req, bane) {
    const opsaetning = await queryOne('SELECT * FROM court_streams WHERE court_number = ?', [bane]);
    const link = await queryOne(
        'SELECT id FROM device_tokens WHERE camera_court = ? AND is_active = 1 LIMIT 1', [bane]);
    return ls.tabletStatus({
        opsaetning,
        kamera: !!link,
        pc: link ? ls.statusFor(tenantKey(req))[link.id] : null,
        holdkamp: await holdkampPaaBane(bane),
        planner: !!await plannerPaaBane(bane)
    });
}

// GET /api/livestream — banernes opsætning og TV-PC'erne, der kan have kamera
router.get('/', livestreamAdmin, async (req, res, next) => {
    try {
        const baner = await query('SELECT court_number FROM courts ORDER BY court_number');
        const opsaetning = new Map((await query('SELECT * FROM court_streams')).map(r => [r.court_number, r]));
        const links = await query(
            `SELECT id, name, destination, camera_court FROM device_tokens
              WHERE is_active = 1 AND token_type = 'permanent' AND destination LIKE 'tv%'
              ORDER BY name`);
        const status = ls.statusFor(tenantKey(req));
        res.json({
            standardUrl: ls.STANDARD_URL,
            baner: baner.map(({ court_number: n }) => {
                const o = opsaetning.get(n);
                const s = ls.startet(o);
                return {
                    bane: n,
                    enabled: !!(o && o.enabled),
                    streamUrl: o ? o.stream_url : ls.STANDARD_URL,
                    noegle: o ? ls.noegleSlut(o.stream_key) : null,
                    overlay: o ? !!o.overlay : true,
                    start: s ? s.start : null,
                    til: s && s.til ? new Date(s.til).toISOString() : null
                };
            }),
            kameraer: links.map(l => ({
                tokenId: l.id,
                navn: l.name,
                destination: l.destination,
                bane: l.camera_court,
                status: status[l.id] || null
            }))
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/livestream/baner/:bane — til/fra, adresse, nøgle og overlay
router.put('/baner/:bane', livestreamAdmin, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane || !await queryOne('SELECT id FROM courts WHERE court_number = ?', [bane])) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }
        const o = ls.rensOpsaetning(req.body);
        if (o.fejl) return res.status(400).json({ error: o.fejl });
        const nu = await queryOne('SELECT stream_key FROM court_streams WHERE court_number = ?', [bane]);
        const noegle = o.stream_key === undefined ? (nu ? nu.stream_key : null) : o.stream_key;
        if (o.enabled && !noegle) return res.status(400).json({ error: 'Indtast stream-nøglen, før banen slås til' });
        await query(
            `INSERT INTO court_streams (court_number, enabled, stream_url, stream_key, overlay)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), stream_url = VALUES(stream_url),
                stream_key = VALUES(stream_key), overlay = VALUES(overlay)`,
            [bane, o.enabled, o.stream_url, noegle, o.overlay]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: ${o.enabled ? 'slået til' : 'slået fra'}` +
            (o.stream_key !== undefined ? (o.stream_key ? ', ny nøgle' : ', nøgle fjernet') : ''));
        res.json({ success: true, noegle: ls.noegleSlut(noegle) });
    } catch (error) {
        next(error);
    }
});

// PUT /api/livestream/kamera/:tokenId — kameraet ved denne TV-PC filmer bane N
// (null = intet kamera). Én PC pr. bane: to PC'er på samme nøgle afviser hinanden
router.put('/kamera/:tokenId', livestreamAdmin, async (req, res, next) => {
    try {
        const id = Number(req.params.tokenId);
        const link = Number.isInteger(id) && await queryOne(
            "SELECT id FROM device_tokens WHERE id = ? AND token_type = 'permanent'", [id]);
        if (!link) return res.status(404).json({ error: 'Adgangslinket findes ikke' });
        const bane = req.body && req.body.bane != null ? baneNr(req.body.bane) : null;
        if (req.body && req.body.bane != null && !bane) return res.status(400).json({ error: 'Ugyldig bane' });
        if (bane) await query('UPDATE device_tokens SET camera_court = NULL WHERE camera_court = ? AND id <> ?', [bane, id]);
        await query('UPDATE device_tokens SET camera_court = ? WHERE id = ?', [bane, id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// POST/DELETE /api/livestream/baner/:bane/hele-dagen — admin starter banen
// for resten af dagen (en turnering): alt sendes, også mellem kampene, til
// TV-PC'en slukker kl. 23:59
router.post('/baner/:bane/hele-dagen', livestreamAdmin, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        const o = bane && await queryOne('SELECT enabled, stream_key FROM court_streams WHERE court_number = ?', [bane]);
        if (!o || !o.enabled || !o.stream_key) {
            return res.status(400).json({ error: 'Slå "Send banen" til med en stream-nøgle først' });
        }
        await query('UPDATE court_streams SET all_day_until = ? WHERE court_number = ?', [new Date(ls.dagensSlut()), bane]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: sendes hele dagen`);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

router.delete('/baner/:bane/hele-dagen', livestreamAdmin, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        await query('UPDATE court_streams SET all_day_until = NULL, armed_until = NULL, manual_since = NULL WHERE court_number = ?', [bane]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: stoppet i admin`);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// Tabletten på banen (Indstillinger → Start livestream). Ikke QR-telefoner:
// det er klubbens tablet, der beslutter, om kampen kommer på YouTube
const tablet = [requireWriteAuthInClubMode, ikkeQrSession];

// GET /api/livestream/bane/:bane — kan banen sendes, og er den startet?
router.get('/bane/:bane', tablet, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        res.json(await baneStatus(req, bane));
    } catch (error) {
        next(error);
    }
});

// POST /api/livestream/bane/:bane/start — kampen på banen sendes, eller den
// næste, hvis den starter inden 5 minutter
router.post('/bane/:bane/start', tablet, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        const foer = await baneStatus(req, bane);
        if (!foer.kan) return res.status(409).json({ error: 'Livestream er ikke sat op til banen i admin' });
        if (foer.start !== 'hele-dagen') {
            await query('UPDATE court_streams SET armed_until = ?, manual_since = NULL WHERE court_number = ?',
                [new Date(Date.now() + ls.KLAR_MS), bane]);
            console.log(`[livestream] ${tenantKey(req)} bane ${bane}: startet på tabletten`);
        }
        res.json(await baneStatus(req, bane));
    } catch (error) {
        next(error);
    }
});

// POST /api/livestream/bane/:bane/stop — tablettens start fortrydes. Hele
// dagen stoppes kun i admin, og holdkampe sendes stadig af sig selv
router.post('/bane/:bane/stop', tablet, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        await query('UPDATE court_streams SET armed_until = NULL, manual_since = NULL WHERE court_number = ?', [bane]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: stoppet på tabletten`);
        res.json(await baneStatus(req, bane));
    } catch (error) {
        next(error);
    }
});

// POST /api/livestream/pc — TV-PC'ens stream-tjeneste (kiosk: stream) spørger
// hvert par sekunder, om den skal sende, og fortæller, hvordan det går. Ingen
// login: adgangslinkets token i X-Adgangslink, som rapporten (pc-rapport).
// Nøglen er kun med, når der skal sendes.
router.post('/pc', async (req, res, next) => {
    try {
        if (req.accessMode !== 'club' && req.accessMode !== 'direct') {
            return res.status(404).json({ error: 'Endpoint ikke fundet' });
        }
        const token = req.get('X-Adgangslink');
        if (!gyldigtToken(token)) return res.status(401).json({ error: 'Mangler adgangslink' });
        const link = await queryOne(
            'SELECT id, camera_court FROM device_tokens WHERE token = ? AND is_active = 1', [token]);
        if (!link) return res.status(403).json({ error: 'Ugyldigt eller tilbagekaldt adgangslink' });

        const pc = ls.rensStatus(req.body);
        const tenant = tenantKey(req);
        const foer = ls.statusFor(tenant)[link.id];
        const bane = link.camera_court;
        let svar = { kamera: false, send: false, grund: 'intet-kamera' };
        if (bane) {
            const court = await queryOne('SELECT id, is_doubles FROM courts WHERE court_number = ?', [bane]);
            const opsaetning = await queryOne('SELECT * FROM court_streams WHERE court_number = ?', [bane]);
            const gs = court && await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
            const sidste = court && !gs && await queryOne('SELECT * FROM last_finished_matches WHERE court_id = ?', [court.id]);
            const planner = await plannerPaaBane(bane);
            const b = court
                ? ls.beslutning({ opsaetning, gs, sidste, planner, holdkamp: await holdkampPaaBane(bane),
                    senderNu: !!(foer && foer.online && foer.sender) })
                : { send: false, grund: 'ingen-bane' };
            // Tablettens "Start livestream" gælder nu kampen på banen — og kun den
            if (b.vaelg) {
                await query('UPDATE court_streams SET manual_since = UTC_TIMESTAMP(), armed_until = NULL WHERE court_number = ?', [bane]);
            } else if (b.glem) {
                await query('UPDATE court_streams SET manual_since = NULL WHERE court_number = ?', [bane]);
            }
            svar = { kamera: true, bane, send: b.send, grund: b.grund };
            if (b.send) {
                // Hele dagen mellem kampene: et tomt scoreboard (gennemsigtigt billede)
                const rk = b.kilde === 'gs' ? gs : b.kilde === 'sidste' ? sidste : null;
                const dbl = rk && rk.is_doubles != null ? !!rk.is_doubles : !!court.is_doubles;
                svar.url = opsaetning.stream_url;
                svar.noegle = opsaetning.stream_key;
                svar.overlay = !!opsaetning.overlay;
                svar.linjer = opsaetning.overlay ? ls.overlayLinjer(rk, dbl) : [];
                svar.tavle = opsaetning.overlay ? ls.overlayTavle(rk, dbl, bane) : null;
            }
        }
        const { ny } = ls.registrer(tenant, link.id, { ...pc, bane: bane || null, grund: svar.grund }, klientIp(req));
        // Til backend-loggen, når PC'en begynder/holder op med at sende eller får en ny fejl
        if (!foer || foer.sender !== ny.sender || (ny.fejl && foer.fejl !== ny.fejl)) {
            console.log(`[livestream] ${tenant} "${ny.navn || link.id}" bane ${bane || '-'}: ` +
                (ny.fejl ? `fejl: ${ny.fejl}` : ny.sender ? 'sender' : `sender ikke (${svar.grund})`));
        }
        res.json(svar);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
