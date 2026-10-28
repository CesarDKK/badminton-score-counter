const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
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
                return {
                    bane: n,
                    enabled: !!(o && o.enabled),
                    streamUrl: o ? o.stream_url : ls.STANDARD_URL,
                    noegle: o ? ls.noegleSlut(o.stream_key) : null,
                    overlay: o ? !!o.overlay : true
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
            const planner = await queryOne(
                `SELECT a.court_number FROM planner_court_assignments a
                   JOIN planner_rounds r ON r.id = a.round_id WHERE a.court_number = ?`, [bane]);
            const b = court
                ? ls.beslutning({ opsaetning, gs, sidste, planner, senderNu: !!(foer && foer.online && foer.sender) })
                : { send: false, grund: 'ingen-bane' };
            svar = { kamera: true, bane, send: b.send, grund: b.grund };
            if (b.send) {
                const rk = b.kilde === 'gs' ? gs : sidste;
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
