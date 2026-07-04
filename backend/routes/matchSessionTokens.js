const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const { query, queryOne } = require('../config/database');

// Henter den aktive match-session token for en bane, eller null hvis ingen findes.
// Bruges i "resume"-mode hvor vi KUN vil vise QR hvis banen allerede kører i
// QR-selvbetjening — vi opretter ikke en ny token (så officielle holdkamp-/
// turneringskampe ikke får en "overtag"-QR).
async function getActiveToken(courtNumber) {
    const existing = await queryOne(
        `SELECT token FROM device_tokens
         WHERE token_type = 'match_session'
           AND court_number = ?
           AND is_active = 1
         ORDER BY id DESC LIMIT 1`,
        [courtNumber]
    );
    return existing ? existing.token : null;
}

// Henter eller opretter en aktiv match-session token for en bane.
// Returneres som raw streng (bruges internt af QR-endpointet).
async function getOrCreateActiveToken(courtNumber) {
    const existing = await getActiveToken(courtNumber);
    if (existing) return existing;

    const token = crypto.randomBytes(32).toString('hex');
    const destination = `court/${courtNumber}`;
    const name = `QR kamp-session bane ${courtNumber}`;

    await query(
        `INSERT INTO device_tokens
         (token, name, destination, token_type, court_number, locked, is_active)
         VALUES (?, ?, ?, 'match_session', ?, 1, 1)`,
        [token, name, destination, courtNumber]
    );

    return token;
}

// Sletter alle match-session tokens for en bane permanent.
// Kaldes når en kamp starter eller banen ryddes.
// Match-session tokens (QR-kode) giver ingen værdi efter brug og ryddes straks.
async function invalidateCourtTokens(courtNumber) {
    await query(
        `DELETE FROM device_tokens
         WHERE token_type = 'match_session'
           AND court_number = ?`,
        [courtNumber]
    );
}

// GET /api/qr-code/:courtId — returnerer PNG med QR der peger på /t/<token>
router.get('/:courtId', async (req, res) => {
    if (req.accessMode !== 'club') return res.status(404).end();

    const courtNumber = parseInt(req.params.courtId, 10);
    if (!Number.isInteger(courtNumber) || courtNumber < 1 || courtNumber > 20) {
        return res.status(400).end();
    }

    try {
        // resume=1: vis kun QR hvis banen allerede har en aktiv guest-session
        // (kampen blev startet via QR). Opret aldrig en ny token her — så en
        // holdkamp/turneringskamp uden guest-session ikke får en overtag-QR.
        const token = req.query.resume
            ? await getActiveToken(courtNumber)
            : await getOrCreateActiveToken(courtNumber);

        if (!token) return res.status(404).end();

        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const url = `${protocol}://${req.hostname}/t/${token}`;

        const buffer = await QRCode.toBuffer(url, {
            width: 220,
            margin: 2,
            color: { dark: '#ffffff', light: '#00000000' }
        });

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.end(buffer);
    } catch (err) {
        console.error('QR-generering fejlede:', err);
        res.status(500).end();
    }
});

module.exports = router;
module.exports.invalidateCourtTokens = invalidateCourtTokens;
module.exports.getActiveToken = getActiveToken;
