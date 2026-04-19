const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const { query, queryOne } = require('../config/database');

// Henter eller opretter en aktiv match-session token for en bane.
// Returneres som raw streng (bruges internt af QR-endpointet).
async function getOrCreateActiveToken(courtNumber) {
    const existing = await queryOne(
        `SELECT token FROM device_tokens
         WHERE token_type = 'match_session'
           AND court_number = ?
           AND is_active = 1
         ORDER BY id DESC LIMIT 1`,
        [courtNumber]
    );

    if (existing) return existing.token;

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

// Invaliderer alle aktive match-session tokens for en bane.
// Kaldes når en kamp starter eller banen ryddes.
async function invalidateCourtTokens(courtNumber) {
    await query(
        `UPDATE device_tokens
         SET is_active = 0
         WHERE token_type = 'match_session'
           AND court_number = ?
           AND is_active = 1`,
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
        const token = await getOrCreateActiveToken(courtNumber);
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
