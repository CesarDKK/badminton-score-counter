/**
 * Pakke O — Jespers beslutninger i nr. 12–14 (gennemgangen nov. 2026):
 *   12B  bekræftelse på tabletten før "Start livestream"
 *   12C  appens egne udsendelser bliver "kun med linket" efter 60 dage
 *   13   spillerlisten (player-info) kræver admin
 *   14A  TV- og oversigt-links kan kun læse (plus skærmens egne ruter)
 * (12A — titlen uden spillernavne — står i livestream-youtube.test.js.)
 *
 * Ingen database og ingen Google: config/database.js og config/youtube.js
 * erstattes af falske, før ruterne indlæses. Frontend-funktioner hentes ud af
 * kildefilerne og køres i en vm-sandkasse.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-pakke-o-mindst-32-tegn';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('os').tmpdir();   // routes/livestream.js indlæser multer

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

function udsnit(kilde, fra, til) {
    const a = kilde.indexOf(fra);
    assert.ok(a >= 0, `markøren findes: ${fra}`);
    const b = kilde.indexOf(til, a + fra.length);
    assert.ok(b > a, `slutmarkøren findes: ${til}`);
    return kilde.slice(a, b);
}

process.env.YOUTUBE_DIREKTE = '1';   // YouTube-jobbet kører i direct mode i testen

const ls = require('../../screens/livestream');
const { krypter } = require('../../config/hemmelig');

// ---------- Falsk database (før ruterne indlæses — de destrukturerer query) ----------
const db = require('../../config/database');
let dbSvar = async () => [];
let dbKald = [];
db.query = async (sql, params) => { dbKald.push({ sql, params }); return dbSvar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };

// ---------- Falsk YouTube-klient (de ægte funktioner gemmes til egne tests) ----------
const youtube = require('../../config/youtube');
const aegte = { saetSynlighed: youtube.saetSynlighed, afsluttedeUdsendelser: youtube.afsluttedeUdsendelser, videoStatus: youtube.videoStatus };
let yt = {};          // svarene fra den falske YouTube
let ytKald = [];
youtube.konfigureret = () => true;
youtube.adgangsToken = async () => 'token';
youtube.afsluttedeUdsendelser = async (token, side) => { ytKald.push(`liste:${side || 'første'}`); return yt.sider[side || 'første']; };
youtube.videoStatus = async (token, ids) => { ytKald.push(`status:${ids.join(',')}`); return new Map(ids.filter(id => yt.status[id]).map(id => [id, yt.status[id]])); };
youtube.saetSynlighed = async (token, id, status, privacy) => {
    ytKald.push(`saet:${id}:${privacy}`);
    if (yt.fejl && yt.fejl[id]) throw yt.fejl[id];
};
const youtubeKvote = require('../../config/youtubeKvote');

const livestream = require('../../routes/livestream');

// ======================= 12B: bekræftelse før "Start livestream" =======================

function tabletSandkasse(l) {
    const kilde = laes('frontend/court-script-v3.js');
    const fn = udsnit(kilde, '// Bekræftelsen før "Start livestream"', 'function swapPlayers(team)');
    const sb = {
        dialoger: [], kald: [], menu: 0, courtId: 3,
        showMessage(titel, tekst, knapper, opt) { sb.dialoger.push({ titel, tekst, knapper, opt }); },
        closeSettingsMenu() { sb.menu++; },
        api: { request: async (sti, o) => { sb.kald.push(`${o.method} ${sti}`); await new Promise(r => setTimeout(r, 5)); return { start: 'klar', efterMin: 2 }; } }
    };
    vm.createContext(sb);
    vm.runInContext('let livestream = null; const livestreamStopTekst = () => "2 minutter efter kampen er afgjort";\n' + fn +
        '\nthis.livestreamKnap = livestreamKnap; this.livestreamBekraeftTekst = livestreamBekraeftTekst; ' +
        'this.saet = (v) => { livestream = v; };', sb);
    sb.saet(l);
    return sb;
}

test('12B: teksten følger klubbens synlighed — "offentlig", når den er public eller ukendt (indtastet nøgle)', () => {
    const sb = tabletSandkasse(null);
    const slut = ' og bliver liggende. Spillerne skal være indforstået.';
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: 'public' }), 'Udsendelsen er offentlig på klubbens YouTube-kanal' + slut);
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: null }), 'Udsendelsen er offentlig på klubbens YouTube-kanal' + slut);
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: 'unlisted' }), 'Udsendelsen lægges på klubbens YouTube-kanal (kun med linket)' + slut);
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: 'private' }), 'Udsendelsen lægges på klubbens YouTube-kanal (privat)' + slut);
});

test('12B: "Start livestream" spørger først (hver gang); Fortryd starter intet, og knapperne er spærret et øjeblik', async () => {
    const sb = tabletSandkasse({ kan: true, start: null, synlighed: 'unlisted' });
    await sb.livestreamKnap();
    assert.equal(sb.kald.length, 0, 'intet startes, før der svares');
    assert.equal(sb.dialoger.length, 1);
    const d = sb.dialoger[0];
    assert.equal(d.titel, 'Start livestream?');
    assert.match(d.tekst, /kun med linket/);
    assert.deepEqual([...d.knapper.map(k => k.text)], ['Start livestream', 'Fortryd']);
    assert.equal(d.knapper[1].callback, null, 'Fortryd lukker bare dialogen');
    assert.ok(d.opt && d.opt.spaerMs >= 500, 'dobbelttryk-værn: knapperne virker først efter et øjeblik');
    // Ja: ét kald, også ved dobbelttryk på knappen
    const a = d.knapper[0].callback();
    const b = d.knapper[0].callback();
    await Promise.all([a, b]);
    assert.deepEqual(sb.kald, ['POST /livestream/bane/3/start']);
    assert.equal(sb.dialoger[1].titel, 'Livestream startet');
    // Næste gang spørges der igen (intet "husk mit valg")
    sb.saet({ kan: true, start: null, synlighed: 'public' });
    await sb.livestreamKnap();
    assert.equal(sb.dialoger[2].titel, 'Start livestream?');
    assert.equal(sb.kald.length, 1);
});

// Før spurgte stop ikke (12B). Nu slettes det sendte på YouTube, når en kamp
// stoppes undervejs (migration 056, Jesper 2026-11-21) — så spørges der først.
// "Fortryd" for en kamp, der venter (klar), er intet sendt og spørger ikke.
test('12B/056: stop af en kamp, der sendes, spørger først — fortryd af en ventende gør ikke', async () => {
    const sb = tabletSandkasse({ kan: true, start: 'valgt' });
    await sb.livestreamKnap();
    assert.equal(sb.kald.length, 0, 'intet stoppes, før der svares');
    const d = sb.dialoger[0];
    assert.equal(d.titel, 'Stop livestream?');
    assert.match(d.tekst, /slettes på YouTube — medmindre kampen er afgjort/);
    assert.deepEqual([...d.knapper.map(k => k.text)], ['Stop livestream', 'Fortsæt livestream']);
    assert.equal(d.knapper[1].callback, null);
    await d.knapper[0].callback();
    assert.deepEqual(sb.kald, ['POST /livestream/bane/3/stop']);
    assert.equal(sb.dialoger[1].titel, 'Livestream stoppet');
    const klar = tabletSandkasse({ kan: true, start: 'klar' });
    await klar.livestreamKnap();
    assert.deepEqual(klar.kald, ['POST /livestream/bane/3/stop']);
});

test('12B: showMessage spærrer knapperne med spaerMs; tabletStatus giver synligheden kun med forbundet kanal', () => {
    const kilde = laes('frontend/court-script-v3.js');
    assert.match(udsnit(kilde, 'function showMessage(', 'function hideMessage()'), /options\.spaerMs > 0[\s\S]*btn\.disabled = true/);
    const ops = { enabled: 1, stream_key: 'k' };
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, youtube: true, ytSynlighed: 'unlisted' }).synlighed, 'unlisted');
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, youtube: false, ytSynlighed: 'unlisted' }).synlighed, null);
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, youtube: true, ytSynlighed: 'noget' }).synlighed, null);
    // Mindst v69 (pakke O) — senere pakker hæver den
    assert.ok(Number(/court-script-v3\.js\?v=(\d+)/.exec(laes('frontend/court-v3.html'))[1]) >= 69);
});

// ======================= 12C: "kun med linket" efter 60 dage =======================

// Klubbens database i testen: kanalen forbundet, yt_udsendelser som en liste
// (alder i dage — SQL'ens INTERVAL efterlignes), settings som et objekt
function ytDb({ udsendelser = [], backfillGjort = false } = {}) {
    const d = { udsendelser: udsendelser.map(u => ({ synlighed_sat_at: null, resultat: null, ...u })), settings: {} };
    if (backfillGjort) d.settings.yt_udsendelser_backfill = '2026-11-01T00:00:00.000Z';
    dbKald = [];
    dbSvar = async (sql, p) => {
        if (sql.includes('FROM livestream_youtube')) return [{ id: 1, refresh_token: krypter('r'), fejl: null }];
        if (sql.includes('SELECT setting_value FROM settings WHERE setting_key = ?')) {
            return d.settings[p[0]] ? [{ setting_value: d.settings[p[0]] }] : [];
        }
        if (sql.includes('INSERT INTO settings')) { d.settings[p[0]] = p[1]; return { affectedRows: 1 }; }
        if (sql.includes('INSERT IGNORE INTO yt_udsendelser')) {
            if (!d.udsendelser.find(u => u.broadcast_id === p[0])) {
                d.udsendelser.push({ broadcast_id: p[0], titel: p[1], oprettet: p[2], alder: null, synlighed_sat_at: null, resultat: null });
            }
            return { affectedRows: 1 };
        }
        if (sql.includes('SELECT broadcast_id FROM yt_udsendelser')) {
            assert.match(sql, /synlighed_sat_at IS NULL AND oprettet < UTC_TIMESTAMP\(\) - INTERVAL 60 DAY/);
            const max = Number(/LIMIT (\d+)/.exec(sql)[1]);
            assert.equal(max, 20);
            return d.udsendelser.filter(u => u.synlighed_sat_at === null && u.alder > 60).slice(0, max);
        }
        if (sql.includes('UPDATE yt_udsendelser SET synlighed_sat_at')) {
            const u = d.udsendelser.find(x => x.broadcast_id === p[1]);
            u.synlighed_sat_at = 'nu';
            u.resultat = p[0];
            return { affectedRows: 1 };
        }
        return [];
    };
    ytKald = [];
    youtubeKvote.nulstil({ gem: false });
    livestream._ytPauseTil.clear();
    return d;
}

const offentlig = { privacyStatus: 'public', embeddable: true, license: 'youtube', publicStatsViewable: true, selfDeclaredMadeForKids: true };

test('12C: appens kendetegn står i hver beskrivelse; 60 dage, højst 20 pr. nat; kun offentlige videoer røres', () => {
    assert.equal(ls.YT_SYNLIG_DAGE, 60);
    assert.equal(ls.YT_SYNLIG_MAKS, 20);
    assert.ok(ls.erAppensUdsendelse(ls.ytBeskrivelse('Lyngby')));
    assert.ok(ls.erAppensUdsendelse(ls.ytBeskrivelse()));
    assert.equal(ls.erAppensUdsendelse('Klubbens egen video fra generalforsamlingen'), false);
    assert.equal(ls.erAppensUdsendelse(null), false);
    assert.deepEqual(ls.ytSynligHandling(offentlig), { saet: true });
    assert.deepEqual(ls.ytSynligHandling({ privacyStatus: 'unlisted' }), { resultat: 'allerede unlisted' });
    assert.deepEqual(ls.ytSynligHandling({ privacyStatus: 'private' }), { resultat: 'allerede private' });
    assert.deepEqual(ls.ytSynligHandling(undefined), { resultat: 'findes ikke' });
    // Kvoten, adgangen eller YouTube nede stopper natten; en enkelt videos fejl gør ikke
    const fejl = (status, grund) => new youtube.YoutubeFejl('x', { status, grund });
    assert.equal(ls.ytSynligFejlStopper(fejl(403, 'quotaExceeded')), true);
    assert.equal(ls.ytSynligFejlStopper(fejl(0, '')), true);
    assert.equal(ls.ytSynligFejlStopper(fejl(503, 'backendError')), true);
    assert.equal(ls.ytSynligFejlStopper(fejl(401, 'authError')), true);
    assert.equal(ls.ytSynligFejlStopper(fejl(404, 'videoNotFound')), false);
    assert.equal(ls.ytSynligFejlStopper(fejl(403, 'forbidden')), false);
    assert.equal(ls.ytSynligFejlStopper(fejl(400, 'invalidVideoMetadata')), false);
});

test('12C: ældre udsendelser findes én gang via kendetegnet — klubbens andre videoer kommer ikke med', async () => {
    const d = ytDb();
    yt = { sider: {
        'første': { items: [
            { id: 'gammel1', titel: 'Bane 1', beskrivelse: ls.ytBeskrivelse('Lyngby'), start: '2026-08-01T10:00:00Z' },
            { id: 'egen', titel: 'Generalforsamling', beskrivelse: 'Klubbens egen video', start: '2026-08-02T10:00:00Z' }
        ], naeste: 's2' },
        s2: { items: [{ id: 'gammel2', titel: 'Bane 2', beskrivelse: ls.ytBeskrivelse(), start: '2026-07-01T10:00:00Z' }], naeste: null }
    }, status: {} };
    const ud = await livestream.ytSynlighedJob();
    assert.equal(ud.backfill, 2);
    assert.deepEqual(d.udsendelser.map(u => [u.broadcast_id, u.oprettet]),
        [['gammel1', '2026-08-01 10:00:00'], ['gammel2', '2026-07-01 10:00:00']]);
    assert.ok(d.settings.yt_udsendelser_backfill, 'gjort — ikke igen');
    assert.deepEqual(ytKald, ['liste:første', 'liste:s2']);
    // Næste nat: ingen liste-kald
    ytKald = [];
    await livestream.ytSynlighedJob();
    assert.deepEqual(ytKald, []);
});

test('12C: over 60 dage og offentlig → "kun med linket"; allerede ikke-offentlig, væk og afvist noteres', async () => {
    const d = ytDb({ backfillGjort: true, udsendelser: [
        { broadcast_id: 'pub', alder: 61 }, { broadcast_id: 'ul', alder: 90 }, { broadcast_id: 'priv', alder: 70 },
        { broadcast_id: 'vaek', alder: 65 }, { broadcast_id: 'ung', alder: 59 }, { broadcast_id: 'afvist', alder: 80 }
    ] });
    yt = { sider: {}, status: { pub: offentlig, ul: { privacyStatus: 'unlisted' }, priv: { privacyStatus: 'private' }, ung: offentlig, afvist: offentlig },
        fejl: { afvist: new youtube.YoutubeFejl('YouTube svarede 403: forbidden', { status: 403, grund: 'forbidden' }) } };
    const ud = await livestream.ytSynlighedJob();
    assert.deepEqual(ytKald, ['status:pub,ul,priv,vaek,afvist', 'saet:pub:unlisted', 'saet:afvist:unlisted']);
    assert.deepEqual({ unlisted: ud.unlisted, uaendret: ud.uaendret, fejl: ud.fejl, stoppet: ud.stoppet },
        { unlisted: 1, uaendret: 3, fejl: 1, stoppet: null });
    const res = Object.fromEntries(d.udsendelser.map(u => [u.broadcast_id, u.resultat]));
    assert.deepEqual(res, { pub: 'kun med linket', ul: 'allerede unlisted', priv: 'allerede private', vaek: 'findes ikke',
        ung: null, afvist: 'fejl: YouTube svarede 403: forbidden' });
    assert.equal(d.udsendelser.find(u => u.broadcast_id === 'ung').synlighed_sat_at, null, 'under 60 dage: ikke rørt');
    // Næste nat: alt er noteret — kun den unge venter
    ytKald = [];
    await livestream.ytSynlighedJob();
    assert.deepEqual(ytKald, []);
});

test('12C: kvoten brugt op midt i natten — ingen video noteres, og der stoppes', async () => {
    const d = ytDb({ backfillGjort: true, udsendelser: [{ broadcast_id: 'a', alder: 61 }, { broadcast_id: 'b', alder: 62 }] });
    yt = { sider: {}, status: { a: offentlig, b: offentlig },
        fejl: { a: new youtube.YoutubeFejl('kvoten', { status: 403, grund: 'quotaExceeded' }) } };
    const ud = await livestream.ytSynlighedJob();
    assert.equal(ud.stoppet, 'kvoten');
    assert.deepEqual(ytKald, ['status:a,b', 'saet:a:unlisted']);
    assert.ok(d.udsendelser.every(u => u.synlighed_sat_at === null), 'prøves igen næste nat');
});

test('12C: jobbet kalder ikke YouTube over 80 % af dagens kvote, under en banes fejlpause eller uden forbundet kanal', async () => {
    ytDb({ backfillGjort: true, udsendelser: [{ broadcast_id: 'a', alder: 61 }] });
    yt = { sider: {}, status: { a: offentlig } };
    youtubeKvote.tael(8000);
    assert.equal((await livestream.ytSynlighedJob()).sprunget, 'kvote');
    assert.deepEqual(ytKald, []);

    ytDb({ backfillGjort: true, udsendelser: [{ broadcast_id: 'a', alder: 61 }] });
    youtubeKvote.tael(7960);    // plads til listen, ikke til en opdatering à 50
    assert.equal((await livestream.ytSynlighedJob()).sprunget, 'kvote');
    assert.deepEqual(ytKald, ['status:a']);

    ytDb({ backfillGjort: true, udsendelser: [{ broadcast_id: 'a', alder: 61 }] });
    livestream._ytPauseTil.set('direct:3', Date.now() + 60000);
    assert.equal((await livestream.ytSynlighedJob()).sprunget, 'fejlpause');
    assert.deepEqual(ytKald, []);

    ytDb({ backfillGjort: true, udsendelser: [{ broadcast_id: 'a', alder: 61 }] });
    const f = dbSvar;
    dbSvar = async (sql, p) => sql.includes('FROM livestream_youtube') ? [] : f(sql, p);
    assert.equal(await livestream.ytSynlighedJob(), null);
    assert.deepEqual(ytKald, []);
});

test('12C: udsendelsen huskes, når serveren opretter den; natjobbet planlægges kl. 03:40', () => {
    const kilde = laes('backend/routes/livestream.js');
    assert.match(kilde, /youtube\.opretUdsendelse\([\s\S]{0,200}\n\s*await ytHuskUdsendelse\(req, bane, id, titel\);/);
    assert.match(kilde, /INSERT IGNORE INTO yt_udsendelser \(broadcast_id, bane, titel, oprettet\)/);
    assert.match(laes('backend/scheduler.js'), /cron\.schedule\('40 3 \* \* \*', youtubeSynlighed/);
    assert.match(laes('backend/server.js'), /startYoutubeSynlighed\(\);/);
    assert.match(laes('backend/migrations/050_yt_udsendelser.sql'), /CREATE TABLE IF NOT EXISTS yt_udsendelser/);
    assert.match(laes('frontend/admin-script.js'), /Udsendelser bliver automatisk "kun med linket" efter 60 dage\./);
});

test('12C: Google-kaldene — videos.update sender de skrivbare status-felter videre, listen filtrerer på kanalen', async () => {
    const gem = global.fetch;
    const kald = [];
    global.fetch = async (url, o) => {
        const u = new URL(url);
        kald.push({ url: u, metode: o.method, body: o.body ? JSON.parse(o.body) : null });
        const json = u.pathname.endsWith('/videos') && o.method === 'GET'
            ? { items: [{ id: 'v1', status: offentlig }] }
            : u.pathname.endsWith('/liveBroadcasts')
                ? { items: [{ id: 'b1', snippet: { title: 'T', description: 'D', actualStartTime: '2026-08-01T10:00:00Z' } }], nextPageToken: 'n' }
                : { id: 'v1' };
        return { status: 200, ok: true, json: async () => json };
    };
    try {
        youtubeKvote.nulstil({ gem: false });
        await aegte.saetSynlighed('tok', 'v1', { ...offentlig, uploadStatus: 'processed', madeForKids: true }, 'unlisted');
        assert.equal(kald[0].metode, 'PUT');
        assert.equal(kald[0].url.searchParams.get('part'), 'status');
        assert.deepEqual(kald[0].body, { id: 'v1', status: { privacyStatus: 'unlisted', embeddable: true, license: 'youtube',
            publicStatsViewable: true, selfDeclaredMadeForKids: true } });
        assert.equal(youtubeKvote.status().enheder, 50);

        const st = await aegte.videoStatus('tok', ['v1', 'v2']);
        assert.equal(kald[1].url.searchParams.get('id'), 'v1,v2');
        assert.equal(st.get('v1').privacyStatus, 'public');
        assert.equal(st.has('v2'), false);

        const side = await aegte.afsluttedeUdsendelser('tok', null);
        assert.equal(kald[2].url.searchParams.get('broadcastStatus'), 'completed');
        assert.equal(kald[2].url.searchParams.has('mine'), false);
        assert.deepEqual(side, { items: [{ id: 'b1', titel: 'T', beskrivelse: 'D', start: '2026-08-01T10:00:00Z' }], naeste: 'n' });
    } finally {
        global.fetch = gem;
    }
});

// ======================= 13: spillerlisten kræver admin =======================

const express = require('express');
const jwt = require('jsonwebtoken');
const { after } = require('node:test');
const { generateClubAdminToken } = require('../../middleware/clubAdminAuth');
const klubAdminSession = require('../../middleware/klubAdminSession');

const servere = [];
after(() => servere.forEach(s => s.close()));
// En lille express-app på en tilfældig port, i club-mode for klubben lyngby
function klubApp(opsaet) {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => { req.accessMode = 'club'; req.clubSubdomain = 'lyngby'; req.clubDbName = 'club_lyngby'; next(); });
    opsaet(a);
    const s = a.listen(0);
    servere.push(s);
    return (p, opt = {}) => fetch(`http://127.0.0.1:${s.address().port}${p}`, opt);
}
const bearer = (t) => ({ headers: { Authorization: `Bearer ${t}` } });

// Klubbens admins i testen: 1 = alle sider, 2 = kun Holdkamp
klubAdminSession._saetKlubAdminOpslag(async (id) => ({
    1: { password_hash: 'h1', page_permissions: null },
    2: { password_hash: 'h2', page_permissions: JSON.stringify(['holdkamp']) }
})[id] || null);
const fuldAdmin = generateClubAdminToken(1, 'formand', 'lyngby', null, 'h1');
const holdkampAdmin = generateClubAdminToken(2, 'holdleder', 'lyngby', ['holdkamp'], 'h2');
const qrToken = jwt.sign({ role: 'device', tokenId: 9, destination: 'court/3', tokenType: 'match_session', clubSubdomain: 'lyngby' }, process.env.JWT_SECRET);
const tvToken = jwt.sign({ role: 'device', tokenId: 7, destination: 'tv/3', tokenType: 'permanent', clubSubdomain: 'lyngby' }, process.env.JWT_SECRET);

test('13: spillerlisten, én spiller og søgningen — 401 uden token, 403 for adgangslinks, 200 for admin', async () => {
    dbSvar = async (sql) => sql.includes('FROM player_info') ? [{ id: 5, name: 'Ella Hansen', club: 'Lyngby', gender: 'Dame', age_group: 'U11' }] : [];
    const hent = klubApp(a => a.use('/api/player-info', require('../../routes/playerInfo')));
    for (const sti of ['/api/player-info', '/api/player-info/5', '/api/player-info/search?q=Ella']) {
        assert.equal((await hent(sti)).status, 401, `${sti} uden token`);
        assert.equal((await hent(sti, bearer(qrToken))).status, 403, `${sti} med QR-telefonens token`);
        assert.equal((await hent(sti, bearer(tvToken))).status, 403, `${sti} med TV'ets token`);
        const r = await hent(sti, bearer(fuldAdmin));
        assert.equal(r.status, 200, `${sti} med admin`);
    }
    assert.equal((await (await hent('/api/player-info/search?q=Ella', bearer(fuldAdmin))).json())[0].name, 'Ella Hansen');
    // Admin uden siden Spillere: ikke listen — men navneforslagene i holdkamp og baneredigering
    assert.equal((await hent('/api/player-info', bearer(holdkampAdmin))).status, 403);
    assert.equal((await hent('/api/player-info/5', bearer(holdkampAdmin))).status, 403);
    assert.equal((await hent('/api/player-info/search?q=Ella', bearer(holdkampAdmin))).status, 200);
});

test('13: frontenden sender admin-tokenet til spillerlisten — og kun admin kalder den', () => {
    const api = laes('frontend/js/api.js');
    assert.doesNotMatch(api, /\/player-info[^\n]*requiresAuth: false/);
    assert.match(api, /async searchPlayers\(q\)/);
    const admin = laes('frontend/admin-script.js');
    assert.doesNotMatch(admin, /fetch\(`\/api\/player-info/);
    assert.match(admin, /await api\.searchPlayers\(searchTerm\)/);
    // Tablet, TV, oversigt, ur, /live og QR-telefonen (samme side som tabletten) rører den ikke
    for (const f of ['frontend/court-script-v3.js', 'frontend/tv-script-v3.js', 'frontend/oversigt-script.js', 'frontend/ur-script.js', 'frontend/live-script.js']) {
        if (!fs.existsSync(path.join(ROD, f))) continue;
        assert.doesNotMatch(laes(f), /player-info|getPlayers\(|getPlayer\(|searchPlayers\(/, f);
    }
});

// ======================= 14A: TV- og oversigt-links kan kun læse =======================

const auth = require('../../middleware/auth');
auth._saetAdgangslinkOpslag(async () => true);   // alle adgangslinks i testen er aktive

const deviceToken = (destination, ekstra = {}) => jwt.sign({ role: 'device', tokenId: 7, destination, tokenType: 'permanent',
    clubSubdomain: 'lyngby', ...ekstra }, process.env.JWT_SECRET);

// requireWriteAuthInClubMode køres direkte: { nexted } eller { status, body }
async function vagt(token, metode, sti) {
    const req = { accessMode: 'club', clubSubdomain: 'lyngby', method: metode, originalUrl: sti, url: sti,
        headers: { authorization: `Bearer ${token}` } };
    const ud = {};
    const res = { status(s) { ud.status = s; return this; }, json(b) { ud.body = b; return this; } };
    await auth.requireWriteAuthInClubMode(req, res, () => { ud.nexted = true; });
    return ud;
}

test('14A: et TV- eller oversigt-link må ikke skrive — kun læse og skærmens egne ruter', async () => {
    for (const dest of ['tv/3', 'tv', 'tv-v3', 'oversigt', 'noget-fra-en-gammel-backup']) {
        const t = deviceToken(dest);
        for (const [m, sti] of [['PUT', '/api/game-states/3'], ['DELETE', '/api/game-states/3'], ['POST', '/api/match-history'],
            ['POST', '/api/team-matches'], ['PUT', '/api/settings/theme'], ['POST', '/api/ur/tryk'], ['POST', '/api/livestream/bane/3/start']]) {
            const r = await vagt(t, m, sti);
            assert.equal(r.status, 403, `${dest}: ${m} ${sti}`);
            assert.equal(r.body.error, 'Skærmens adgangslink kan kun læse');
        }
        for (const [m, sti] of [['GET', '/api/game-states/3'], ['GET', '/api/device-tokens/mit'], ['GET', '/api/ur/kode?bane=3'],
            ['POST', '/api/screens/heartbeat'], ['POST', '/api/screens/pc-rapport'], ['POST', '/api/livestream/pc'],
            ['POST', '/api/device-tokens/mit/skift']]) {
            assert.equal((await vagt(t, m, sti)).nexted, true, `${dest}: ${m} ${sti} er tilladt`);
        }
    }
});

test('14A: tablet-links (court/N), QR-sessioner og admin er uændrede', async () => {
    const tablet = deviceToken('court/3');
    const qr = deviceToken('court/3', { tokenType: 'match_session' });
    for (const t of [tablet, qr, fuldAdmin]) {
        assert.equal((await vagt(t, 'PUT', '/api/game-states/3')).nexted, true);
        assert.equal((await vagt(t, 'POST', '/api/match-history')).nexted, true);
    }
    assert.equal(auth.erSkaermLink(jwt.decode(tablet)), false);
    assert.equal(auth.erSkaermLink(jwt.decode(deviceToken('tv/12'))), true);
    assert.equal(auth.erSkaermLink(jwt.decode(fuldAdmin)), false);
});

test('14A: PUT /api/game-states/:bane med TV-tokenet afvises gennem den rigtige rute; tabletten kommer forbi vagten', async () => {
    dbSvar = async () => [];
    const hent = klubApp(a => a.use('/api/game-states', require('../../routes/gameStates')));
    const krop = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player1: { name: 'A' } }) };
    const tv = await hent('/api/game-states/3', { ...krop, headers: { ...krop.headers, Authorization: `Bearer ${deviceToken('tv/3')}` } });
    assert.equal(tv.status, 403);
    assert.equal((await tv.json()).error, 'Skærmens adgangslink kan kun læse');
    const tab = await hent('/api/game-states/3', { ...krop, headers: { ...krop.headers, Authorization: `Bearer ${deviceToken('court/3')}` } });
    assert.notEqual((await tab.json()).error, 'Skærmens adgangslink kan kun læse');
});

test('14A: TV og oversigt skriver kun hjerteslaget og deres eget link — begge er tilladt', () => {
    for (const f of ['frontend/tv-script-v3.js', 'frontend/oversigt-script.js']) {
        const k = laes(f);
        assert.doesNotMatch(k, /method: *'(POST|PUT|DELETE|PATCH)'/, `${f} skriver ikke selv`);
    }
    const api = laes('frontend/js/api.js');
    assert.match(udsnit(api, 'async sendScreenHeartbeat(', 'async getScreens('), /'\/screens\/heartbeat'/);
    assert.match(laes('frontend/js/adgangslink-vagt.js'), /'\/device-tokens\/mit\/skift', \{ method: 'POST' \}/);
});
