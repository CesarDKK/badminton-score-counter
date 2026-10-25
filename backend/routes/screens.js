const express = require('express');
const router = express.Router();
const { requireWriteAuthInClubMode, authMiddleware } = require('../middleware/auth');
const { clubAdminAuth } = require('../middleware/clubAdminAuth');
const { requirePage } = require('../middleware/pagePermission');
const { klientIp } = require('../middleware/rateLimiter');
const { registrer, liste, fjern } = require('../screens/skaermStatus');
const haendelseslog = require('../screens/haendelseslog');
const pcRapport = require('../screens/pcRapport');

const tenantKey = (req) => req.clubDbName || 'direct';
const kl = (ms) => new Date(ms).toLocaleTimeString('da-DK', { timeZone: 'Europe/Copenhagen' });

// POST /api/screens/heartbeat — TV'ets livstegn (hvert 20. sekund).
// Samme adgang som TV'ets øvrige kald: adgangslinkets token i club-mode, åbent
// i direct-mode. tokenId kommer fra tokenet, så skærmen kan vises under sit link.
router.post('/heartbeat', requireWriteAuthInClubMode, (req, res) => {
    const tokenId = req.user && req.user.role === 'device' ? req.user.tokenId : null;
    const r = registrer(tenantKey(req), req.body || {}, { tokenId, ip: klientIp(req) });
    if (!r) return res.status(400).json({ error: 'Ugyldigt livstegn' });

    // Til backend-loggen, så hændelserne kan findes bagefter (docker logs)
    const hvem = `${tenantKey(req)} bane ${r.skaerm.bane || '?'} "${r.skaerm.navn || r.skaerm.klientId}" (${r.skaerm.ip})`;
    if (r.ny) console.log(`[skærm] ${hvem}: tændt / første livstegn`);
    if (r.tilbageEfterSek) console.log(`[skærm] ${hvem}: tilbage efter ${r.tilbageEfterSek} s uden livstegn`);
    for (const h of r.nye) {
        const hvad = {
            frys: 'browseren stod stille',
            net: 'ingen forbindelse til serveren',
            genstart: 'startet forfra efter et hul uden livstegn',
            vaek: 'ingen livstegn, kom tilbage af sig selv'
        }[h.type];
        console.log(`[skærm] ${hvem}: ${hvad} i ${h.sek} s fra kl. ${kl(h.fra)}`);
    }
    // Gemmes i 30 dage til admin (venter ikke — livstegnet svares med det samme)
    haendelseslog.gem(tenantKey(req), r.skaerm, r.nye);
    res.json({ ok: true });
});

// GET /api/screens — klubbens skærme til admin (Adgangslinks). I club-mode samme
// adgang som adgangslinkene selv; i direct-mode det lokale admin-login.
const skaermAdmin = (req, res, next) => {
    if (req.accessMode !== 'club') return authMiddleware(req, res, next);
    clubAdminAuth(req, res, (err) => {
        if (err) return next(err);
        requirePage('devicetokens')(req, res, next);
    });
};

router.get('/', skaermAdmin, (req, res) => {
    res.json(liste(tenantKey(req)));
});

// GET /api/screens/haendelser?dage=30 — klubbens hændelseslog (højst 30 dage)
router.get('/haendelser', skaermAdmin, async (req, res, next) => {
    try {
        res.json(await haendelseslog.forKlub(tenantKey(req), req.query.dage));
    } catch (error) {
        next(error);
    }
});

// GET /api/screens/haendelser/:id/log — loguddraget fra en TV-PC's rapport
router.get('/haendelser/:id/log', skaermAdmin, async (req, res, next) => {
    try {
        const log = await haendelseslog.hentLog(Number(req.params.id) || 0, tenantKey(req));
        if (log == null) return res.status(404).json({ error: 'Ingen log til denne hændelse' });
        res.json({ log });
    } catch (error) {
        next(error);
    }
});

// POST /api/screens/pc-rapport — TV-PC'ens egen rapport (kiosk: rapport): hvordan
// forrige kørsel sluttede, og browser-vagtens genstarter. Ingen login: PC'en
// sender sit adgangslinks token i X-Adgangslink (fra TV_URL i kiosk.conf), og
// linket skal være aktivt i klubben.
router.post('/pc-rapport', async (req, res, next) => {
    try {
        if (req.accessMode !== 'club' && req.accessMode !== 'direct') {
            return res.status(404).json({ error: 'Endpoint ikke fundet' });
        }
        const token = req.get('X-Adgangslink');
        if (!pcRapport.gyldigtToken(token)) return res.status(401).json({ error: 'Mangler adgangslink' });
        const { queryOne } = require('../config/database');
        const deviceToken = await queryOne(
            'SELECT id, destination FROM device_tokens WHERE token = ? AND is_active = 1', [token]);
        if (!deviceToken) return res.status(403).json({ error: 'Ugyldigt eller tilbagekaldt adgangslink' });

        const rapport = pcRapport.rensRapport(req.body);
        if (!rapport) return res.status(400).json({ error: 'Ugyldig rapport' });
        if (!pcRapport.indenforLoft(`${tenantKey(req)}:${deviceToken.id}`, rapport.haendelser.length)) {
            return res.status(429).json({ error: 'For mange hændelser — prøv igen senere' });
        }

        const skaerm = pcRapport.skaermFor(rapport.navn, deviceToken);
        for (const h of rapport.haendelser) {
            console.log(`[skærm] ${tenantKey(req)} "${skaerm.navn}" (${klientIp(req)}, Badminton TV ${rapport.kioskVersion || '?'}): ${h.type} — ${h.tekst || ''}`);
        }
        await haendelseslog.gem(tenantKey(req), skaerm, rapport.haendelser);
        res.json({ ok: true, modtaget: rapport.haendelser.length });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/screens/:klientId — fjern en skærm, der ikke er i brug mere
router.delete('/:klientId', skaermAdmin, (req, res) => {
    if (!fjern(tenantKey(req), req.params.klientId)) {
        return res.status(404).json({ error: 'Skærmen findes ikke (længere)' });
    }
    res.json({ success: true });
});

module.exports = router;
