const express = require('express');
const router = express.Router();
const { requireWriteAuthInClubMode, authMiddleware } = require('../middleware/auth');
const { clubAdminAuth } = require('../middleware/clubAdminAuth');
const { requirePage } = require('../middleware/pagePermission');
const { klientIp } = require('../middleware/rateLimiter');
const { registrer, liste } = require('../screens/skaermStatus');

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
        console.log(h.type === 'frys'
            ? `[skærm] ${hvem}: browseren stod stille i ${h.sek} s fra kl. ${kl(h.fra)}`
            : `[skærm] ${hvem}: ingen forbindelse til serveren i ${h.sek} s fra kl. ${kl(h.fra)}`);
    }
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

module.exports = router;
