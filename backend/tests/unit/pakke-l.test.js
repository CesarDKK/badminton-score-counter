/**
 * Pakke L — sikkerhed, nr. 15–18, 88, 91–94 (sikkerhedsrapporten og fundliste 2,
 * november 2026).
 *
 * Databasen erstattes af en optager, FØR ruterne indlæses (de henter
 * query/queryOne ud ved indlæsningen). node --test kører hver fil i sin egen
 * proces, så det rammer ikke andre tests.
 *
 * Kør: npm run test:unit
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed';

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

// ---------- Falsk database ----------
const db = require('../../config/database');
let svar = async () => [];
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };

const jwt = require('jsonwebtoken');
const auth = require('../../middleware/auth');
const rl = require('../../middleware/rateLimiter');

// Rutens sidste handler (efter middleware)
function rute(router, metode, sti) {
    const lag = router.stack.find(l => l.route && l.route.path === sti && l.route.methods[metode]);
    assert.ok(lag, `${metode} ${sti} findes`);
    const s = lag.route.stack;
    return s[s.length - 1].handle;
}
function ruteLag(router, metode, sti) {
    const lag = router.stack.find(l => l.route && l.route.path === sti && l.route.methods[metode]);
    assert.ok(lag, `${metode} ${sti} findes`);
    return lag.route.stack.map(l => l.handle);
}
function svarObjekt() {
    return {
        statusCode: 200, body: null, headers: {}, cookies: {},
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
        send(b) { this.body = b; return this; },
        end() { return this; },
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        redirect(a, b) { this.statusCode = b === undefined ? 302 : a; this.location = b === undefined ? a : b; return this; },
    };
}

// En lille express-app på en tilfældig port (til grænserne)
const servere = [];
after(() => servere.forEach(s => s.close()));
function app(opsaet) {
    const a = express();
    a.set('trust proxy', false);
    a.use(express.json());
    opsaet(a);
    const s = a.listen(0);
    servere.push(s);
    return (p, opt = {}) => fetch(`http://127.0.0.1:${s.address().port}${p}`, opt);
}

// ======================= Nr. 15: ur-koden kan gættes =======================

test('15a: ipNoegle — IPv4 som den er, IPv6 pr. /64', () => {
    const { ipNoegle } = rl;
    assert.equal(ipNoegle('203.0.113.7'), '203.0.113.7');
    assert.equal(ipNoegle('2001:db8:abcd:12:1:2:3:4'), '2001:db8:abcd:12::/64');
    assert.equal(ipNoegle('2001:db8:abcd:12::99'), '2001:db8:abcd:12::/64');
    assert.equal(ipNoegle('2001:0DB8:ABCD:0012:ffff::1'), '2001:db8:abcd:12::/64', 'store bogstaver og foranstillede nuller');
    assert.equal(ipNoegle('[2001:db8::1]'), '2001:db8:0:0::/64');
    assert.equal(ipNoegle('fe80::1%eth0'), 'fe80:0:0:0::/64');
    assert.equal(ipNoegle('::ffff:1.2.3.4'), '1.2.3.4', 'IPv4 i IPv6-form');
    assert.equal(ipNoegle('64:ff9b::1.2.3.4'), '64:ff9b:0:0::/64');
    // Noget, der ikke er en adresse, tælles for sig, som det er
    assert.equal(ipNoegle('1::2::3'), '1::2::3');
    assert.equal(ipNoegle('1:2:3:4:5:6:7:8:9'), '1:2:3:4:5:6:7:8:9');
});

test('15a: alle grænser tæller IPv6 pr. /64 — en ny adresse i samme /64 giver ikke nye forsøg', async () => {
    const hent = app(a => a.post('/login', rl.loginLimiter, (r, s) => s.json({ ok: true })));
    const koder = [];
    for (let i = 0; i < 11; i++) {
        koder.push((await hent('/login', { method: 'POST', headers: { 'cf-connecting-ip': `2001:db8:1:2::${(i + 1).toString(16)}` } })).status);
    }
    assert.deepEqual(koder.slice(0, 10), Array(10).fill(200));
    assert.equal(koder[10], 429);
    // Et andet /64 har sin egen tæller
    assert.equal((await hent('/login', { method: 'POST', headers: { 'cf-connecting-ip': '2001:db8:1:3::1' } })).status, 200);
    // Alle keyGenerators bruger graenseIp
    const src = laes('backend/middleware/rateLimiter.js');
    assert.doesNotMatch(src, /keyGenerator: \(req\) => '[a-z-]+:' \+ klientIp\(req\)/);
    assert.match(src, /'planner-token:ip:' \+ graenseIp\(req\)/);
});

test('15b: forkerte ur-koder har et loft pr. klub — kun forkerte tæller, og det logges én gang', async () => {
    const hent = app(a => a.post('/kobl', (req, res, next) => { req.clubSubdomain = req.headers['x-klub']; next(); },
        rl.urKodeKlubLimiter, (req, res) => res.status(req.body.kode === '111111' ? 200 : 404).json({})));
    const advarsler = [];
    const gammel = console.warn;
    console.warn = (t) => advarsler.push(String(t));
    try {
        const forsoeg = (kode, ip, klub = 'lyngby') => hent('/kobl', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'x-klub': klub },
            body: JSON.stringify({ kode }),
        }).then(r => r.status);
        // Rigtige koder tæller ikke
        for (let i = 0; i < 5; i++) assert.equal(await forsoeg('111111', '198.51.100.1'), 200);
        for (let i = 0; i < rl.UR_KODE_KLUB_MAX; i++) assert.equal(await forsoeg('000000', `203.0.113.${i}`), 404);
        // Loftet er nået for hele klubben — også for en rigtig kode fra en ny adresse
        assert.equal(await forsoeg('000000', '192.0.2.1'), 429);
        assert.equal(await forsoeg('111111', '192.0.2.2'), 429);
        assert.equal(advarsler.filter(t => t.includes('[ur] lyngby')).length, 1, 'én log-linje pr. vindue');
        // En anden klub mærker intet
        assert.equal(await forsoeg('111111', '192.0.2.3', 'holte'), 200);
    } finally {
        console.warn = gammel;
    }
});

const urTaeller = require('../../routes/urTaeller');

test('15c: /api/ur/kobl — adgangen er låst til uret (via: ur), 6 timer, og bundet til banen fra linket', async () => {
    const lag = ruteLag(urTaeller, 'post', '/kobl');
    assert.ok(lag.includes(rl.urKodeLimiter) && lag.includes(rl.urKodeKlubLimiter), 'begge grænser sidder på ruten');
    const kobl = rute(urTaeller, 'post', '/kobl');
    nulstil(async (sql) => {
        if (/ur_taelling/.test(sql)) return [{ setting_value: 'true' }];
        if (/FROM device_tokens/.test(sql)) return [{ id: 9, destination: 'court/3', locked: 1, court_number: 3 }];
        return { affectedRows: 1 };
    });
    const kør = async (body) => {
        const res = svarObjekt();
        let fejl = null;
        await kobl({ accessMode: 'club', clubSubdomain: 'lyngby', body }, res, (e) => { fejl = e; });
        if (fejl) throw fejl;
        return res;
    };
    let res = await kør({ kode: '123456', bane: 3 });
    assert.equal(res.statusCode, 200);
    const t = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.equal(t.via, 'ur');
    assert.equal(t.tokenType, 'match_session');
    assert.equal(t.exp - t.iat, 6 * 3600);
    const opslag = kald.find(k => /ur_kode = \?/.test(k.sql));
    assert.match(opslag.sql, /AND court_number = \?/);
    assert.deepEqual(opslag.params, ['123456', 3]);
    // Gammelt link / kode tastet på uret: ingen bane → alle klubbens koder
    kald = [];
    res = await kør({ kode: '123456' });
    assert.equal(res.statusCode, 200);
    const uden = kald.find(k => /ur_kode = \?/.test(k.sql));
    assert.doesNotMatch(uden.sql, /court_number = \?/);
    assert.deepEqual(uden.params, ['123456']);
    // Uret sender banen fra linket med — kun fra linket
    const src = laes('frontend/ur-script.js');
    assert.match(src, /const krop = fraLink && linkBane \? \{ kode: k, bane: linkBane \} : \{ kode: k \};/);
});

test('15c: et ur-token virker kun på urets egne kald, ikke direkte på banens stilling', async () => {
    auth._saetAdgangslinkOpslag(async () => true);
    const urToken = jwt.sign({ role: 'device', tokenId: 9, destination: 'court/3', tokenType: 'match_session', clubSubdomain: 'lyngby', via: 'ur' }, process.env.JWT_SECRET);
    const qrToken = jwt.sign({ role: 'device', tokenId: 9, destination: 'court/3', tokenType: 'match_session', clubSubdomain: 'lyngby' }, process.env.JWT_SECRET);
    const kør = async (token, url) => {
        const res = svarObjekt();
        let videre = false;
        await auth.requireWriteAuthInClubMode({ accessMode: 'club', clubSubdomain: 'lyngby', originalUrl: url, headers: { authorization: `Bearer ${token}` } }, res, () => { videre = true; });
        return videre ? 'videre' : res.statusCode;
    };
    assert.equal(await kør(urToken, '/api/ur/tryk'), 'videre');
    assert.equal(await kør(urToken, '/api/ur/bane?taellerId=x'), 'videre');
    assert.equal(await kør(urToken, '/api/game-states/3/taeller'), 'videre', 'overtag tælleren');
    assert.equal(await kør(urToken, '/api/game-states/3'), 403);
    assert.equal(await kør(urToken, '/api/match-history'), 403);
    assert.equal(await kør(urToken, '/api/game-states/3/taeller/../'), 403);
    // QR-telefonen (uden via) er uændret
    assert.equal(await kør(qrToken, '/api/game-states/3'), 'videre');
});
