const express = require('express');
const router = express.Router();
const { requireWriteAuthInClubMode, authMiddleware } = require('../middleware/auth');
const { clubAdminAuth } = require('../middleware/clubAdminAuth');
const { requirePage } = require('../middleware/pagePermission');
const { klientIp } = require('../middleware/rateLimiter');
const { registrer, liste, fjern } = require('../screens/skaermStatus');
const haendelseslog = require('../screens/haendelseslog');

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

// DELETE /api/screens/:klientId — fjern en skærm, der ikke er i brug mere
router.delete('/:klientId', skaermAdmin, (req, res) => {
    if (!fjern(tenantKey(req), req.params.klientId)) {
        return res.status(404).json({ error: 'Skærmen findes ikke (længere)' });
    }
    res.json({ success: true });
});

module.exports = router;
