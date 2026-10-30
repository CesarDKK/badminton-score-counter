/**
 * Kryptering af hemmeligheder, der skal gemmes i klubbens database — fx
 * YouTube-adgangen (refresh-token). AES-256-GCM med en nøgle afledt af
 * JWT_SECRET, så der ikke skal en ny hemmelighed i .env.
 *
 * Skiftes JWT_SECRET, kan de gemte værdier ikke længere læses: dekrypter()
 * giver null, og klubben skal forbinde igen.
 */
const crypto = require('crypto');

const FORMAT = 'v1';

function noegle() {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error('JWT_SECRET mangler');
    return Buffer.from(crypto.hkdfSync('sha256', s, 'badmintonapp', 'hemmelig-v1', 32));
}

function krypter(tekst) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', noegle(), iv);
    const data = Buffer.concat([c.update(String(tekst), 'utf8'), c.final()]);
    return [FORMAT, iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// null, hvis værdien er ødelagt eller krypteret med en anden nøgle
function dekrypter(vaerdi) {
    const [format, iv, tag, data] = String(vaerdi || '').split(':');
    if (format !== FORMAT || !iv || !tag || !data) return null;
    try {
        const d = crypto.createDecipheriv('aes-256-gcm', noegle(), Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    } catch {
        return null;
    }
}

module.exports = { krypter, dekrypter };
