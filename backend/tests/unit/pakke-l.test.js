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
// routes/livestream.js (nr. 17) kræver en upload-mappe
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('os').tmpdir();

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
const { generateSuperAdminToken, _saetSuperAdminOpslag } = require('../../middleware/superAdminAuth');
const { kodeAftryk } = require('../../middleware/klubAdminSession');
// Super-admin 1 findes i master-databasen med hash 'super-1' (nr. 18)
let superAdminRaekke = { password_hash: 'super-1' };
_saetSuperAdminOpslag(async (id) => (id === 1 ? superAdminRaekke : null));

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

// ======================= Nr. 16: QR- og ur-sessioner dør =======================

const mst = require('../../routes/matchSessionTokens');

test('16: midnat sletter alle QR-/ur-sessioner sammen med stillingerne', async () => {
    const { resetDatabase } = require('../../scheduler');
    nulstil(async () => ({ affectedRows: 2 }));
    const log = console.log;
    console.log = () => {};
    try { await resetDatabase('test'); } finally { console.log = log; }
    assert.ok(kald.some(k => /DELETE FROM game_states/.test(k.sql)));
    assert.ok(kald.some(k => /DELETE FROM device_tokens WHERE token_type = 'match_session'/.test(k.sql)));
    // Kun QR-sessioner — faste adgangslinks (TV, tablets) røres ikke
    assert.ok(!kald.some(k => /DELETE FROM device_tokens(?! WHERE token_type = 'match_session')/.test(k.sql)));
});

test('16: en session, ingen har åbnet i 12 timer, giver ikke nye sessioner og vises ikke på TV\'et', async () => {
    assert.equal(mst.matchSessionFrisk(), 'GREATEST(created_at, COALESCE(last_used_at, created_at)) > NOW() - INTERVAL 12 HOUR');
    nulstil(async () => []);
    assert.equal(await mst.getActiveToken(4), null);
    assert.match(kald[0].sql, /AND GREATEST\(created_at, COALESCE\(last_used_at, created_at\)\) > NOW\(\) - INTERVAL 12 HOUR/);
    // /t/<token> og /validate: kun faste links eller friske QR-sessioner
    assert.match(laes('backend/server.js'), /WHERE token = \? AND is_active = 1 AND \(token_type <> 'match_session' OR \$\{matchSessionFrisk\(\)\}\)/);
    const validate = rute(require('../../routes/deviceTokens'), 'get', '/validate/:token');
    nulstil(async () => []);
    const res = svarObjekt();
    await validate({ params: { token: 'x' } }, res, (e) => { throw e; });
    assert.equal(res.statusCode, 401);
    assert.match(kald[0].sql, /token_type <> 'match_session' OR GREATEST/);
    // Uret kan ikke koble på en udløbet session
    assert.match(laes('backend/routes/urTaeller.js'), /\$\{medBane \? 'AND court_number = \?' : ''\} AND \$\{matchSessionFrisk\(\)\}/);
});

test('16: en ny QR-kode til banen rydder den udløbne session først', async () => {
    const baneTildeling = require('../../config/baneTildeling');
    const gammel = baneTildeling.turneringPaaBane;
    baneTildeling.turneringPaaBane = async () => false;
    try {
        // getOrCreateActiveToken er intern — kør den via QR-ruten som admin
        const qr = rute(mst, 'get', '/:courtId');
        nulstil(async (sql) => (/^\s*SELECT token FROM device_tokens/.test(sql) ? [] : { affectedRows: 1 }));
        const admin = generateSuperAdminToken(1, 'superadmin', false, 'super-1');
        const res = svarObjekt();
        await qr({ accessMode: 'club', params: { courtId: '4' }, query: {}, hostname: 'lyngby.badmintonapp.dk', headers: { authorization: `Bearer ${admin}` } }, res);
        const i = kald.findIndex(k => /DELETE FROM device_tokens/.test(k.sql));
        const j = kald.findIndex(k => /INSERT INTO device_tokens/.test(k.sql));
        assert.ok(i >= 0 && j > i, 'slettes før den nye oprettes');
        assert.match(kald[i].sql, /court_number = \? AND NOT \(GREATEST/);
        assert.deepEqual(kald[i].params, [4]);
    } finally {
        baneTildeling.turneringPaaBane = gammel;
    }
});

// ======================= Nr. 17: YouTube-forbindelsen følger browseren =======================


test('17: /youtube/svar kræver cookien fra den browser, der trykkede "Forbind"', async () => {
    const youtube = require('../../config/youtube');
    const livestream = require('../../routes/livestream');
    youtube.brugKlient('klient-id', 'klient-hemmelighed');
    const byttet = [];
    youtube.byttKode = async (kode) => { byttet.push(kode); return { access_token: 'a', refresh_token: 'r' }; };
    youtube.kanal = async () => ({ id: 'UC1', navn: 'Lyngby BK' });
    youtube.glemAdgang = () => {};
    nulstil(async () => ({ affectedRows: 1 }));

    // 1. "Forbind": nonce i state og i en HttpOnly-cookie på klubbens adresse
    const forbind = rute(livestream, 'post', '/youtube/forbind');
    const res1 = svarObjekt();
    res1.cookie = (navn, vaerdi, valg) => { res1.cookies[navn] = { vaerdi, valg }; };
    const req = { accessMode: 'club', hostname: 'lyngby.badmintonapp.dk', clubDbName: 'klub_lyngby', headers: {} };
    process.env.APP_DOMAIN = 'badmintonapp.dk';
    await forbind(req, res1, (e) => { throw e; });
    const c = res1.cookies.yt_forbind;
    assert.ok(c, 'cookien sættes');
    assert.deepEqual({ ...c.valg, maxAge: undefined }, { httpOnly: true, sameSite: 'lax', path: '/api/livestream/youtube', secure: true, maxAge: undefined });
    const state = new URL(res1.body.url).searchParams.get('state');
    assert.equal(jwt.verify(state, process.env.JWT_SECRET).n, c.vaerdi);

    // 2. Svaret fra Google
    const svarRute = rute(livestream, 'get', '/youtube/svar');
    const kør = async (cookie, st = state) => {
        const res = svarObjekt();
        res.clearCookie = (navn) => { res.ryddet = navn; };
        await svarRute({ ...req, headers: cookie ? { cookie } : {}, query: { state: st, code: 'kode-fra-google' } }, res, (e) => { throw e; });
        return res;
    };
    const advar = console.warn; const log = console.log;
    console.warn = () => {}; console.log = () => {};
    try {
        // En andens browser (uden cookien): afvist, koden byttes ikke
        let res = await kør(null);
        assert.match(res.location, /youtube=fejl/);
        assert.match(decodeURIComponent(res.location), /i den browser, hvor du trykkede/);
        assert.equal(byttet.length, 0);
        // …og staten er brugt op
        res = await kør(`yt_forbind=${c.vaerdi}`);
        assert.match(decodeURIComponent(res.location), /allerede brugt/);

        // Ny runde i admins browser: forbundet
        const res2 = svarObjekt();
        res2.cookie = (navn, vaerdi) => { res2.cookies[navn] = vaerdi; };
        await forbind(req, res2, (e) => { throw e; });
        const st2 = new URL(res2.body.url).searchParams.get('state');
        // Forkert nonce i cookien
        res = await kør('andet=1; yt_forbind=000000000000000000000000', st2);
        assert.match(res.location, /youtube=fejl/);
        const res3 = svarObjekt();
        res3.cookie = (navn, vaerdi) => { res3.cookies[navn] = vaerdi; };
        await forbind(req, res3, (e) => { throw e; });
        const st3 = new URL(res3.body.url).searchParams.get('state');
        res = await kør(`andet=1; yt_forbind=${res3.cookies.yt_forbind}`, st3);
        assert.match(res.location, /youtube=forbundet/);
        assert.equal(res.ryddet, 'yt_forbind');
        assert.deepEqual(byttet, ['kode-fra-google']);
    } finally {
        console.warn = advar; console.log = log;
    }
});

// ======================= Nr. 18: super-admin-sessioner kan trækkes tilbage =======================

async function koer(mw, request) {
    const res = svarObjekt();
    let videre = false;
    await mw(request, res, (e) => { if (e) throw e; videre = true; });
    return videre ? 'videre' : res;
}
const medToken = (token, extra = {}) => ({ headers: { authorization: `Bearer ${token}` }, accessMode: 'club', clubSubdomain: 'lyngby', path: '/x', originalUrl: '/api/x', ...extra });

test('18: super-admin-tokenet bærer et aftryk af adgangskoden og slås op ved hvert kald', async () => {
    const token = generateSuperAdminToken(1, 'superadmin', false, 'super-1');
    assert.equal(jwt.decode(token).pv, kodeAftryk('super-1'));
    assert.equal(await koer(auth.authMiddleware, medToken(token)), 'videre');
    assert.equal(await koer(auth.requireWriteAuthInClubMode, medToken(token)), 'videre');
    // Adgangskoden skiftet (eller lækket token efter skiftet): afvist overalt
    superAdminRaekke = { password_hash: 'ny-hash' };
    try {
        for (const mw of [auth.authMiddleware, auth.requireWriteAuthInClubMode, require('../../middleware/superAdminAuth').superAdminAuth]) {
            const r = await koer(mw, medToken(token));
            assert.equal(r.statusCode, 401);
            assert.equal(r.body.sessionEnded, true);
        }
    } finally {
        superAdminRaekke = { password_hash: 'super-1' };
    }
});

test('18: "Jeg er her stadig" fornyer ikke et super-admin-token efter skiftet adgangskode', async () => {
    const session = require('../../routes/session');
    const lag = ruteLag(session, 'post', '/forny');
    const token = generateSuperAdminToken(1, 'superadmin', false, 'super-1');
    const kørForny = async () => {
        const req = medToken(token, { accessMode: 'direct' });
        const r = await koer(lag[0], req);
        if (r !== 'videre') return r;
        const res = svarObjekt();
        lag[1](req, res);
        return res;
    };
    const ok = await kørForny();
    assert.equal(ok.statusCode, 200);
    assert.equal(jwt.decode(ok.body.token).pv, kodeAftryk('super-1'), 'aftrykket følger med det fornyede token');
    superAdminRaekke = { password_hash: 'ny-hash' };
    try {
        assert.equal((await kørForny()).statusCode, 401);
    } finally {
        superAdminRaekke = { password_hash: 'super-1' };
    }
});

test('18: et must-change-token virker ikke på klubbernes API', async () => {
    const token = generateSuperAdminToken(1, 'superadmin', true, 'super-1');
    for (const mw of [auth.authMiddleware, auth.requireWriteAuthInClubMode]) {
        const r = await koer(mw, medToken(token));
        assert.equal(r.statusCode, 403);
        assert.equal(r.body.mustChangePassword, true);
    }
});

test('18: login og skift af adgangskode udsteder tokenet med det aktuelle aftryk', async () => {
    const src = laes('backend/routes/superAdmin.js');
    assert.match(src, /generateSuperAdminToken\(admin\.id, admin\.username, mustChange, admin\.password_hash\)/);
    assert.match(src, /generateSuperAdminToken\(admin\.id, req\.superAdmin\.username, false, hash\)/);
});

// ======================= Nr. 92: åben omdirigering fra /t/<kode> =======================

test('92: et adgangslink sender kun videre til en relativ sti på egen vært', () => {
    const { adgangslinkSession, sikkerSti } = require('../../middleware/adgangslinkSession');
    const url = (destination) => adgangslinkSession({ id: 1, destination, token_type: 'permanent', locked: 0 }, 'lyngby').url;
    // Kendte destinationer som før
    assert.match(url('tv/3'), /^\/tv-v3\.html\?court=3&dt=/);
    assert.match(url('court/2'), /^\/court-v3\.html\?court=2&dt=/);
    assert.match(url('oversigt'), /^\/oversigt\.html\?dt=/);
    assert.match(url('landing.html'), /^\/landing\.html\?dt=/);
    // Fra en gendannet backup: aldrig en anden vært
    for (const ond of ['/evil.com', '//evil.com', '\\evil.com', '/\\evil.com', 'https://evil.com', 'http:evil.com',
        '\t/evil.com', ' /evil.com', '../x', 'a/../../x', 'javascript:alert(1)', '%2F%2Fevil.com', '']) {
        const u = url(ond);
        assert.ok(u.startsWith('/') && !u.startsWith('//') && !u.startsWith('/\\'), `${JSON.stringify(ond)} → ${u}`);
        assert.equal(new URL(u, 'https://lyngby.badmintonapp.dk').host, 'lyngby.badmintonapp.dk', JSON.stringify(ond));
    }
    assert.equal(sikkerSti('/evil.com'), '/');
    assert.equal(sikkerSti('mappe/side.html'), '/mappe/side.html');
});

// ======================= Nr. 88: historikken kræver admin og har et loft =======================

test('88: historikken for holdkampe, turneringer og alle kampe kræver admin (siden Kamphistorik)', () => {
    const { requirePage } = require('../../middleware/pagePermission');
    for (const [fil, sti] of [['teamMatches', '/history'], ['tournaments', '/history'], ['matchHistory', '/all']]) {
        const lag = ruteLag(require(`../../routes/${fil}`), 'get', sti);
        assert.equal(lag[0], auth.authMiddleware, `${fil} ${sti}: login`);
        assert.equal(lag.length, 3, `${fil} ${sti}: side-rettighed`);
    }
    assert.ok(requirePage);
    // Admin sender sit token med (ikke requiresAuth: false) og beder om 200
    const api = laes('frontend/js/api.js');
    assert.match(api, /this\.request\(`\/match-history\/all\?limit=\$\{limit\}&offset=\$\{offset\}`\);/);
    assert.match(api, /this\.request\('\/team-matches\/history\?limit=200'\)/);
    assert.match(api, /this\.request\('\/tournaments\/history\?limit=200'\)/);
});

test('88: historikSide — højst 200 pr. side, offset fra 0', () => {
    const { historikSide } = require('../../config/historikSide');
    assert.deepEqual(historikSide({}), { limit: 200, offset: 0 });
    assert.deepEqual(historikSide({ limit: '5000', offset: '-3' }), { limit: 200, offset: 0 });
    assert.deepEqual(historikSide({ limit: '20', offset: '40' }), { limit: 20, offset: 40 });
    assert.deepEqual(historikSide({ limit: 'x; DROP', offset: '1 OR 1' }), { limit: 200, offset: 1 });
    assert.deepEqual(historikSide({ limit: '0' }), { limit: 1, offset: 0 });
});

test('88: holdkamp-historikken henter delkampene i én forespørgsel og fordeler dem', async () => {
    const hist = rute(require('../../routes/teamMatches'), 'get', '/history');
    nulstil(async (sql) => {
        if (/FROM team_matches/.test(sql)) return [{ id: 7, team1_name: 'A' }, { id: 5, team1_name: 'B' }];
        if (/FROM team_match_games/.test(sql)) return [
            { id: 1, team_match_id: 5, game_number: 1 }, { id: 2, team_match_id: 7, game_number: 1 }, { id: 3, team_match_id: 7, game_number: 2 }];
        return [];
    });
    const res = svarObjekt();
    await hist({ query: { limit: '10', offset: '20' } }, res, (e) => { throw e; });
    assert.match(kald[0].sql, /LIMIT 10 OFFSET 20/);
    assert.equal(kald.length, 2);
    assert.match(kald[1].sql, /team_match_id IN \(\?, \?\)/);
    assert.deepEqual(kald[1].params, [7, 5]);
    assert.deepEqual(res.body.map(t => t.games.map(g => g.id)), [[2, 3], [1]]);
    assert.equal(res.body[0].games[0].team_match_id, undefined);
});

// ======================= Nr. 91: demoens auto-sync mod tournamentsoftware =======================

test('91: demoen — højst 2 turneringer med auto-sync, uset i et døgn slås fra, klubberne mærker intet', async () => {
    const tournaments = require('../../routes/tournaments');
    const demo = require('../../config/demo');
    const gammelFetch = globalThis.fetch;
    const gammelDomaene = process.env.APP_DOMAIN;
    const fejl = [], log = console.log, err = console.error;
    globalThis.fetch = async () => { throw new Error('intet net i testen'); };
    console.error = (...a) => fejl.push(a.join(' '));
    console.log = () => {};
    process.env.APP_DOMAIN = 'badmintonapp.dk';
    try {
        let naesteNu = new Date('2026-11-18T08:00:00Z');
        const kør = async (label) => {
            fejl.length = 0;
            tournaments._demo.sidstHentet.clear();
            nulstil(async (sql) => (/FROM tournaments/.test(sql)
                ? [{ id: 9, source_tournament_id: 'a' }, { id: 8, source_tournament_id: 'b' }, { id: 7, source_tournament_id: 'c' }]
                : { affectedRows: 1 }));
            // Fast tidspunkt om dagen (ingen natpause), en time frem pr. kørsel (ingen fejl-pause fra forrige)
            naesteNu = new Date(naesteNu.getTime() + 3600000);
            await tournaments.runTournamentAutoSync(label, naesteNu);
            return {
                fra: kald.filter(k => /SET auto_sync = 0/.test(k.sql)).map(k => k.params[0]),
                hentet: [9, 8, 7].filter(id => fejl.some(f => f.includes(`turnering ${id} `))),
            };
        };
        tournaments._demo.sidstSet.set(9, Date.now());
        tournaments._demo.sidstSet.set(8, Date.now() - demo.DEMO_AUTO_SYNC_USET_MS - 60000);
        assert.deepEqual(await kør('direct'), { fra: [8, 7], hentet: [9] }, 'demoen');
        assert.deepEqual(await kør('klub_lyngby'), { fra: [], hentet: [9, 8, 7] }, 'en klub');
        // Lokal installation (ingen APP_DOMAIN) er ikke demoen
        delete process.env.APP_DOMAIN;
        assert.deepEqual(await kør('direct'), { fra: [], hentet: [9, 8, 7] }, 'lokal installation');
    } finally {
        globalThis.fetch = gammelFetch;
        console.error = err; console.log = log;
        if (gammelDomaene === undefined) delete process.env.APP_DOMAIN; else process.env.APP_DOMAIN = gammelDomaene;
    }
});

test('91: demoen — manuel opdatering højst hvert 2. minut, og "slå til" afvises over loftet', async () => {
    const tournaments = require('../../routes/tournaments');
    const gammelDomaene = process.env.APP_DOMAIN;
    process.env.APP_DOMAIN = 'badmintonapp.dk';
    try {
        tournaments._demo.sidstHentet.clear();
        assert.equal(tournaments._demo.demoSyncVent(4), 0);
        assert.ok(tournaments._demo.demoSyncVent(4) > 100, 'lige hentet');
        assert.equal(tournaments._demo.demoSyncVent(4, Date.now() + 121000), 0, 'efter 2 minutter');
        const sync = rute(tournaments, 'post', '/:id/sync-import');
        const res = svarObjekt();
        await sync({ accessMode: 'direct', params: { id: '4' }, query: {} }, res, (e) => { throw e; });
        assert.equal(res.statusCode, 429);
        // Slå til, når to andre allerede henter
        const auto = rute(tournaments, 'put', '/:id/auto-sync');
        nulstil(async (sql) => (/COUNT\(\*\)/.test(sql) ? [{ n: 2 }] : [{ id: 5, source_tournament_id: 'x' }]));
        const r2 = svarObjekt();
        await auto({ accessMode: 'direct', params: { id: '5' }, body: { enabled: true } }, r2, (e) => { throw e; });
        assert.equal(r2.statusCode, 409);
        assert.ok(!kald.some(k => /SET auto_sync = \?/.test(k.sql)));
        // En klub har intet loft
        const r3 = svarObjekt();
        nulstil(async (sql) => (/COUNT\(\*\)/.test(sql) ? [{ n: 9 }] : /SELECT id, source/.test(sql) ? [{ id: 5, source_tournament_id: null }] : { affectedRows: 1 }));
        await auto({ accessMode: 'club', clubDbName: 'klub_lyngby', params: { id: '5' }, body: { enabled: false } }, r3, (e) => { throw e; });
        assert.equal(r3.statusCode, 200);
        assert.ok(!kald.some(k => /COUNT\(\*\)/.test(k.sql)));
    } finally {
        if (gammelDomaene === undefined) delete process.env.APP_DOMAIN; else process.env.APP_DOMAIN = gammelDomaene;
    }
});

// ======================= Nr. 93: loft over live-strømmene (SSE) =======================

test('93: optagSse — 60 pr. adresse (IPv6 pr. /64), 300 pr. klub, lokalt net tælles ikke pr. adresse', () => {
    const { optagSse, SSE_MAKS_PR_IP, SSE_MAKS_PR_KLUB, _antalFor } = require('../../events/sseLoft');
    const advar = [], gammel = console.warn;
    console.warn = (t) => advar.push(t);
    try {
        const r = (ip, klub = 'klub_a') => ({ clubDbName: klub, headers: { 'cf-connecting-ip': ip }, socket: {} });
        const pladser = [];
        for (let i = 0; i < SSE_MAKS_PR_IP; i++) pladser.push(optagSse(r(`2001:db8:5:6::${i + 1}`)));
        assert.ok(pladser.every(p => p.slip));
        assert.match(optagSse(r('2001:db8:5:6::ffff')).afvist, /denne adresse/);
        assert.equal(advar.length, 1);
        assert.ok(optagSse(r('2001:db8:5:6::fffe')).afvist);
        assert.equal(advar.length, 1, 'én log-linje pr. minut');
        // En anden klub på samme adresse: stadig adressens loft
        assert.ok(optagSse(r('2001:db8:5:6::1', 'klub_b')).afvist);
        // Én lukker → plads til én ny
        pladser.pop().slip();
        pladser.pop().slip(); pladser[0].slip(); pladser[0].slip(); // slip to gange tæller én
        assert.equal(_antalFor('ip:2001:db8:5:6::/64'), SSE_MAKS_PR_IP - 3);
        pladser.forEach(p => p.slip());
        assert.equal(_antalFor('klub:klub_a'), 0);
        // Klubbens loft — fra mange adresser
        const mange = [];
        for (let i = 0; i < SSE_MAKS_PR_KLUB; i++) mange.push(optagSse(r(`198.51.${Math.floor(i / 50)}.${i % 50}`)));
        assert.ok(mange.every(p => p.slip));
        assert.match(optagSse(r('203.0.113.1')).afvist, /i klubben/);
        assert.ok(optagSse(r('203.0.113.1', 'klub_b')).slip, 'en anden klub mærker intet');
        mange.forEach(p => p.slip());
        // Lokal installation: hallens net tælles ikke pr. adresse
        const lokale = [];
        for (let i = 0; i < SSE_MAKS_PR_IP + 5; i++) lokale.push(optagSse({ clubDbName: undefined, headers: { 'x-real-ip': '192.168.1.20' }, socket: {} }));
        assert.ok(lokale.every(p => p.slip));
        lokale.forEach(p => p.slip());
    } finally {
        console.warn = gammel;
    }
});

test('93: SSE-ruten afviser med 429 over loftet og frigiver pladsen, når klienten går', async () => {
    const http = require('http');
    const { _antalFor, SSE_MAKS_PR_IP } = require('../../events/sseLoft');
    const hent = app(a => a.use('/api/game-states', require('../../routes/gameStates')));
    const port = servere[servere.length - 1].address().port;
    const aaben = () => new Promise((ok) => {
        const r = http.get({ port, path: '/api/game-states/events/stream?court=2', headers: { 'cf-connecting-ip': '203.0.113.99' } }, (res) => {
            res.once('data', () => ok({ r, status: res.statusCode }));
        });
    });
    const aabne = [];
    for (let i = 0; i < SSE_MAKS_PR_IP; i++) aabne.push(await aaben());
    assert.ok(aabne.every(a => a.status === 200));
    await new Promise(ok => setTimeout(ok, 50));
    assert.equal(_antalFor('ip:203.0.113.99'), SSE_MAKS_PR_IP, 'pladsen holdes, mens forbindelsen er åben');
    const gammel = console.warn;
    console.warn = () => {};
    try {
        const afvist = await hent('/api/game-states/events/stream', { headers: { 'cf-connecting-ip': '203.0.113.99' } });
        assert.equal(afvist.status, 429);
    } finally {
        console.warn = gammel;
    }
    aabne.forEach(a => a.r.destroy());
    await new Promise(ok => setTimeout(ok, 100));
    assert.equal(_antalFor('ip:203.0.113.99'), 0);
});

// ======================= Nr. 94: afviste planner-kald skyller ikke loggen væk =======================

test('94: kald uden gyldig nøgle — én log-linje pr. adresse pr. time, resten tælles i den', async () => {
    const planner = require('../../routes/plannerIntegration');
    const plannerAuth = ruteLag(planner, 'get', '/status')[1];
    let nr = 100;
    nulstil(async (sql) => (/INSERT INTO planner_log/.test(sql) ? { insertId: ++nr } : /SELECT id, name FROM planner_tokens/.test(sql) ? [] : { affectedRows: 1 }));
    const kør = async (ip) => {
        const res = svarObjekt();
        await plannerAuth({ path: '/status', clubDbName: 'klub_a', headers: { authorization: 'Bearer forkert', 'cf-connecting-ip': ip } }, res, (e) => { throw e; });
        return res.statusCode;
    };
    for (let i = 0; i < 5; i++) assert.equal(await kør('203.0.113.5'), 401);
    const indsat = () => kald.filter(k => /INSERT INTO planner_log/.test(k.sql));
    const opdateret = () => kald.filter(k => /UPDATE planner_log SET error_text/.test(k.sql));
    assert.equal(indsat().length, 1, 'én linje');
    assert.equal(opdateret().length, 4);
    assert.deepEqual(opdateret()[3].params, ['Ugyldig eller tilbagekaldt API-nøgle — 5 afviste kald fra adressen den seneste time', 101]);
    // Loggens oprydning (loftet) køres kun ved nye linjer
    assert.equal(kald.filter(k => /DELETE FROM planner_log/.test(k.sql)).length, 1);
    // En anden adresse (og IPv6 i et andet /64) får sin egen linje
    await kør('2001:db8:1:1::1');
    await kør('2001:db8:1:1::2');
    assert.equal(indsat().length, 2);
    // Efter en time: en ny linje
    await planner._logAfvist({ path: '/status', clubDbName: 'klub_a', headers: { 'cf-connecting-ip': '203.0.113.5' } }, Date.now() + 61 * 60 * 1000);
    assert.equal(indsat().length, 3);
});
