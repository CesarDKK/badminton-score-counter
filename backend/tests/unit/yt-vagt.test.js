/**
 * Vagten over YouTube-udsendelserne (Lyngby 2026-11-14: holdkampen på bane 3
 * blev til fem videoer, fordi YouTube selv lukkede udsendelsen ved hvert udfald
 * på over et minut, og serveren så oprettede en ny). Nu lukker YouTube ikke selv
 * (config/youtube.js, enableAutoStop: false — testet i livestream-youtube.test.js);
 * i stedet afslutter serveren (routes/livestream.js ytVagt, scheduler
 * startYoutubeVagt) udsendelsen, når PC'en har været tavs i 10 minutter, eller
 * banen ikke skal sende mere — så en død PC ikke efterlader en udsendelse åben
 * hele natten.
 *
 * Ingen database og ingen Google: config/database.js og config/youtube.js
 * erstattes af falske, før ruten indlæses.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-yt-vagt-mindst-32-tegn';
process.env.YOUTUBE_DIREKTE = '1';   // vagten kører i direct mode i testen
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('os').tmpdir();   // ruten indlæser multer, som laver mappen

const { krypter } = require('../../config/hemmelig');
const ls = require('../../screens/livestream');

// ---------- Falsk database ----------
const db = require('../../config/database');
let rows = {};          // nøgle (del af SQL) -> rækker
let kald = [];
db.query = async (sql, params) => {
    kald.push({ sql, params });
    for (const [del, r] of Object.entries(rows)) {
        if (sql.includes(del)) return typeof r === 'function' ? r(params) : r;
    }
    return [];
};
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };

// ---------- Falsk YouTube-klient ----------
const youtube = require('../../config/youtube');
let ytKald = [];
let ytStatus = 'live';
youtube.konfigureret = () => true;
youtube.adgangsToken = async () => 'token';
youtube.udsendelsesStatus = async (token, id) => { ytKald.push({ hvad: 'status', id }); return ytStatus; };
youtube.afslut = async (token, id) => { ytKald.push({ hvad: 'afslut', id }); return 'afsluttet'; };

const { ytVagt } = require('../../routes/livestream');

const NU = 1_800_000_000_000;
const MIN = 60 * 1000;
const TENANT = 'direct';

function opsaet({ udsendelse = 'b1', fejlTid = null, tjek = null, holdkamp = true, enabled = true } = {}) {
    rows = {
        'FROM court_streams WHERE yt_broadcast_id IS NOT NULL': [{ court_number: 3 }],
        'FROM livestream_youtube': [{ id: 1, refresh_token: krypter('r'), fejl: null, kanal_navn: 'Klubben' }],
        "setting_key = 'livestream'": [],
        'FROM courts WHERE court_number': [{ id: 33, is_doubles: 0 }],
        'FROM court_streams WHERE court_number': [{ court_number: 3, enabled: enabled ? 1 : 0, stream_key: null,
            yt_stream_key: 'k', yt_broadcast_id: udsendelse, yt_broadcast_tjek: tjek, yt_fejl_tid: fejlTid,
            armed_until: null, manual_since: null, all_day_until: null, holdkamp_stop_until: null }],
        'FROM game_states WHERE court_id': [],
        'FROM last_finished_matches': [],
        'FROM planner_court_assignments': [],
        // Holdkampen kører: delkampe tilbage, en startede for lidt siden (i dag)
        'FROM team_matches tm': holdkamp
            ? [{ mangler: 2, igang: 1, slut: null, start: new Date(NU - 5 * MIN), roert: new Date(NU - MIN) }]
            : [{ mangler: 0, igang: 0, slut: new Date(NU - 30 * MIN), start: new Date(NU - 60 * MIN), roert: null }]
    };
    kald = [];
    ytKald = [];
    ls._nulstilStatus && ls._nulstilStatus();
}

// PC'en på bane 3 meldte sig for så længe siden
function pcMeldte(sidenMs, { sender = true } = {}) {
    ls.registrer(TENANT, 'tok3', { navn: 'TV3', kamera: 'C920', sender, bane: 3, grund: 'holdkamp', skalSende: true, tavle: null },
        '10.0.0.3', NU - sidenMs);
}

test('ytVagtGrund: tavs PC i 10 min eller "send ikke" — ellers lader vagten udsendelsen køre', () => {
    assert.equal(ls.ytVagtGrund({ send: true, pcSidst: NU - 9 * MIN, nu: NU }), null);
    assert.equal(ls.ytVagtGrund({ send: true, pcSidst: NU - 10 * MIN, nu: NU }), 'pc-tavs');
    assert.equal(ls.ytVagtGrund({ send: true, pcSidst: null, nu: NU }), 'pc-tavs');
    assert.equal(ls.ytVagtGrund({ send: false, grund: 'afsluttet', pcSidst: NU, nu: NU }), 'afsluttet');
    assert.equal(ls.ytVagtGrund({ send: false, pcSidst: NU, nu: NU }), 'send-ikke');
    assert.equal(ls.YT_PC_TAVS_MS, 10 * MIN);
});

test('pcSidstPaaBane: den seneste PC på banen — null uden PC', () => {
    ls.registrer('t', 'a', { bane: 3, sender: true }, '1.1.1.1', NU - 3 * MIN);
    ls.registrer('t', 'b', { bane: 3, sender: false }, '1.1.1.2', NU - MIN);
    ls.registrer('t', 'c', { bane: 4, sender: true }, '1.1.1.3', NU);
    assert.equal(ls.pcSidstPaaBane('t', 3), NU - MIN);
    assert.equal(ls.pcSidstPaaBane('t', 4), NU);
    assert.equal(ls.pcSidstPaaBane('t', 5), null);
});

test("vagten: PC'en spurgte for 2 min siden og holdkampen kører — udsendelsen rører den ikke", async () => {
    opsaet();
    pcMeldte(2 * MIN);
    assert.deepEqual(await ytVagt(NU), []);
    assert.equal(ytKald.length, 0);
});

test("vagten: PC'en tavs i 10 min — udsendelsen afsluttes på YouTube og glemmes (kun én gang)", async () => {
    opsaet();
    pcMeldte(10 * MIN);
    assert.deepEqual(await ytVagt(NU), [{ bane: 3, grund: 'pc-tavs' }]);
    assert.deepEqual(ytKald.map(k => k.hvad), ['afslut']);
    const glemt = kald.find(k => /UPDATE court_streams SET yt_broadcast_id = NULL/.test(k.sql));
    assert.ok(glemt, 'yt_broadcast_id ryddes, så der ikke afsluttes igen og igen');
    assert.deepEqual(glemt.params, [3]);
});

test('vagten: efter en genstart af backenden tæller udsendelsens seneste tjek som livstegn', async () => {
    // Ingen PC-status i hukommelsen, men udsendelsen blev tjekket for 4 min siden (PC'en spurgte)
    opsaet({ tjek: new Date(NU - 4 * MIN) });
    assert.deepEqual(await ytVagt(NU), []);
    // … og 10 min efter det seneste tjek lukkes der
    opsaet({ tjek: new Date(NU - 10 * MIN) });
    assert.deepEqual(await ytVagt(NU), [{ bane: 3, grund: 'pc-tavs' }]);
});

test("vagten: holdkampen er slut — udsendelsen afsluttes med beslutningens grund, også med PC'en i live", async () => {
    opsaet({ holdkamp: false });
    pcMeldte(5 * 1000);
    const ud = await ytVagt(NU);
    assert.equal(ud.length, 1);
    assert.equal(ud[0].bane, 3);
    assert.notEqual(ud[0].grund, 'pc-tavs');
    assert.deepEqual(ytKald.map(k => k.hvad), ['afslut']);
});

test('vagten: i pausen efter en YouTube-fejl kaldes YouTube ikke — der prøves næste minut', async () => {
    opsaet({ fejlTid: new Date(NU - MIN) });
    pcMeldte(15 * MIN);
    assert.deepEqual(await ytVagt(NU), [{ bane: 3, grund: 'pc-tavs' }]);   // besluttet …
    assert.equal(ytKald.length, 0);                                       // … men ikke kaldt endnu
});

test('vagten: ingen åbne udsendelser — kun én forespørgsel', async () => {
    opsaet();
    rows['FROM court_streams WHERE yt_broadcast_id IS NOT NULL'] = [];
    assert.deepEqual(await ytVagt(NU), []);
    assert.equal(kald.length, 1);
});
