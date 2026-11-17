/**
 * Pakke S — nr. 21 (fire små sikkerhedsting). Den fulde afprøvning mod rigtig
 * MySQL ligger i tests/integration/ (nr. 56); her de hurtige vagter.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8').replace(/\r\n/g, '\n');

// ── 21d: QR-kodens link (match_session) er ikke en TV-PC ──
test('21d: PC-endepunkterne slår kun links op, der ikke er QR-kodens (match_session)', () => {
    const screens = laes('backend/routes/screens.js');
    const pcLink = screens.slice(screens.indexOf('async function pcLink'), screens.indexOf("router.post('/pc-rapport'"));
    assert.match(pcLink, /FROM device_tokens WHERE token = \? AND is_active = 1\s+AND COALESCE\(token_type, 'permanent'\) <> 'match_session'/);
    // pc-rapport, pc-opdatering, pc-fejllog/spoerg og pc-fejllog går alle gennem pcLink
    for (const rute of ["'/pc-rapport'", "'/pc-opdatering'", "'/pc-fejllog/spoerg'"]) {
        const i = screens.indexOf(`router.post(${rute}`);
        assert.ok(i > 0, rute);
        assert.match(screens.slice(i, i + 200), /await pcLink\(req, res\)/, rute);
    }
    assert.match(screens, /async function fejllogAdgang[\s\S]{0,120}await pcLink\(req, res\)/);

    const ls = laes('backend/routes/livestream.js');
    const pc = ls.slice(ls.indexOf("router.post('/pc'"), ls.indexOf("router.post('/pc'") + 1200);
    assert.match(pc, /FROM device_tokens WHERE token = \? AND is_active = 1\s+AND COALESCE\(token_type, 'permanent'\) <> 'match_session'/);
    // Heartbeat (JWT) afviste allerede QR-sessionen
    assert.match(screens, /req\.user\.tokenType === 'match_session'\) \{\s+return res\.status\(403\)/);
});

// ── 21a: Livestream har sin egen side-rettighed ──
test('21a: livestream er en side-nøgle i backend, admin og super-admin, og migration 053 bevarer adgangen', () => {
    const sa = laes('backend/routes/superAdmin.js');
    assert.match(sa, /const VALID_PAGE_KEYS = \[[^\]]*'livestream'[^\]]*\];/);
    const ls = laes('backend/routes/livestream.js');
    const vagt = ls.slice(ls.indexOf('const livestreamAdmin'), ls.indexOf('const baneNr'));
    assert.match(vagt, /requirePage\('livestream'\)/);
    assert.doesNotMatch(vagt, /requirePage\('devicetokens'\)/);
    // Adgangslinks og skærmene følger stadig devicetokens
    assert.match(laes('backend/routes/deviceTokens.js'), /requirePage\('devicetokens'\)/);
    assert.match(laes('backend/routes/screens.js'), /requirePage\('devicetokens'\)/);

    const html = laes('frontend/admin.html');
    assert.match(html, /id="livestreamBtn"[^>]*data-page="livestream"/);
    assert.match(laes('frontend/admin-script.js'), /hash === '#livestream' && canAccess\('livestream'\)/);
    assert.match(laes('frontend/super-admin-script.js'), /\{ key: 'livestream', label: 'Livestream' \}/);

    const mig = laes('backend/migrations/053_livestream_side.sql');
    assert.match(mig, /JSON_ARRAY_APPEND\(page_permissions, '\$', 'livestream'\)/);
    assert.match(mig, /JSON_CONTAINS\(page_permissions, '"devicetokens"'\)/);
    assert.match(mig, /NOT JSON_CONTAINS\(page_permissions, '"livestream"'\)/);
    // club_admins er ikke i backuppen — en gendannelse kører ikke migrationen igen
    assert.ok(!require('../../config/klubBackup').BACKUP_TABLES.includes('club_admins'));
});

test('21a: super-admin og admin-siden henter de nye filer (cache-versioner)', () => {
    const v = (html, fil) => {
        const i = html.indexOf(fil + '?v=');
        return i < 0 ? NaN : parseInt(html.slice(i + fil.length + 3), 10);
    };
    assert.ok(v(laes('frontend/admin.html'), 'admin-script.js') >= 122);
    assert.ok(v(laes('frontend/super-admin.html'), 'super-admin-script.js') >= 44);
});

// ── 21b: stream-nøglerne er ikke med i backup-filen ──
test('21b: court_streams uden stream_key og yt_* i backuppen; gendannelsen sætter de nuværende ind', () => {
    const { SERVERKOLONNER, udenServerkolonner, medServerkolonner } = require('../../config/klubBackup');
    assert.deepEqual(Object.keys(SERVERKOLONNER), ['court_streams']);
    const row = { court_number: 1, enabled: 1, overlay: 1, stream_url: 'rtmps://x', stream_key: 'hemmelig', yt_stream_key: 'yt', yt_stream_id: 's' };
    assert.deepEqual(udenServerkolonner('court_streams', row), { court_number: 1, enabled: 1, overlay: 1, stream_url: 'rtmps://x' });
    assert.equal(udenServerkolonner('match_history', row), row, 'andre tabeller røres ikke');

    const nu = new Map([
        ['1', { stream_key: 'ny', yt_stream_key: null }],
        ['3', { stream_key: 'tre', yt_stream_key: null }],
        ['5', { stream_key: null, yt_stream_key: null }],
    ]);
    const ud = medServerkolonner('court_streams', [row, { court_number: 2, enabled: 0, stream_key: 'gammel' }], nu);
    assert.deepEqual(ud, [
        { court_number: 1, enabled: 1, overlay: 1, stream_url: 'rtmps://x', stream_key: 'ny', yt_stream_key: null },
        { court_number: 2, enabled: 0 },
        { court_number: 3, stream_key: 'tre', yt_stream_key: null },
    ]);
});

test('21b: tidsstempler fra databasen skrives som Date (ikke som JSON-tekst)', () => {
    const { normalizeValue } = require('../../config/klubBackup');
    const d = new Date('2026-11-01T10:00:00Z');
    assert.equal(normalizeValue(d), d);
    assert.equal(normalizeValue('2026-11-01T10:00:00.000Z'), '2026-11-01 10:00:00');
    assert.equal(normalizeValue({ a: 1 }), '{"a":1}');
});

// ── 21c (2): opstarten opdager krypterede værdier, den ikke kan læse ──
test('21c: nøglekontrollen tæller ulæselige værdier i master og klubberne — og vælter ikke på fejl', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-jwt-opdigtet';
    const { krypter } = require('../../config/hemmelig');
    const masterDb = require('../../config/masterDatabase');
    const nk = require('../../config/noeglekontrol');
    const godt = krypter('x');
    const daarligt = godt.slice(0, -4) + (godt.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const orig = masterDb.query;
    const fejlLog = console.error, advLog = console.warn, okLog = console.log;
    const logget = [];
    console.error = console.warn = console.log = (...a) => logget.push(a.join(' '));
    masterDb.query = async (sql) => {
        if (/FROM indstillinger/.test(sql)) return [{ noegle: 'youtube_client_secret', vaerdi: godt }, { noegle: 'hetzner_token', vaerdi: daarligt }];
        if (/FROM clubs/.test(sql)) return [{ name: 'Klub A', subdomain: 'a', db_name: 'club_a' }, { name: 'Klub B', subdomain: 'b', db_name: 'club_b' }];
        throw new Error('uventet: ' + sql);
    };
    const forbind = async (db) => ({
        query: async () => {
            if (db === 'club_a') return [[{ refresh_token: daarligt }]];
            if (db === 'club_b') { const e = new Error('nede'); e.code = 'ECONNREFUSED'; throw e; }
            const e = new Error('ingen tabel'); e.code = 'ER_NO_SUCH_TABLE'; throw e;
        },
        end: async () => {},
    });
    try {
        const s = await nk.kontroller({ forbind });
        assert.equal(s.antal, 3);
        assert.deepEqual(s.ulaeselige, [nk.MASTER.hetzner_token, 'Klub A: YouTube-forbindelsen (klubbens admin → Livestream → forbind igen)']);
        assert.equal(s.fejl.length, 1);
        assert.match(s.fejl[0], /^club_b: nede/);
        assert.ok(logget.some(l => /KRYPTERINGSNØGLE: 2 af 3/.test(l)));
        assert.deepEqual(nk.status(), s);

        // Master nede: ingen undtagelse, fejlen står i status
        masterDb.query = async () => { throw new Error('master nede'); };
        const s2 = await nk.kontroller({ forbind });
        assert.ok(s2.fejl.some(f => /master nede/.test(f)));
    } finally {
        masterDb.query = orig;
        console.error = fejlLog; console.warn = advLog; console.log = okLog;
        nk._nulstil();
    }
});

test('21c: opstarten kører nøglekontrollen, helbredet viser den, og super-admin har et kort til den', () => {
    const server = laes('backend/server.js');
    const i = server.indexOf("require('./config/noeglekontrol').kontroller()");
    assert.ok(i > server.indexOf('runMigrationsForAllDatabases()') && i < server.indexOf('opstart.nuKlar()'));
    assert.match(server.slice(i, i + 200), /\.catch\(/);
    assert.match(laes('backend/config/hetzner.js'), /noegler: noeglekontrol\.status\(\)/);
    const sa = laes('frontend/super-admin-script.js');
    assert.match(sa, /const nk = l\.noegler;/);
    assert.match(sa, /shFlise\('Krypteringsnøgle'/);
    assert.match(laes('frontend/super-admin.html'), /super-admin-script\.js\?v=45/);
});
