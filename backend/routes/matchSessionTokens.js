const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const { query, queryOne } = require('../config/database');
const { afvisQrKode } = require('../middleware/qrSession');

// http eller https i QR-linket (nr. 96). Bag Cloudflare taler nginx kun http
// med backenden, så X-Forwarded-Proto er altid "http" — QR-koden pegede derfor
// på http://, og telefonen tog en omvej over Cloudflares omdirigering (og fik
// ingen wake lock, før den var på https). Under APP_DOMAIN (badmintonapp.dk og
// klubbernes subdomæner) er det altid https. Andre steder (lokal installation,
// localhost, en hal-PC på en IP-adresse) bruges den protokol, forbindelsen har.
function linkProtokol(req) {
    const domaene = String(process.env.APP_DOMAIN || '').toLowerCase();
    const vaert = String(req.hostname || '').toLowerCase();
    if (domaene && (vaert === domaene || vaert.endsWith('.' + domaene))) return 'https';
    const p = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    return p === 'https' ? 'https' : 'http';
}

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
    // Spiller banen en turneringskamp, vises ingen QR-session (nr. 82): før
    // kunne et TV i tomgangstilstand få udstedt en QR-kode, og telefonen kunne
    // tælle — og melde — turneringskampen. Ruten svarer 404 som uden kode.
    // En holdkamps delkamp må telefonen gerne tælle (se qrSession.js).
    const { turneringPaaBane } = require('../config/baneTildeling');
    if (await turneringPaaBane(courtNumber)) return null;

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

// Banens ur-kode (6 cifre) til QR-sessionen — laves første gang, den skal vises.
// Unik blandt de aktive sessioner, så en kode altid peger på én bane.
async function urKodeFor(token) {
    const row = await queryOne(
        "SELECT id, ur_kode FROM device_tokens WHERE token = ? AND token_type = 'match_session' AND is_active = 1", [token]);
    if (!row) return null;
    if (row.ur_kode) return row.ur_kode;
    for (let i = 0; i < 20; i++) {
        const kode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const optaget = await queryOne(
            "SELECT id FROM device_tokens WHERE ur_kode = ? AND token_type = 'match_session' AND is_active = 1", [kode]);
        if (optaget) continue;
        await query('UPDATE device_tokens SET ur_kode = ? WHERE id = ? AND ur_kode IS NULL', [kode, row.id]);
        return (await queryOne('SELECT ur_kode FROM device_tokens WHERE id = ?', [row.id])).ur_kode;
    }
    return null;
}

// Kampen er slut og banen står klar til næste ("Ny kamp"/"Færdig" på uret,
// "Start ny kamp" på QR-telefonen): banen får en ny ur-kode, så koden fra
// forrige kamp ikke kan kobles på igen. QR-sessionen og et ur, der allerede er
// koblet på, beholdes — den nye kode laves, næste gang TV'et henter QR-koden
async function nyUrKode(courtNumber) {
    await query(
        `UPDATE device_tokens SET ur_kode = NULL
          WHERE token_type = 'match_session' AND court_number = ? AND is_active = 1`,
        [courtNumber]
    );
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

    // QR-koden udsteder skriveadgang til banen, så den vises kun på banens TV
    // (eller for en admin) — ikke for enhver, der kender adressen.
    try {
        const afvist = await afvisQrKode(req, courtNumber);
        if (afvist) return res.status(afvist).end();

        // resume=1: vis kun QR hvis banen allerede har en aktiv guest-session
        // (kampen blev startet via QR). Opret aldrig en ny token her — så en
        // holdkamp/turneringskamp uden guest-session ikke får en overtag-QR.
        const token = req.query.resume
            ? await getActiveToken(courtNumber)
            : await getOrCreateActiveToken(courtNumber);

        if (!token) return res.status(404).end();

        const url = `${linkProtokol(req)}://${req.hostname}/t/${token}`;

        const buffer = await QRCode.toBuffer(url, {
            width: 220,
            margin: 2,
            color: { dark: '#ffffff', light: '#00000000' }
        });

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        // Tæl fra uret slået til: TV'et viser banens ur-kode under QR-koden
        const ur = await queryOne("SELECT setting_value FROM settings WHERE setting_key = 'ur_taelling'");
        if (ur && ur.setting_value === 'true') {
            const kode = await urKodeFor(token);
            if (kode) res.setHeader('X-Ur-Kode', kode);
        }
        res.end(buffer);
    } catch (err) {
        console.error('QR-generering fejlede:', err);
        res.status(500).end();
    }
});

module.exports = router;
module.exports.invalidateCourtTokens = invalidateCourtTokens;
module.exports.getActiveToken = getActiveToken;
module.exports.urKodeFor = urKodeFor;
module.exports.nyUrKode = nyUrKode;
module.exports.linkProtokol = linkProtokol;
