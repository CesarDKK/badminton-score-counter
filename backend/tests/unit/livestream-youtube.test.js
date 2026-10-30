/**
 * Unit-tests af YouTube-delen af livestreamen: krypteringen af adgangen
 * (config/hemmelig.js), hvornår der oprettes/afsluttes udsendelser og deres
 * titler (screens/livestream.js), og Google-klienten (config/youtube.js) mod en
 * lille falsk Google-server på localhost.
 *
 * Kør: npm run test:unit
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-mindst-32-tegn-lang-xx';
const { krypter, dekrypter } = require('../../config/hemmelig');
const ls = require('../../screens/livestream');
const youtube = require('../../config/youtube');
const kvote = require('../../config/youtubeKvote');
kvote.nulstil({ gem: false });   // ingen database i testene

const NU = 1_800_000_000_000;
const MIN = 60 * 1000;

// ---------- Kryptering ----------

test('hemmelig: krypteret og tilbage igen — og null ved forkert nøgle eller ødelagt værdi', () => {
    const k = krypter('1//refresh-token');
    assert.notEqual(k, '1//refresh-token');
    assert.match(k, /^v1:/);
    assert.equal(dekrypter(k), '1//refresh-token');
    assert.notEqual(krypter('x'), krypter('x'));   // ny IV hver gang
    assert.equal(dekrypter('v1:xx:yy:zz'), null);
    assert.equal(dekrypter(null), null);
    const gammel = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'en-helt-anden-hemmelighed-mindst-32-tegn';
    try { assert.equal(dekrypter(k), null); } finally { process.env.JWT_SECRET = gammel; }
});

// ---------- Indstillinger og beslutning ----------

test('indstillinger: offentlig og lavet til børn som standard, kan ændres', () => {
    assert.equal(ls.laesIndstillinger(null).ytSynlighed, 'public');
    assert.equal(ls.laesIndstillinger(null).ytBoern, true);
    const i = ls.rensIndstillinger({ ytSynlighed: 'unlisted', ytBoern: false });
    assert.equal(i.ytSynlighed, 'unlisted');
    assert.equal(i.ytBoern, false);
    // Resten er uændret
    assert.equal(i.oploesning, 720);
    assert.ok(ls.rensIndstillinger({ ytSynlighed: 'alle' }).fejl);
    assert.ok(ls.rensIndstillinger({ ytBoern: 'ja' }).fejl);
    assert.equal(ls.laesIndstillinger('{"ytSynlighed":"x","ytBoern":"nej"}').ytSynlighed, 'public');
});

test('beslutning: med YouTube-kanalen forbundet behøver banen ingen indtastet nøgle', () => {
    const ops = { enabled: 1, stream_key: null, overlay: 1, all_day_until: new Date(NU + 60 * MIN) };
    assert.equal(ls.beslutning({ opsaetning: ops, nu: NU }).grund, 'mangler-noegle');
    assert.deepEqual(ls.beslutning({ opsaetning: ops, youtube: true, nu: NU }).send, true);
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, nu: NU }).kan, false);
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, youtube: true, nu: NU }).kan, true);
});

test('ytHandling: opret, tjek hvert 5. minut, afslut — og pause efter en fejl', () => {
    assert.equal(ls.ytHandling({ send: true, udsendelse: null, nu: NU }), 'opret');
    assert.equal(ls.ytHandling({ send: true, udsendelse: 'b1', tjek: new Date(NU - MIN), nu: NU }), null);
    assert.equal(ls.ytHandling({ send: true, udsendelse: 'b1', tjek: new Date(NU - 5 * MIN), nu: NU }), 'tjek');
    assert.equal(ls.ytHandling({ send: true, udsendelse: 'b1', tjek: null, nu: NU }), 'tjek');
    assert.equal(ls.ytHandling({ send: false, udsendelse: 'b1', nu: NU }), 'afslut');
    assert.equal(ls.ytHandling({ send: false, udsendelse: null, nu: NU }), null);
    // En fejl for lidt siden: vent, før der prøves igen
    assert.equal(ls.ytHandling({ send: true, udsendelse: null, fejlTid: new Date(NU - MIN), nu: NU }), null);
    assert.equal(ls.ytHandling({ send: true, udsendelse: null, fejlTid: new Date(NU - 3 * MIN), nu: NU }), 'opret');
    assert.equal(ls.ytHandling({ send: false, udsendelse: 'b1', fejlTid: new Date(NU - MIN), nu: NU }), null);
});

test('ytTitel: holdene, navnene eller klubben og banen — med dato og højst 100 tegn', () => {
    const dato = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short', year: 'numeric',
        timeZone: 'Europe/Copenhagen' }).format(NU);
    assert.equal(ls.ytTitel({ grund: 'holdkamp', bane: 3, hold: ['Lyngby 2', 'Gentofte 2'], navne: ['Ella / Bertram', 'Konrad / Yudan'], nu: NU }),
        `Lyngby 2 – Gentofte 2 (bane 3, ${dato})`);
    assert.equal(ls.ytTitel({ grund: 'valgt', bane: 1, navne: ['Hansen', 'Jensen'], nu: NU }), `Hansen – Jensen (bane 1, ${dato})`);
    assert.equal(ls.ytTitel({ grund: 'hele-dagen', bane: 2, navne: ['Hansen', 'Jensen'], klubnavn: 'Lyngby Badmintonklub', nu: NU }),
        `Lyngby Badmintonklub – Bane 2 (${dato})`);
    assert.equal(ls.ytTitel({ grund: 'valgt', bane: 2, nu: NU }), `Bane 2 (${dato})`);
    // YouTube afviser < og > i titler
    assert.doesNotMatch(ls.ytTitel({ grund: 'valgt', bane: 1, navne: ['<b>A', 'B>'], nu: NU }), /[<>]/);
    const lang = ls.ytTitel({ grund: 'holdkamp', bane: 1, hold: ['A'.repeat(80), 'B'.repeat(80)], nu: NU });
    assert.ok(lang.length <= 100);
    assert.match(ls.ytBeskrivelse('Lyngby'), /^Lyngby\. Sendt automatisk/);
});

// ---------- Google-klienten mod en falsk Google-server ----------

let server;
const kald = [];        // { metode, sti, query, body, auth }
let svar = {};          // sti -> (kald) => [status, json]

before(async () => {
    server = http.createServer((req, res) => {
        let data = '';
        req.on('data', (d) => { data += d; });
        req.on('end', () => {
            const u = new URL(req.url, 'http://x');
            const body = req.headers['content-type'] && req.headers['content-type'].includes('json')
                ? JSON.parse(data || '{}') : Object.fromEntries(new URLSearchParams(data));
            const k = { metode: req.method, sti: u.pathname, query: Object.fromEntries(u.searchParams), body,
                auth: req.headers.authorization || null };
            kald.push(k);
            const f = svar[`${req.method} ${u.pathname}`];
            const [status, json] = f ? f(k) : [404, { error: { code: 404, message: 'ukendt' } }];
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(status === 204 ? '' : JSON.stringify(json));
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    Object.assign(process.env, {
        YOUTUBE_CLIENT_ID: 'klient-id', YOUTUBE_CLIENT_SECRET: 'klient-hemmelighed',
        YOUTUBE_REDIRECT_URI: 'https://badmintonapp.dk/youtube/callback',
        YOUTUBE_AUTH_URL: `${base}/auth`, YOUTUBE_TOKEN_URL: `${base}/token`,
        YOUTUBE_REVOKE_URL: `${base}/revoke`, YOUTUBE_API_URL: `${base}/youtube/v3`
    });
});

after(() => server.close());

const nulstil = (s) => { kald.length = 0; svar = s; };

test('youtube: login-adressen beder om varig adgang til YouTube', () => {
    assert.equal(youtube.konfigureret(), true);
    const u = new URL(youtube.loginAdresse('STATE'));
    assert.equal(u.searchParams.get('client_id'), 'klient-id');
    assert.equal(u.searchParams.get('redirect_uri'), 'https://badmintonapp.dk/youtube/callback');
    assert.equal(u.searchParams.get('scope'), youtube.SCOPE);
    assert.equal(u.searchParams.get('access_type'), 'offline');
    assert.equal(u.searchParams.get('prompt'), 'consent');
    assert.equal(u.searchParams.get('state'), 'STATE');
});

test('youtube: koden byttes, og adgangstokenet huskes, til det næsten er udløbet', async () => {
    nulstil({
        'POST /token': (k) => k.body.grant_type === 'authorization_code'
            ? [200, { access_token: 'a1', refresh_token: 'r1', expires_in: 3599 }]
            : [200, { access_token: `a-${k.body.refresh_token}`, expires_in: 3599 }]
    });
    const t = await youtube.byttKode('KODE');
    assert.equal(t.refresh_token, 'r1');
    assert.equal(kald[0].body.code, 'KODE');
    assert.equal(kald[0].body.client_secret, 'klient-hemmelighed');
    assert.equal(kald[0].body.redirect_uri, 'https://badmintonapp.dk/youtube/callback');
    assert.equal(await youtube.adgangsToken('klub1', 'r1'), 'a-r1');
    assert.equal(await youtube.adgangsToken('klub1', 'r1'), 'a-r1');
    assert.equal(kald.length, 2);   // ét kald for koden, ét for adgangen — andet gang fra hukommelsen
    youtube.glemAdgang('klub1');
});

test('youtube: udløbet adgang og kendte fejl giver danske beskeder', async () => {
    nulstil({ 'POST /token': () => [400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }] });
    await assert.rejects(youtube.adgangsToken('klub2', 'gammel'), (e) =>
        e instanceof youtube.YoutubeFejl && e.grund === 'invalid_grant' && /forbind kanalen igen/.test(e.message));
    nulstil({ 'POST /youtube/v3/liveStreams': () => [403, { error: { code: 403, message: 'not enabled',
        errors: [{ reason: 'liveStreamingNotEnabled' }] } }] });
    await assert.rejects(youtube.opretStream('a', 'Bane 1'), /livestreaming slået til/);
});

test('youtube: stream, udsendelse koblet til streamen, og afslutning', async () => {
    nulstil({
        'GET /youtube/v3/channels': () => [200, { items: [{ id: 'UC1', snippet: { title: 'Lyngby Badminton' } }] }],
        'POST /youtube/v3/liveStreams': () => [200, { id: 's1', cdn: { ingestionInfo: {
            rtmpsIngestionAddress: 'rtmps://a.rtmps.youtube.com/live2', streamName: 'abcd-1234' } } }],
        'POST /youtube/v3/liveBroadcasts': () => [200, { id: 'b1' }],
        'POST /youtube/v3/liveBroadcasts/bind': () => [200, { id: 'b1' }],
        'GET /youtube/v3/liveBroadcasts': () => [200, { items: [{ id: 'b1', status: { lifeCycleStatus: 'live' } }] }],
        'POST /youtube/v3/liveBroadcasts/transition': () => [200, { id: 'b1' }]
    });
    assert.deepEqual(await youtube.kanal('a'), { id: 'UC1', navn: 'Lyngby Badminton' });
    assert.deepEqual(await youtube.opretStream('a', 'Badmintonapp – bane 1'),
        { id: 's1', url: 'rtmps://a.rtmps.youtube.com/live2', noegle: 'abcd-1234' });
    const s = kald.find(k => k.sti.endsWith('/liveStreams'));
    assert.equal(s.auth, 'Bearer a');
    assert.equal(s.body.contentDetails.isReusable, true);

    kald.length = 0;
    const id = await youtube.opretUdsendelse('a', { titel: 'Lyngby 2 – Gentofte 2', beskrivelse: 'x',
        synlighed: 'public', boern: true, streamId: 's1' });
    assert.equal(id, 'b1');
    const b = kald[0].body;
    assert.equal(b.snippet.title, 'Lyngby 2 – Gentofte 2');
    assert.equal(b.status.privacyStatus, 'public');
    assert.equal(b.status.selfDeclaredMadeForKids, true);
    assert.equal(b.contentDetails.enableAutoStart, true);
    assert.equal(b.contentDetails.enableAutoStop, true);
    assert.equal('enableEmbed' in b.contentDetails, false);
    assert.deepEqual([kald[1].sti, kald[1].query.id, kald[1].query.streamId], ['/youtube/v3/liveBroadcasts/bind', 'b1', 's1']);

    kald.length = 0;
    assert.equal(await youtube.afslut('a', 'b1'), 'afsluttet');
    assert.equal(kald[1].query.broadcastStatus, 'complete');
});

test('youtube: en udsendelse, der aldrig kom i gang, slettes — og en fejlet kobling rydder op', async () => {
    nulstil({
        'GET /youtube/v3/liveBroadcasts': () => [200, { items: [{ id: 'b2', status: { lifeCycleStatus: 'ready' } }] }],
        'DELETE /youtube/v3/liveBroadcasts': () => [204, null],
        'POST /youtube/v3/liveBroadcasts': () => [200, { id: 'b3' }],
        'POST /youtube/v3/liveBroadcasts/bind': () => [404, { error: { code: 404, message: 'Stream not found',
            errors: [{ reason: 'liveStreamNotFound' }] } }]
    });
    assert.equal(await youtube.afslut('a', 'b2'), 'slettet');
    assert.equal(kald.at(-1).metode, 'DELETE');
    kald.length = 0;
    await assert.rejects(youtube.opretUdsendelse('a', { titel: 't', beskrivelse: '', synlighed: 'public', boern: true, streamId: 'væk' }),
        (e) => e.status === 404 && e.grund === 'liveStreamNotFound');
    assert.deepEqual(kald.map(k => `${k.metode} ${k.sti.split('/').pop()}`),
        ['POST liveBroadcasts', 'POST bind', 'DELETE liveBroadcasts']);
});

test('youtube: nøgler fra super-admin bruges, når .env ingen har — .env går forud', () => {
    const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret } = process.env;
    try {
        delete process.env.YOUTUBE_CLIENT_ID;
        delete process.env.YOUTUBE_CLIENT_SECRET;
        youtube.brugKlient(null, null);
        assert.equal(youtube.konfigureret(), false);
        youtube.brugKlient('gemt.apps.googleusercontent.com', 'gemt-hemmelighed');
        assert.deepEqual(youtube.klient(), { id: 'gemt.apps.googleusercontent.com', secret: 'gemt-hemmelighed', kilde: 'admin' });
        assert.equal(new URL(youtube.loginAdresse('S')).searchParams.get('client_id'), 'gemt.apps.googleusercontent.com');
        Object.assign(process.env, { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret });
        assert.equal(youtube.klient().kilde, 'env');
        assert.equal(youtube.klient().id, 'klient-id');
    } finally {
        Object.assign(process.env, { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret });
        youtube.brugKlient(null, null);
    }
});

test('youtube: tjekKlient — klienten findes (invalid_grant), ukendt ID eller forkert secret (invalid_client)', async () => {
    nulstil({ 'POST /token': (k) => k.body.client_id !== 'x.apps.googleusercontent.com'
        ? [401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' }]
        : k.body.client_secret === 'rigtig'
            ? [400, { error: 'invalid_grant', error_description: 'Malformed auth code.' }]
            : [401, { error: 'invalid_client', error_description: 'The provided client secret is invalid.' }] });
    assert.equal(await youtube.tjekKlient('x.apps.googleusercontent.com', 'rigtig'), 'ok');
    assert.equal(await youtube.tjekKlient('x.apps.googleusercontent.com', 'forkert'), 'forkert-secret');
    assert.equal(await youtube.tjekKlient('y.apps.googleusercontent.com', 'rigtig'), 'ukendt-id');
    assert.equal(kald[0].body.grant_type, 'authorization_code');
    assert.equal(kald[0].body.redirect_uri, 'https://badmintonapp.dk/youtube/callback');
});

// ---------- Dagskvoten (config/youtubeKvote.js) ----------

test('kvote: opslag koster 1, oprettelse 50, login intet — og "kvoten er brugt op" markeres', async () => {
    kvote.nulstil({ gem: false });
    nulstil({
        'GET /youtube/v3/channels': () => [200, { items: [{ id: 'UC1', snippet: { title: 'Kanal' } }] }],
        'POST /youtube/v3/liveStreams': () => [403, { error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }]
    });
    await youtube.kanal('a');
    await youtube.kanal('a');
    let s = kvote.status();
    assert.deepEqual([s.enheder, s.kald, s.opbrugt, s.graense], [2, 2, null, 10000]);
    await assert.rejects(youtube.opretStream('a', 'Bane 1'));
    s = kvote.status();
    assert.equal(s.enheder, 2);               // et afvist kald koster intet
    assert.ok(s.opbrugt);
    // En almindelig fejl (fx en udsendelse, der ikke findes) koster stadig
    nulstil({ 'POST /youtube/v3/liveStreams': () => [404, { error: { code: 404, message: 'x', errors: [{ reason: 'notFound' }] } }] });
    await assert.rejects(youtube.opretStream('a', 'Bane 1'));
    assert.equal(kvote.status().enheder, 52);
    kvote.saetGraense(50000);
    assert.equal(kvote.status().graense, 50000);
    kvote.nulstil({ gem: false });
});

test('kvote: Googles døgn går fra midnat Pacific-tid — også over sommertidsskiftet', () => {
    // 30. okt. 2026 kl. 10 UTC = kl. 3 i Californien (sommertid, UTC-7)
    assert.equal(kvote.googleDag(Date.UTC(2026, 9, 30, 10)), '2026-10-30');
    assert.equal(new Date(kvote.nulstilles(Date.UTC(2026, 9, 30, 10))).toISOString(), '2026-10-31T07:00:00.000Z');
    assert.equal(kvote.googleDag(Date.UTC(2026, 9, 30, 6, 59)), '2026-10-29');
    // 1. nov. 2026 skifter USA til vintertid (UTC-8): næste midnat er kl. 8 UTC
    assert.equal(new Date(kvote.nulstilles(Date.UTC(2026, 10, 1, 12))).toISOString(), '2026-11-02T08:00:00.000Z');
    // Tallene pr. dag: i går står i historikken, i dag starter forfra
    kvote.nulstil({ gem: false });
    kvote.tael(50, { nu: Date.UTC(2026, 9, 29, 20) });
    kvote.tael(1, { nu: Date.UTC(2026, 9, 30, 10) });
    const s = kvote.status(Date.UTC(2026, 9, 30, 12));
    assert.equal(s.enheder, 1);
    assert.deepEqual(s.historik, [{ dag: '2026-10-29', enheder: 50, opbrugt: false }]);
    // Kun de seneste 14 dage gemmes
    for (let d = 0; d < 20; d++) kvote.tael(1, { nu: Date.UTC(2026, 10, 1 + d, 20) });
    assert.equal(kvote.status(Date.UTC(2026, 10, 20, 20)).historik.length, 7);
    kvote.nulstil({ gem: false });
});
