/**
 * Badmintonapps login-klient hos Google (Client ID + Client secret), som
 * super-admin indtaster. Den er fælles for hele serveren — klubberne forbinder
 * hver deres kanal gennem den. Gemmes i master-databasen, secret'en krypteret
 * (config/hemmelig.js). YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET i .env går forud.
 */
const masterDb = require('./masterDatabase');
const youtube = require('./youtube');
const { krypter, dekrypter } = require('./hemmelig');

const ID = 'youtube_client_id';
const SECRET = 'youtube_client_secret';

async function indlaes() {
    const raekker = await masterDb.query(
        'SELECT noegle, vaerdi, opdateret FROM indstillinger WHERE noegle IN (?, ?)', [ID, SECRET]);
    const v = Object.fromEntries(raekker.map(r => [r.noegle, r]));
    const id = v[ID] && v[ID].vaerdi;
    const secret = v[SECRET] && dekrypter(v[SECRET].vaerdi);
    youtube.brugKlient(id, secret);
    return { id: id || '', gemt: !!(id && secret), ulaeselig: !!(v[SECRET] && !secret),
        opdateret: v[SECRET] ? v[SECRET].opdateret : null };
}

async function gem(id, secret) {
    for (const [noegle, vaerdi] of [[ID, id], [SECRET, krypter(secret)]]) {
        await masterDb.query(
            'INSERT INTO indstillinger (noegle, vaerdi) VALUES (?, ?) ON DUPLICATE KEY UPDATE vaerdi = VALUES(vaerdi)',
            [noegle, vaerdi]);
    }
    youtube.brugKlient(id, secret);
}

async function fjern() {
    await masterDb.query('DELETE FROM indstillinger WHERE noegle IN (?, ?)', [ID, SECRET]);
    youtube.brugKlient(null, null);
}

module.exports = { indlaes, gem, fjern };
