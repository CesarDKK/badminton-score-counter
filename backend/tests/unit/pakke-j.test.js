/**
 * Pakke J — tælleren: nr. 28, 29, 30 (liste 1) og 69, 70, 71, 73 (liste 2).
 * Ingen database: config/database.js erstattes af en falsk, der husker banens
 * række, så ruterne kan køres direkte. Frontend-funktioner hentes ud af
 * kildefilerne og køres i en vm-sandkasse.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-pakke-j';

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

// ---------- Falsk database (før ruterne indlæses — de destrukturerer query) ----------
const db = require('../../config/database');
let svar = async () => [];
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };
const indeks = (re) => kald.findIndex(k => re.test(k.sql));

const regler = require('../../taeller/regler');
const gameStates = require('../../routes/gameStates');
const { meldAfgjortKamp } = require('../../taeller/resultatMelding');

// Rutens sidste handler (forbi auth-middleware) køres med et falsk req/res
function rute(router, metode, sti) {
    const lag = router.stack.find(l => l.route && l.route.path === sti && l.route.methods[metode]);
    assert.ok(lag, `${metode.toUpperCase()} ${sti} findes`);
    const handlers = lag.route.stack;
    return handlers[handlers.length - 1].handle;
}
async function koer(handler, req) {
    const res = { statusKode: 200, krop: null,
        status(s) { this.statusKode = s; return this; }, json(j) { this.krop = j; return this; } };
    let fejl = null;
    await handler(req, res, (e) => { fejl = e; });
    if (fejl) throw fejl;
    return res;
}

// Træk en funktion/erklæring ud af en kildefil (fra startmarkør til slutmarkør)
function udsnit(kilde, fra, til) {
    const a = kilde.indexOf(fra);
    assert.ok(a >= 0, `markøren findes: ${fra}`);
    const b = kilde.indexOf(til, a + fra.length);
    assert.ok(b > a, `slutmarkøren findes: ${til}`);
    return kilde.slice(a, b);
}

// ======================= Nr. 71: "Ryd banen" efter en afgjort double =======================

// Banen med en afgjort double, og en aktiv double-delkamp på den. Den falske
// database husker courts.is_doubles, så nulstillingen ses af indmeldingen
function rydBaneDb({ isDoubles }) {
    const bane = { is_doubles: isDoubles ? 1 : 0 };
    const gs = {
        court_id: 7, match_completed: 1, result_outcome: null,
        player1_name: 'Anna', player1_name2: isDoubles ? 'Bo' : 'Makker 1', player1_games: 2, player1_score: 15,
        player2_name: 'Carl', player2_name2: isDoubles ? 'Dorte' : 'Makker 2', player2_games: 0, player2_score: 9,
        set_scores_history: JSON.stringify([{ player1Name: 'Anna', player1Name2: 'Bo', player2Name: 'Carl', player2Name2: 'Dorte', score: '15-9' }]),
        match_start_time: '2026-11-13 10:00:00', match_end_time: '2026-11-13 10:20:00'
    };
    const delkamp = {
        id: 41, category: isDoubles ? 'HD' : 'HS', started_at: '2026-11-13 09:55:00',
        team1_player1: 'Anna', team1_player2: isDoubles ? 'Bo' : null,
        team2_player1: 'Carl', team2_player2: isDoubles ? 'Dorte' : null,
        team1_name: 'Lyngby', team2_name: 'Holte'
    };
    nulstil(async (sql) => {
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 7, ...bane }];
        if (/SELECT \* FROM game_states/.test(sql)) return [gs];
        if (/UPDATE courts SET is_active = FALSE, is_doubles = FALSE/.test(sql)) { bane.is_doubles = 0; return { affectedRows: 1 }; }
        if (/FROM team_match_games g/.test(sql)) return [delkamp];
        if (/^\s*(UPDATE|DELETE|INSERT)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
}

for (const isDoubles of [true, false]) {
    test(`71: Ryd banen melder den afgjorte ${isDoubles ? 'double' : 'single'} ind, før banen nulstilles`, async () => {
        rydBaneDb({ isDoubles });
        const res = await koer(rute(gameStates, 'delete', '/:courtId'), { params: { courtId: '3' }, user: { admin: true } });
        assert.equal(res.statusKode, 200);
        const meldt = indeks(/UPDATE team_match_games\s+SET status = 'finished'/);
        const nulstillet = indeks(/UPDATE courts SET is_active = FALSE, is_doubles = FALSE/);
        assert.ok(meldt >= 0, 'delkampen er meldt færdig');
        assert.ok(meldt < nulstillet, 'indmeldingen kommer før nulstillingen af is_doubles');
        assert.deepEqual(kald[meldt].params.slice(1, 3),
            [1, isDoubles ? 'Anna & Bo 15-9 Carl & Dorte' : 'Anna 15-9 Carl'], 'hold 1 vandt, sættene som på tabletten');
    });
}

test('71: meldAfgjortKamp bruger den medsendte single/double og læser ikke banen igen', async () => {
    rydBaneDb({ isDoubles: true });
    const gs = (await db.queryOne('SELECT * FROM game_states WHERE court_id = ?', [7]));
    kald = [];
    // Banen står som single i databasen (nulstillet) — men kampen var en double
    svar = async (sql) => {
        if (/FROM courts/.test(sql)) return [{ is_doubles: 0 }];
        if (/FROM team_match_games g/.test(sql)) return [{ id: 41, category: 'HD', started_at: null,
            team1_player1: 'Anna', team1_player2: 'Bo', team2_player1: 'Carl', team2_player2: 'Dorte' }];
        return { affectedRows: 1 };
    };
    const r = await meldAfgjortKamp({}, 3, gs, { erDouble: true });
    assert.equal(r && r.type, 'holdkamp');
    assert.equal(indeks(/FROM courts/), -1, 'banen læses ikke');
    // Uden erDouble læses banen som før (og nægter her: single mod double-delkamp)
    kald = [];
    assert.equal(await meldAfgjortKamp({}, 3, gs), null);
    assert.ok(indeks(/FROM courts/) >= 0);
});

test('QR-telefonen (kunHoldkamp) melder en delkamp ind, men aldrig en turneringskamp', async () => {
    rydBaneDb({ isDoubles: false });
    const gs = (await db.queryOne('SELECT * FROM game_states WHERE court_id = ?', [7]));
    // Ingen delkamp på banen, men en turneringskamp
    svar = async (sql) => {
        if (/FROM team_match_games g/.test(sql)) return [];
        if (/FROM tournament_matches m/.test(sql)) return [{ id: 9, doubles: 0, started_at: null,
            side1_player1: 'Anna', side2_player1: 'Carl' }];
        return { affectedRows: 1 };
    };
    kald = [];
    assert.equal(await meldAfgjortKamp({}, 3, gs, { erDouble: false, kunHoldkamp: true }), null);
    assert.equal(indeks(/FROM tournament_matches m/), -1, 'turneringskampen slås ikke engang op');
    assert.equal(indeks(/UPDATE tournament_matches/), -1);
    // Delkampen meldes ind som fra en tablet
    svar = async (sql) => {
        if (/FROM team_match_games g/.test(sql)) return [{ id: 41, category: 'HS', started_at: null,
            team1_player1: 'Anna', team1_player2: null, team2_player1: 'Carl', team2_player2: null }];
        return { affectedRows: 1 };
    };
    const r = await meldAfgjortKamp({}, 3, gs, { erDouble: false, kunHoldkamp: true });
    assert.equal(r && r.type, 'holdkamp');
});

test('71: tablettens "Ryd banen" sætter ikke en afgjort kamps delkamp/turneringskamp til "afventer" først', () => {
    const kilde = laes('frontend/court-script-v3.js');
    const fn = udsnit(kilde, 'async function performClearCourtNow() {', '// Ny kamp starter altid liggende');
    assert.match(fn, /const kampAfgjort = !!gameState\.matchCompleted;/);
    assert.match(fn, /if \(!kampAfgjort\) try \{\s*\n\s*await api\.updateTeamMatchGame\(/);
    assert.match(fn, /if \(!kampAfgjort\) try \{\s*\n\s*await api\.updateTournamentMatch\(/);
});

// Fundet i browsertesten: tabletten genindlæst efter en afgjort double-delkamp,
// hvis indmelding ikke nåede frem. En 2-0 slutter med holdene byttet; bindingen
// skrev navnene tilbage i oprindelig orientering oven på sættene, tabletten
// gemte, og serveren meldte det tabende hold ind som vinder
function bindDelkamp(gameState) {
    const kilde = laes('frontend/court-script-v3.js');
    const kode = udsnit(kilde, 'function applyHoldkampGameToState(game) {', '// Delkampen banen er bundet til');
    const gemt = [];
    const sb = {
        gameState, activeTeamMatch: { team1_name: 'Lyngby', team2_name: 'Holte' },
        HoldkampFormater: { erDouble: (k) => /D|GS/.test(k), saetForSejr: (k) => (k === 'GS' ? 1 : 2) },
        updateDisplay: () => {}, saveGameState: () => gemt.push(JSON.parse(JSON.stringify(gameState)))
    };
    vm.createContext(sb);
    vm.runInContext(kode + '\nthis.bind = applyHoldkampGameToState;', sb);
    sb.bind({ category: 'HD', team1_player1: 'Anna', team1_player2: 'Bo', team2_player1: 'Carl', team2_player2: 'Dorte' });
    return gemt[0];
}
const afgjortByttet = (ekstra = {}) => ({
    matchStartTime: '2026-11-13T10:00:00Z', matchCompleted: true, isDoubles: true,
    player1: { name: 'Carl', name2: 'Dorte', score: 10, games: 0 },
    player2: { name: 'Anna', name2: 'Bo', score: 15, games: 2 }, ...ekstra
});

test('71: genbinding af en afgjort delkamp beholder navnene, hvor de står (ellers vandt det tabende hold)', () => {
    const gemt = bindDelkamp(afgjortByttet());
    assert.deepEqual([gemt.player1.name, gemt.player1.name2, gemt.player1.games], ['Carl', 'Dorte', 0]);
    assert.deepEqual([gemt.player2.name, gemt.player2.name2, gemt.player2.games], ['Anna', 'Bo', 2]);
    // Midt i kampen som før
    const iGang = bindDelkamp(afgjortByttet({ matchCompleted: false }));
    assert.equal(iGang.player1.name, 'Carl');
    // En ny tildeling (ikke startet) skrives i delkampens orientering som før
    const ny = bindDelkamp({ matchStartTime: null, matchCompleted: false, isDoubles: false,
        player1: { name: 'Spiller 1', name2: 'Makker 1', score: 0, games: 0 }, player2: { name: 'Spiller 2', name2: 'Makker 2', score: 0, games: 0 } });
    assert.deepEqual([ny.player1.name, ny.player1.name2, ny.player2.name, ny.player2.name2], ['Anna', 'Bo', 'Carl', 'Dorte']);
    // Turneringskampene bruger samme vagt
    assert.match(laes('frontend/court-script-v3.js'), /function applyTournamentMatchToCourt\(match\) \{[\s\S]*?const fortsaetter = kampStartet\(\) && sideOrientering\(side1, side2\) !== null;/);
});

// ======================= Nr. 73: tabletten venter på indstillingerne =======================

function tabletIndstillinger({ svarListe, gemte = null, courtId = 3 }) {
    const kilde = laes('frontend/court-script-v3.js');
    const kode = udsnit(kilde, 'const INDSTILLINGER_NOEGLE', '// Banens tilstand hentes');
    const elementer = Object.fromEntries(['clearCourtBtn', 'doublesToggle', 'gameModeToggle']
        .map(id => [id, { style: { display: 'block' } }]));
    const lager = gemte ? { btTaellerIndstillinger: JSON.stringify(gemte) } : {};
    const ventende = [];
    const sb = {
        console: { log() {}, error() {} },
        courtId, gameState: {}, isTournamentMode: false,
        beskeder: [], skjult: 0, opdateret: 0,
        location: { href: 'court-v3.html' },
        window: null,
        document: { getElementById: (id) => elementer[id] || null },
        localStorage: { getItem: (k) => lager[k] ?? null, setItem: (k, v) => { lager[k] = v; } },
        showMessage(t) { sb.beskeder.push(t); },
        hideMessage() { sb.skjult++; },
        updateDisplay() { sb.opdateret++; },
        setTimeout: (fn) => { ventende.push(fn); },
        api: { async getSettings() {
            const s = svarListe.shift();
            if (s instanceof Error) throw s;
            return s;
        } }
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(kode + '\nthis.initializeApp = initializeApp;', sb);
    // Kør det, der venter på en timer (genforsøg), til intet venter
    sb.koerVentende = async () => { while (ventende.length) { await ventende.shift()(); await new Promise(r => setImmediate(r)); } };
    return { sb, elementer, lager };
}
const netfejl = () => Object.assign(new Error('net'), { status: 0 });

test('73: uden svar og uden gemte indstillinger venter tabletten — og bruger dem, når de kommer', async () => {
    const { sb, elementer, lager } = tabletIndstillinger({
        svarListe: [netfejl(), netfejl(), { courtCount: 6, showResetButton: false, defaultGameMode: '21' }]
    });
    const p = sb.initializeApp();
    await new Promise(r => setImmediate(r));
    assert.deepEqual(sb.beskeder, ['Henter banen …'], 'beskeden vises én gang');
    await sb.koerVentende();
    assert.equal(await p, true);
    assert.equal(sb.isTournamentMode, true, 'turneringstilstand er ikke tabt');
    assert.equal(elementer.clearCourtBtn.style.display, 'none');
    assert.equal(elementer.doublesToggle.style.display, 'none');
    assert.equal(sb.gameState._defaultGameMode, '21');
    assert.equal(sb.skjult, 1, 'beskeden lukkes');
    assert.ok(lager.btTaellerIndstillinger, 'gemt til næste opstart');
});

test('73: uden svar bruges de sidst hentede straks, og de nye hentes i baggrunden', async () => {
    const { sb, elementer } = tabletIndstillinger({
        gemte: { courtCount: 6, showResetButton: false },
        svarListe: [netfejl(), netfejl(), { courtCount: 6, showResetButton: true }]
    });
    assert.equal(await sb.initializeApp(), true);
    assert.equal(sb.isTournamentMode, true, 'den gemte turneringstilstand gælder fra start');
    assert.equal(elementer.clearCourtBtn.style.display, 'none');
    assert.deepEqual(sb.beskeder, [], 'ingen ventebesked — der tælles videre');
    await sb.koerVentende();
    assert.equal(sb.isTournamentMode, false, 'serverens svar vinder, når det kommer');
    assert.equal(elementer.clearCourtBtn.style.display, '');
    assert.ok(sb.opdateret >= 1, 'knapperne tegnes igen');
});

test('73: ugyldig bane — landing, og opstarten stopper', async () => {
    const { sb } = tabletIndstillinger({ courtId: 9, svarListe: [{ courtCount: 6, showResetButton: true }] });
    assert.equal(await sb.initializeApp(), false);
    assert.equal(sb.location.href, 'landing.html');
    assert.match(laes('frontend/court-script-v3.js'), /if \(await initializeApp\(\) === false\) return;\s*\n\s*await loadGameState\(\);/);
});

// ======================= Nr. 28: ens navne på begge sider =======================

const ensNavne = () => regler.nyKamp({ navne: { p1: 'Emil', p2: 'Emil' }, gameMode: '15' });

test('28: reglerne holder styr på sidernes orientering uafhængigt af navnene', () => {
    const st = ensNavne();
    assert.equal(st.sidesSwapped, false);
    regler.vaelgServer(st, 1);
    for (let i = 0; i < 15; i++) regler.point(st, 1, 1000 + i);
    assert.equal(st.setScoresHistory[0].byttet, false, '1. sæt: som begyndt');
    regler.afslutPause(st);                  // nyt sæt: siderne byttes
    assert.equal(st.sidesSwapped, true);
    assert.equal(st.player2.games, 1, 'vinderen af 1. sæt står nu i player2');
    regler.point(st, 1, 5000);
    regler.fortryd(st);
    assert.equal(st.sidesSwapped, true, 'fortryd i 2. sæt bytter ikke tilbage');
    for (let i = 0; i < 15; i++) regler.point(st, 1, 6000 + i);
    assert.equal(st.setScoresHistory[1].byttet, true, '2. sæt: byttet');
    // Fortryd af sætbolden og pausen giver sættets orientering tilbage
    regler.fortryd(st);
    assert.equal(st.setScoresHistory.length, 1);
    assert.equal(st.sidesSwapped, true);
    // Signaturen (facit) indeholder ikke feltet — facit er uændret for nr. 28
    assert.doesNotMatch(regler.signatur(st), /byttet|sidesSwapped/);
});

test('28: uret skiller ens navne ad — før talte begge knapper for side 1', () => {
    const kilde = laes('frontend/ur-script.js');
    const kode = udsnit(kilde, 'const sideFor =', '// Double: kun fornavnene');
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(kode + '\nthis.sideFor = sideFor; this.raekkefoelgeFor = raekkefoelgeFor;', sb);
    const st = ensNavne();
    let r = sb.raekkefoelgeFor(st, null);
    assert.deepEqual([...r.map(x => sb.sideFor(st, x))], [1, 2], 'øverste knap = side 1, nederste = side 2');
    // Efter sideskiftet: knapperne følger spillerne, ikke pladserne
    regler.skiftSider(st);
    r = sb.raekkefoelgeFor(st, r);
    assert.deepEqual([...r.map(x => sb.sideFor(st, x))], [2, 1]);
    // Genindlæst midt i 2. sæt: rækkefølgen er som i 1. sæt
    const st2 = ensNavne();
    regler.vaelgServer(st2, 1);
    for (let i = 0; i < 15; i++) regler.point(st2, 1, i);
    regler.afslutPause(st2);
    assert.deepEqual([...sb.raekkefoelgeFor(st2, null).map(x => sb.sideFor(st2, x))], [2, 1]);
    // Forskellige navne: som før (efter navn)
    const st3 = regler.nyKamp({ navne: { p1: 'Anna', p2: 'Bo' } });
    assert.deepEqual([...sb.raekkefoelgeFor(st3, null)], ['Anna', 'Bo']);
    assert.equal(sb.sideFor(st3, 'Bo'), 2);
});

test('28: TV\'et vender rækker og sæt efter sidesSwapped, når navnene er ens', () => {
    const kilde = laes('frontend/tv-script-v3.js');
    const kode = udsnit(kilde, '// Ens navne på begge sider: navnene kan ikke skille siderne ad', 'function startLocalTimer') +
        udsnit(kilde, 'function orientSetScore(setData) {', 'function extractTeamScore');
    const sb = { originalPlayer1Name: 'Emil', originalPlayer2Name: 'Emil' };
    vm.createContext(sb);
    vm.runInContext('var originalPlayer1Name = this.originalPlayer1Name, originalPlayer2Name = this.originalPlayer2Name;\n' +
        kode + '\nthis.sidernByttet = sidernByttet; this.orientSetScore = orientSetScore;', sb);
    const gs = (byttet) => ({ player1: { name: 'Emil' }, player2: { name: 'Emil' }, sidesSwapped: byttet });
    assert.equal(sb.sidernByttet(gs(false)), false, 'før: altid "byttet" ved ens navne');
    assert.equal(sb.sidernByttet(gs(true)), true);
    const saet = (score, byttet) => ({ player1Name: 'Emil', player2Name: 'Emil', score, byttet });
    assert.deepEqual([...sb.orientSetScore(saet('15-9', false))], [15, 9]);
    assert.deepEqual([...sb.orientSetScore(saet('9-15', true))], [15, 9], 'byttet sæt vendes tilbage');
    // Gamle sæt uden feltet: som før
    assert.deepEqual([...sb.orientSetScore({ player1Name: 'Emil', player2Name: 'Emil', score: '9-15' })], [9, 15]);
});

test('28: tablettens kampslut-tabel og "Ret resultat" vender ens-navne-sæt efter byttet', () => {
    const kilde = laes('frontend/court-script-v3.js');
    const kode = udsnit(kilde, 'function ensNavneISaet(set) {', 'function sideOrientering');
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(kode + '\nthis.ensNavneISaet = ensNavneISaet;', sb);
    assert.equal(sb.ensNavneISaet({ player1Name: 'Emil', player2Name: 'Emil', score: '1-2', byttet: true }), true);
    assert.equal(sb.ensNavneISaet({ player1Name: 'Emil', player2Name: 'Emil', score: '1-2' }), false, 'uden feltet');
    assert.equal(sb.ensNavneISaet({ player1Name: 'Anna', player2Name: 'Emil', score: '1-2', byttet: true }), false);
    assert.match(kilde, /if \(ensNavneISaet\(set\) && typeof history\[0\]\.byttet === 'boolean'\) \{\s*\n[^\n]*\n\s*if \(set\.byttet !== history\[0\]\.byttet\)/);
    assert.match(kilde, /const vendt = ensNavneISaet\(set\)\s*\n\s*\? set\.byttet !== !!gameState\.sidesSwapped/);
});

// ======================= gemTilstand: nye kolonner og urets løbenummer =======================

// SET-delens "kolonne = ?" i rækkefølge, parret med parametrene
function saetVaerdier(sql, params) {
    const set = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
    const kol = [...set.matchAll(/(\w+) = \?/g)].map(m => m[1]);
    return Object.fromEntries(kol.map((k, i) => [k, params[i]]));
}
function gemDb(existing) {
    nulstil(async (sql) => {
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 7, is_active: 1, is_doubles: 0, game_mode: '15' }];
        if (/SELECT \* FROM game_states/.test(sql)) return existing ? [existing] : [];
        if (/^\s*(UPDATE|DELETE|INSERT)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
}
const raekke = (ekstra = {}) => ({
    court_id: 7, version: 5, player1_name: 'Emil', player1_name2: 'Makker 1', player1_score: 3, player1_games: 0,
    player2_name: 'Emil', player2_name2: 'Makker 2', player2_score: 2, player2_games: 0,
    match_start_time: '2026-11-13 10:00:00', match_completed: 0, sides_swapped: 0, sets_to_win: 2,
    rest_break_active: 0, rest_break_started_at: null, ...ekstra
});
const gemteUpdate = () => {
    const k = kald.find(x => /^\s*UPDATE game_states SET\s+player1_name/.test(x.sql));
    assert.ok(k, 'stillingen er skrevet');
    return { ...k, v: saetVaerdier(k.sql, k.params) };
};

test('28/30: sides_swapped og sets_to_win gemmes, læses og nulstilles ved ny kamp', async () => {
    gemDb(raekke());
    await gameStates.gemTilstand({}, 3, { player1: { score: 4 }, sidesSwapped: true, setsToWin: 1 });
    let u = gemteUpdate();
    assert.equal(u.v.sides_swapped, true);
    assert.equal(u.v.sets_to_win, 1);

    // En ældre tablet (uden felterne) midt i kampen: de gemte værdier står
    gemDb(raekke({ sides_swapped: 1, sets_to_win: 1 }));
    await gameStates.gemTilstand({}, 3, { player1: { score: 4 } });
    u = gemteUpdate();
    assert.equal(u.v.sides_swapped, true);
    assert.equal(u.v.sets_to_win, 1);

    // … og ved ny kamp (nulstilling) begynder de forfra
    gemDb(raekke({ sides_swapped: 1, sets_to_win: 1 }));
    await gameStates.gemTilstand({}, 3, {
        player1: { name: 'Emil', score: 0, games: 0 }, player2: { name: 'Emil', score: 0, games: 0 },
        matchStartTime: null, timerSeconds: 0 });
    u = gemteUpdate();
    assert.equal(u.v.sides_swapped, false);
    assert.equal(u.v.sets_to_win, 2);

    const f = gameStates.formatStateRow(raekke({ sides_swapped: 1, sets_to_win: 1 }), { is_doubles: 0, game_mode: '15' });
    assert.equal(f.sidesSwapped, true);
    assert.equal(f.setsToWin, 1);
    assert.equal(gameStates.formatStateRow(raekke(), { is_doubles: 0 }).setsToWin, 2);
});

test('30: golden set — tabletten sender og læser setsToWin, uret sender det videre', () => {
    const tablet = laes('frontend/court-script-v3.js');
    assert.match(tablet, /setsToWin: gameState\.setsToWin === 1 \? 1 : 2,/);
    assert.match(tablet, /gameState\.setsToWin = loaded\.setsToWin === 1 \? 1 : 2;/);
    assert.match(laes('backend/routes/urTaeller.js'), /setsToWin: st\.setsToWin === 1 \? 1 : 2,/);
    // Reglerne tæller ét sæt, når setsToWin = 1 (tilstanden fra serveren)
    const st = regler.nyKamp({ setsToWin: 1, gameMode: '15' });
    regler.vaelgServer(st, 1);
    // Ét sæt er det afgørende: siderne skiftes ved 8, så Spiller 1 tælles, hvor hun står
    let r, sideskift = false;
    for (let i = 0; i < 15; i++) {
        r = regler.point(st, st.player1.name === 'Spiller 1' ? 1 : 2, i);
        if (r.haendelser.includes('sideskift')) sideskift = true;
        if (st.restBreakActive && !st.matchCompleted) regler.afslutPause(st);
    }
    assert.ok(sideskift, 'sideskift ved 8 i golden set');
    assert.deepEqual(r.haendelser, ['kamp'], '15-0 i ét sæt afgør kampen');
    assert.match(laes('backend/migrations/046_sider_byttet_og_golden_set.sql'),
        /ADD COLUMN sides_swapped BOOLEAN NOT NULL DEFAULT FALSE;[\s\S]*ADD COLUMN sets_to_win TINYINT NOT NULL DEFAULT 2;/);
});

test('30: urets løbenummer skrives i samme UPDATE som stillingen (atomart)', async () => {
    gemDb(raekke({ tryk_taeller: 'urA', tryk_nr: 6 }));
    const historik = [{ player1: {} }];
    await gameStates.gemTilstand({}, 3, { player1: { score: 4 }, expectedVersion: 5 },
        { tryk: { taeller: 'urA', nr: 7, historik } });
    const u = gemteUpdate();
    assert.match(u.sql, /version = version \+ 1, tryk_taeller = \?, tryk_nr = \?, tryk_at = NOW\(\), fortryd_historik = \?\s+WHERE court_id = \? AND version = \?/);
    assert.equal(u.v.tryk_taeller, 'urA');
    assert.equal(u.v.tryk_nr, 7);
    assert.deepEqual(JSON.parse(u.v.fortryd_historik), { version: 6, historik }, 'historikken hører til den nye version');
    assert.deepEqual(u.params.slice(-2), [7, 5], 'court_id og versionen til sidst (CAS)');
    // Ingen særskilt opdatering af løbenummeret bagefter
    assert.equal(kald.filter(k => /tryk_nr/.test(k.sql)).length, 1);
    // Uden tryk: som før
    gemDb(raekke());
    await gameStates.gemTilstand({}, 3, { player1: { score: 4 } });
    assert.doesNotMatch(gemteUpdate().sql, /tryk_nr/);
    // Uret bruger det for point, servervalg, start, pause, fortryd og "Ny kamp"
    const ur = laes('backend/routes/urTaeller.js');
    assert.match(ur, /\{ tryk: \{ taeller: taellerId, nr, historik: st\.history \} \}/);
    assert.match(ur, /\{ tryk: \{ taeller: taellerId, nr, historik: null \} \}/);
    assert.doesNotMatch(ur, /UPDATE game_states SET tryk_taeller = \?, tryk_nr = \?, tryk_at = NOW\(\), fortryd_historik = \? WHERE/);
});

test('30: et nyt tryk uden række (INSERT) får også løbenummeret med', async () => {
    gemDb(null);
    await gameStates.gemTilstand({}, 3, {
        player1: { name: 'A', score: 1 }, player2: { name: 'B', score: 0 } }, { tryk: { taeller: 'urA', nr: 1, historik: null } });
    const ins = kald.find(k => /INSERT INTO game_states/.test(k.sql));
    assert.match(ins.sql, /version, tryk_taeller, tryk_nr, tryk_at, fortryd_historik\s*\) VALUES/);
    const antalSpm = (ins.sql.match(/\?/g) || []).length;
    assert.equal(antalSpm, ins.params.length, 'lige mange ? og parametre');
    assert.deepEqual(ins.params.slice(-3), ['urA', 1, null]);
});

test('30: pausens start stemples med serverens ur, og resten regnes ud for alle tællere', () => {
    const { pauseStartetVed, pauseSekunderTilbage } = gameStates;
    const NU = 1_800_000_000_000;
    const ny = { restBreakActive: true, restBreakTitle: 'Pause 1 minut', restBreakDuration: 60 };
    // Ny pause: serverens ur, uanset hvad klienten sendte
    assert.equal(pauseStartetVed(raekke(), ny, NU), NU);
    // Pausen kører videre (fx tablettens gemning hvert 10. sek.): starten står
    const koerer = raekke({ rest_break_active: 1, rest_break_started_at: NU - 20000, rest_break_title: 'Pause 1 minut', rest_break_duration: 60 });
    assert.equal(pauseStartetVed(koerer, ny, NU), NU - 20000);
    // Genoptaget efter genindlæsning med 40 sek. tilbage: ny start, ny længde
    assert.equal(pauseStartetVed(koerer, { ...ny, restBreakDuration: 40 }, NU), NU);
    // Sætpausen efter pausen ved 11: ny titel → ny start
    assert.equal(pauseStartetVed(koerer, { ...ny, restBreakTitle: 'Pause mellem Sæt - 2 Minutter', restBreakDuration: 120 }, NU), NU);
    // Skift fra ur til tablet midt i pausen: tabletten gemmer, resten regnes stadig ud
    const tablet = { ...koerer, tryk_taeller: 'urA', taeller_id: 'tabletB', rest_break_seconds_left: 60 };
    assert.equal(pauseSekunderTilbage(tablet, NU), 40);
    // Tabletten flytter serverens start over på sit eget ur
    assert.match(laes('frontend/court-script-v3.js'),
        /gameState\.restBreakStartedAt = loaded\.restBreakActive\s*\n\s*\? Date\.now\(\) - Math\.max\(0, \(loaded\.restBreakDuration \|\| 60\) - \(loaded\.restBreakSecondsLeft \|\| 0\)\) \* 1000/);
});

test('30: "Ret resultat" flytter ikke sluttiden', () => {
    const kilde = laes('backend/routes/gameStates.js');
    const sql = udsnit(kilde, "router.post('/:courtId/result'", 'Compare-and-swap mod den version vi læste');
    assert.match(sql, /match_end_time = COALESCE\(match_end_time, NOW\(\)\)/);
    assert.doesNotMatch(sql, /match_end_time = NOW\(\)/);
});

// ======================= Nr. 29: sideskift ved 11 i det afgørende sæt (double) =======================

test('29: ved sideskiftet i 3. sæt bliver modtagerparret i sine servefelter (§ 11.1.3, § 11.1.5)', () => {
    const st = regler.nyKamp({ navne: { p1: 'Anna', p1b: 'Bo', p2: 'Carl', p2b: 'Dorte' }, isDoubles: true, gameMode: '15' });
    regler.vaelgServer(st, 1);
    st.player1.games = 1; st.player2.games = 1;    // 3. sæt
    st.matchStartTime = 1;
    regler.bytPladser(st, 2);                       // Carl/Dorte: Dorte i højre felt
    const modtagerHoejre = st.team2RightCourt;      // spiller-nr. i højre felt
    for (let i = 0; i < 7; i++) regler.point(st, 1, i);
    assert.equal(st.team2RightCourt, modtagerHoejre, 'modtagerne flytter sig ikke, mens de modtager');
    const r = regler.point(st, 1, 8);               // 8-0: sideskift
    assert.ok(r.haendelser.includes('sideskift'));
    assert.equal(st.player1.name, 'Carl', 'Carl/Dorte står nu i player1');
    assert.equal(st.team1RightCourt, modtagerHoejre, 'samme spiller i højre servefelt som før sideskiftet');
    // Serveparret: serveren i højre felt ved lige point (8)
    assert.equal(st.servingTeam, 2);
    assert.equal(st.team2RightCourt, st.servingPlayerOnTeam);
    // Fortryd giver pladserne fra før sideskiftet tilbage
    regler.fortryd(st);
    assert.equal(st.player1.name, 'Anna');
    assert.equal(st.team2RightCourt, modtagerHoejre);
});

test('29: reglementet står i koden, og mellem sæt er pladserne som før (parrene vælger selv, § 11.6)', () => {
    const kilde = laes('frontend/js/taeller-regler.js');
    assert.match(kilde, /§ 11\.1\.5/);
    assert.match(kilde, /skiftSider\(st, \{ midtISaet: true \}\)/);
    const st = regler.nyKamp({ navne: { p1: 'Anna', p1b: 'Bo', p2: 'Carl', p2b: 'Dorte' }, isDoubles: true });
    st.team1RightCourt = 1; st.team2RightCourt = 2;
    regler.skiftSider(st);
    assert.deepEqual([st.team1RightCourt, st.team2RightCourt], [1, 2], 'mellem sæt: uændret fra før pakke J');
});

// ======================= Nr. 69: QR-telefonens "Ny kamp" =======================

test('69: QR-telefonens "Ny kamp" spørger først; den faste tablet rydder direkte', () => {
    const kilde = laes('frontend/court-script-v3.js');
    assert.match(kilde, /callback: \(\) => \(isMatchSessionToken\(\) \? bekraeftNyKampQr\(isReportedMatch\) : performClearCourtNow\(\)\)/);
    const fn = udsnit(kilde, 'function bekraeftNyKampQr(isReportedMatch) {', '// Ved indlæsning:');
    const sb = { kaldt: [], showMessage(titel, tekst, knapper) { sb.dialog = { titel, tekst, knapper }; },
        performClearCourtNow() { sb.kaldt.push('ryd'); }, showMatchWonMessage(r) { sb.kaldt.push('kampslut:' + r); } };
    vm.createContext(sb);
    vm.runInContext(fn + '\nthis.bekraeftNyKampQr = bekraeftNyKampQr;', sb);
    sb.bekraeftNyKampQr(false);
    assert.equal(sb.dialog.titel, 'Ny kamp?');
    assert.match(sb.dialog.tekst, /logges ud/);
    assert.deepEqual([...sb.dialog.knapper.map(k => k.text)], ['Ja, ryd banen', 'Annuller']);
    assert.deepEqual(sb.kaldt, [], 'intet ryddes, før der svares');
    sb.dialog.knapper[1].callback();
    assert.deepEqual(sb.kaldt, ['kampslut:false'], 'Annuller: kampslut-dialogen igen (ingen død tavle)');
    sb.dialog.knapper[0].callback();
    assert.deepEqual(sb.kaldt, ['kampslut:false', 'ryd']);
});

// ======================= Nr. 70: urets link med en død kode =======================

test('70: den gemte kobling bruges kun til linkets egen bane', () => {
    const kilde = laes('frontend/ur-script.js');
    const fn = udsnit(kilde, 'function kanBrugeGemtKobling(', 'async function kobl(');
    const sb = { gemt: {} };
    vm.createContext(sb);
    vm.runInContext('var gemt = this.gemt;\n' + fn + '\nthis.kan = kanBrugeGemtKobling; this.tekst = linkKodeUdloebet; this.saet = (g) => { gemt = g; };', sb);
    sb.saet({ token: 't', bane: 5 });
    assert.equal(sb.kan(true, 5), true, 'samme bane: uret er stadig på banen');
    assert.equal(sb.kan(true, 3), false, 'linket er til bane 3, uret til bane 5');
    assert.equal(sb.kan(true, null), false, 'ældre link uden bane: kan ikke afgøres');
    assert.equal(sb.kan(false, 5), false, 'tastet kode: aldrig');
    sb.saet({ token: null, bane: 5 });
    assert.equal(sb.kan(true, 5), false, 'ingen gemt kobling');
    assert.match(sb.tekst(3), /bane 3/);
    // Linket bærer banen, og uret læser den
    assert.match(laes('frontend/court-script-v3.js'), /\/ur\.html\?k=\$\{urKode\}&b=\$\{courtId\}/);
    assert.match(kilde, /const linkBane = \/\^\\d\{1,2\}\$\/\.test\(linkParam\.get\('b'\) \|\| ''\) \? Number\(linkParam\.get\('b'\)\) : null;/);
    assert.match(kilde, /visKode\(fraLink \? linkKodeUdloebet\(linkBane\) :/);
});
