/**
 * Nr. 21c (2): backenden opdager ved opstarten krypterede værdier, den ikke kan
 * læse med den nuværende JWT_SECRET, logger det tydeligt og viser det under
 * Serverens helbred i super-admin — uden at vælte.
 *
 * Værdierne lægges i databasen (krypteret med en anden nøgle, som efter et
 * skift af JWT_SECRET), og en backend nr. 2 startes på en anden port mod samme
 * MySQL: den rigtige opstart, ikke et kald af funktionen.
 *
 * Bevidst: den eneste læselige værdi er YouTube-klientens Client secret.
 * Hetzner-nøglen og klubbens YouTube-forbindelse er ulæselige — så kalder
 * serveren hverken Hetzner eller Google under testen.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { rodQuery, superToken, opretKlub, ADMIN_HOST } = require('./faelles');
const { krypter } = require('../../config/hemmelig');

const PORT2 = 3998;
let K, server, log = '';

// Som config/hemmelig.js, men med en anden (gammel) JWT_SECRET
function krypterMedAndenNoegle(tekst) {
    const n = Buffer.from(crypto.hkdfSync('sha256', 'en-gammel-jwt-secret-fra-foer-skiftet', 'badmintonapp', 'hemmelig-v1', 32));
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', n, iv);
    const data = Buffer.concat([c.update(tekst, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

function hent(sti, { host = '127.0.0.1', token } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: PORT2, path: sti, headers: { Host: host, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, res => {
            let d = '';
            res.on('data', c => { d += c; });
            res.on('end', () => { let b = d; try { b = JSON.parse(d); } catch {} resolve({ status: res.statusCode, body: b }); });
        });
        req.on('error', reject);
        req.end();
    });
}

async function ventPaaSund(maksMs = 90000) {
    const slut = Date.now() + maksMs;
    while (Date.now() < slut) {
        if (server.exitCode !== null) throw new Error(`backend nr. 2 stoppede (kode ${server.exitCode}):\n${log.slice(-3000)}`);
        try { if ((await hent('/health')).status === 200) return; } catch { /* ikke oppe endnu */ }
        await new Promise(r => setTimeout(r, 250));
    }
    throw new Error(`backend nr. 2 blev ikke sund:\n${log.slice(-3000)}`);
}

before(async () => {
    K = await opretKlub('noeglekontrol', 'Nøgleklub');
    await rodQuery('badminton_master', 'INSERT INTO indstillinger (noegle, vaerdi) VALUES (?, ?), (?, ?) ON DUPLICATE KEY UPDATE vaerdi = VALUES(vaerdi)',
        ['youtube_client_secret', krypter('client-secret-opdigtet'), 'hetzner_token', krypterMedAndenNoegle('hetzner-opdigtet')]);
    await rodQuery(K.db, "INSERT INTO livestream_youtube (id, refresh_token, kanal_navn) VALUES (1, ?, 'Testkanal')",
        [krypterMedAndenNoegle('refresh-opdigtet')]);

    server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..', '..'), env: { ...process.env, PORT: String(PORT2) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', d => { log += d; });
    server.stderr.on('data', d => { log += d; });
    await ventPaaSund();
});

after(async () => {
    if (server && server.exitCode === null) {
        const slut = new Promise(r => server.once('exit', r));
        server.kill('SIGTERM');
        await Promise.race([slut, new Promise(r => setTimeout(r, 10000))]);
        if (server.exitCode === null) server.kill('SIGKILL');
    }
    await rodQuery('badminton_master', "DELETE FROM indstillinger WHERE noegle IN ('youtube_client_secret', 'hetzner_token')");
    await rodQuery(K.db, 'DELETE FROM livestream_youtube');
    await require('../../config/masterDatabase').pool.end().catch(() => {});
});

test('21c: opstarten bliver færdig (sund) trods ulæselige værdier, og loggen siger det tydeligt', async () => {
    // /health er grøn lige før linjen skrives — vent på den (højst 10 s)
    for (const slut = Date.now() + 10000; !/Opstarten er færdig/.test(log) && Date.now() < slut;) {
        await new Promise(r => setTimeout(r, 100));
    }
    assert.match(log, /KRYPTERINGSNØGLE: 2 af 3 gemte hemmeligheder kan ikke læses med den nuværende JWT_SECRET/);
    assert.match(log, /Hetzner-nøglen/);
    assert.match(log, /Nøgleklub: YouTube-forbindelsen/);
    assert.match(log, /Opstarten er færdig/);
});

test('21c: super-admins helbred viser de ulæselige værdier', async () => {
    const r = await hent('/api/super-admin/server-helbred', { host: ADMIN_HOST, token: await superToken() });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    const nk = r.body.lokal.noegler;
    assert.ok(nk.tjekket);
    assert.equal(nk.antal, 3);
    assert.equal(nk.ulaeselige.length, 2);
    assert.ok(nk.ulaeselige.some(h => h.startsWith('Hetzner-nøglen')));
    assert.ok(nk.ulaeselige.some(h => h.startsWith('Nøgleklub: YouTube-forbindelsen')));
    assert.ok(!nk.ulaeselige.some(h => h.includes('Client secret')), 'den læselige værdi er ikke med');
    assert.deepEqual(nk.fejl, []);
});
