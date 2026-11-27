/**
 * Turneringsprogrammet på telefonen (Jesper 2026-11-27): oversigt.html får
 * fanerne Afsluttet / Nu / Program på en telefon, mens en turnering er i gang —
 * aldrig på TV'et/kiosk-PC'en.
 *
 * GET /api/tournaments/program (offentlig, gemt 10 s pr. klub) og de rene
 * hjælpere i frontend/js/turnering-program.js (søgning, sortering, sættene).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');

const rod = path.join(__dirname, '..', '..', '..');
const laes = (rel) => fs.readFileSync(path.join(rod, rel), 'utf8');

// Frontend-modulet i en lille falsk browser uden touch: fanerne starter ikke
function frontend() {
    const ctx = {
        window: {}, location: { search: '' }, URLSearchParams, Date, Intl,
        document: { readyState: 'complete', addEventListener() {}, body: { classList: { contains: () => false } } },
        sessionStorage: { getItem: () => null }, localStorage: { getItem: () => null }
    };
    vm.createContext(ctx);
    vm.runInContext(laes('frontend/js/turnering-program.js'), ctx);
    // Svarene krydser vm-grænsen: JSON-kopi, så deepEqual sammenligner værdierne
    const t = ctx.window.TurneringProgram._test;
    const kopi = (f) => (...a) => { const v = f(...a); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
    return Object.fromEntries(Object.entries(t).map(([k, f]) => [k, kopi(f)]));
}

const KAMP = {
    id: 7, label: 'HS U13 A', planned_time: '2026-11-28 09:30', doubles: 0,
    side1_player1: 'Anders Holm', side1_player2: null, side2_player1: 'Bo Lund', side2_player2: null,
    court_number: 3, status: 'pending', winner_team: null, set_scores: null, finished_at: null
};

test('programKamp: kun det, telefonen skal bruge', () => {
    const { programKamp } = require('../../routes/tournaments')._program;
    assert.deepEqual(programKamp(KAMP), {
        id: 7, raekke: 'HS U13 A', tid: '2026-11-28 09:30', double: false,
        side1: ['Anders Holm'], side2: ['Bo Lund'], bane: null, status: 'pending',
        vinder: null, saet: null, slut: null
    }, 'en ventende kamp har ingen bane (TS-banen bruges ikke), intet resultat');
    assert.equal(programKamp({ ...KAMP, status: 'active' }).bane, 3);
    const f = programKamp({ ...KAMP, status: 'finished', winner_team: 2, set_scores: 'Anders Holm 15-21 Bo Lund, Anders Holm 18-21 Bo Lund', finished_at: new Date('2026-11-28T09:55:00Z'), court_number: null });
    assert.equal(f.vinder, 2);
    assert.equal(f.slut, '2026-11-28T09:55:00.000Z');
    assert.match(f.saet, /15-21/);
    assert.deepEqual(programKamp({ ...KAMP, doubles: 1, side1_player2: 'Ib', side2_player1: null }).side2, [], 'ukendt modstander');
});

test('GET /api/tournaments/program: offentlig, aktive turneringer med klubber, gemt i 10 s', async (t) => {
    let kald = 0;
    const sqls = [];
    const stub = (rel, exports) => {
        const sti = require.resolve(rel);
        require.cache[sti] = { id: sti, filename: sti, loaded: true, exports };
    };
    stub('../../config/database', {
        query: async (sql) => {
            sqls.push(sql);
            if (/FROM tournaments WHERE status = 'active'/.test(sql)) { kald++; return [{ id: 5, name: 'Lyngby Ungdom' }]; }
            if (/FROM tournament_matches/.test(sql)) return [KAMP, { ...KAMP, id: 8, status: 'finished', winner_team: 1, set_scores: 'W.O.' }];
            if (/FROM tournament_player_clubs/.test(sql)) return [{ player_name: 'Anders Holm', club: 'Lyngby BK' }, { player_name: 'Bo Lund', club: '' }];
            return [];
        },
        queryOne: async () => null,
        transaktion: async (fn) => fn({ query: async () => [] })
    });
    delete require.cache[require.resolve('../../routes/tournaments')];
    const router = require('../../routes/tournaments');
    router._program.cache.clear();

    const express = require('express');
    const app = express();
    app.use('/api/tournaments', router);
    const srv = http.createServer(app).listen(0);
    t.after(() => { srv.closeAllConnections(); srv.close(); });
    const url = `http://127.0.0.1:${srv.address().port}/api/tournaments/program`;

    const r = await fetch(url);
    assert.equal(r.status, 200, 'intet login');
    const svar = await r.json();
    assert.equal(svar.length, 1);
    assert.deepEqual(Object.keys(svar[0]).sort(), ['id', 'kampe', 'klubber', 'navn']);
    assert.deepEqual(svar[0].klubber, { 'Anders Holm': 'Lyngby BK' }, 'tom klub udelades');
    assert.equal(svar[0].kampe.length, 2);
    assert.equal(svar[0].kampe[1].saet, 'W.O.');
    assert.ok(sqls.some(s => /WHERE status = 'active'/.test(s)), 'kun aktive turneringer');

    // Inden for 10 s: fra hukommelsen, og ETag giver 304
    const etag = r.headers.get('etag');
    assert.ok(etag);
    // (http.get: fetch() sætter selv no-cache på et betinget kald, som en browser ikke gør)
    const status2 = await new Promise((ok, fejl) => http.get(url, { headers: { 'If-None-Match': etag } }, (s) => { s.resume(); ok(s.statusCode); }).on('error', fejl));
    assert.equal(status2, 304);
    assert.equal(kald, 1, 'databasen spørges kun én gang');
    assert.equal(r.headers.get('cache-control'), 'no-cache');
});

test('søgning: navn, klub og række; valgt spiller/klub er præcis', () => {
    const { passer, forslag, norm } = frontend();
    const klubber = { 'Anders Holm': 'Lyngby BK', 'Bo Lund': 'Hillerød BMK', 'Åse Ødegaard': 'Værløse BK' };
    const k = { raekke: 'HS U13 A', side1: ['Anders Holm'], side2: ['Bo Lund'] };
    assert.equal(norm('  ÅSE Ødegaard '), 'ase ødegaard');
    assert.equal(passer(k, klubber, '', null), true);
    assert.equal(passer(k, klubber, 'holm', null), true);
    assert.equal(passer(k, klubber, 'hillerød', null), true, 'klub');
    assert.equal(passer(k, klubber, 'u13', null), true, 'række');
    assert.equal(passer(k, klubber, 'værløse', null), false);
    assert.equal(passer(k, klubber, 'holm', { type: 'spiller', navn: 'Bo Lund' }), true, 'valgt går forud for teksten');
    assert.equal(passer(k, klubber, '', { type: 'spiller', navn: 'Anders' }), false, 'præcist navn');
    assert.equal(passer(k, klubber, '', { type: 'klub', navn: 'Lyngby BK' }), true);
    assert.equal(passer({ ...k, side2: [] }, klubber, '', { type: 'klub', navn: 'Hillerød BMK' }), false);

    const t = { kampe: [k, { side1: ['Åse Ødegaard'], side2: ['Anders Lund'] }], klubber };
    const f = forslag(t, 'lund');
    assert.deepEqual([...f.spillere], ['Anders Lund', 'Bo Lund']);
    assert.deepEqual([...forslag(t, 'bo').spillere], ['Bo Lund']);
    assert.deepEqual([...forslag(t, 'lyng').klubber], ['Lyngby BK']);
    assert.deepEqual([...forslag(t, 'ase').spillere], ['Åse Ødegaard'], 'å = a');
    assert.deepEqual([...forslag(t, '').spillere], []);
});

test('programmet efter planlagt tid, afsluttede nyeste først', () => {
    const { programKampe, afsluttedeKampe, grupper, delTid } = frontend();
    const kampe = [
        { id: 1, status: 'pending', tid: '2026-11-28 10:00' },
        { id: 2, status: 'pending', tid: null },
        { id: 3, status: 'active', tid: '2026-11-28 09:30' },
        { id: 4, status: 'finished', tid: '2026-11-28 09:00', slut: '2026-11-28T08:20:00.000Z' },
        { id: 5, status: 'finished', tid: '2026-11-28 09:00', slut: '2026-11-28T08:40:00.000Z' },
        { id: 6, status: 'pending', tid: '2026-11-29 09:00' }
    ];
    assert.deepEqual(programKampe(kampe).map(k => k.id), [3, 1, 6, 2], 'i gang med, uden tid sidst');
    assert.deepEqual(afsluttedeKampe(kampe).map(k => k.id), [5, 4]);
    assert.deepEqual(delTid('2026-11-28 09:30'), { dag: '2026-11-28', kl: '09:30' });
    assert.equal(delTid('09:30'), null);
    const g = grupper(programKampe(kampe), k => delTid(k.tid));
    assert.deepEqual(g.map(d => d.dag), ['2026-11-28', '2026-11-29', '']);
    assert.deepEqual(g[0].tider.map(x => x.kl), ['09:30', '10:00']);
});

test('sættene vendes til side 1 ud fra navnene i strengen', () => {
    const { saetFraSide1 } = frontend();
    const k = (saet, side1 = ['A Holm'], side2 = ['B Lund']) => saetFraSide1({ saet, side1, side2 });
    assert.deepEqual(k('A Holm 21-15 B Lund, B Lund 21-18 A Holm, A Holm 19-21 B Lund'), [[21, 15], [18, 21], [19, 21]]);
    assert.deepEqual(k('C D / E F 21-12 G H / I J', ['C D', 'E F'], ['G H', 'I J']), [[21, 12]]);
    assert.deepEqual(k('G H & I J 21-12 C D & E F', ['C D', 'E F'], ['G H', 'I J']), [[12, 21]], '& som skilletegn');
    assert.deepEqual(k('A Holm 21-12 B Lund, A Holm 8-3 B Lund (afsluttet før tid)'), [[21, 12], [8, 3]]);
    assert.deepEqual(k('W.O.'), []);
    assert.deepEqual(k(null), []);
    assert.deepEqual(k('21-15, 15-21'), [[21, 15], [15, 21]], 'kun tal');
});

test('fanerne kommer aldrig på TV/kiosk: kun touch uden mus, ikke kiosk-parametre eller adgangslink', () => {
    const src = laes('frontend/js/turnering-program.js');
    assert.match(src, /matchMedia\('\(hover: none\) and \(pointer: coarse\)'\)/);
    assert.match(src, /p\.has\('skaerm'\) \|\| p\.has\('kioskversion'\)/);
    assert.match(src, /sessionStorage\.getItem\('deviceToken'\)/);
    // Uden turnering: oversigten som altid
    assert.match(src, /if \(!tilstand\.data\.some\(t => t\.kampe\.length\)\) return;/);
    const { erSkaerm } = frontend();
    assert.equal(erSkaerm(new URLSearchParams('skaerm=Hal')), true);
    assert.equal(erSkaerm(new URLSearchParams('kioskversion=2026.11.10')), true);
    assert.equal(erSkaerm(new URLSearchParams('')), false);

    const html = laes('frontend/oversigt.html');
    assert.match(html, /<link rel="stylesheet" href="turnering-program\.css\?v=\d+">/);
    assert.ok(html.indexOf('js/turnering-program.js') > html.indexOf('js/api.js'), 'efter api.js');
    assert.ok(Number((html.match(/oversigt-script\.js\?v=(\d+)/) || [])[1]) >= 48);
    const ov = laes('frontend/oversigt-script.js');
    assert.match(ov, /classList\.contains\('ov-faner'\) \? Math\.max\(activeCourts\.length, 1\) : COURTS_PER_PAGE/);
    assert.match(ov, /document\.body\.classList\.toggle\('ov-tom', !hasActivity\);/);
    // Al styling er bundet til body.ov-faner / tp-klasser
    const css = laes('frontend/turnering-program.css');
    for (const regel of css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g)) {
        for (const sel of regel.split(',').map(s => s.trim()).filter(Boolean)) {
            assert.ok(/ov-faner|tp-|^body:not\(\.tp-liste-vist\)/.test(sel), `"${sel}" kan ramme TV'et`);
        }
    }
});
