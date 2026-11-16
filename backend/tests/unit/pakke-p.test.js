/**
 * Pakke P — tællerens og livestreamens pålidelighed (gennemgangen nov. 2026):
 *   89   ingen gemning uden versionstjek skriver en gammel stilling tilbage
 *   4    (resten) en stillestående kamp slettes ikke uden spor
 *   38   udsendelsen sættes live ca. et minut efter billedet kom
 *   40   LIVE-mærket følger YouTubes status, ikke PC'ens
 *   42   tests af ytStyr og POST /pc
 *
 * Ingen database og ingen Google: config/database.js (og config/youtube.js)
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

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-pakke-p-mindst-32-tegn';
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

// ---------- Falsk database (før ruterne indlæses — de destrukturerer query) ----------
const db = require('../../config/database');
let svar = async () => [];
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };

const gameStates = require('../../routes/gameStates');

// SET-delens "kolonne = ?" i rækkefølge, parret med parametrene
function saetVaerdier(sql, params) {
    const set = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
    const kol = [...set.matchAll(/(\w+) = \?/g)].map(m => m[1]);
    return Object.fromEntries(kol.map((k, i) => [k, params[i]]));
}

// ======================= Nr. 89: gemninger uden versionstjek =======================

// En kamp i gang i andet sæt: 1-0 i sæt, 7-5, siderne byttet, double-serv midt i
function koerendeKamp(ekstra = {}) {
    return {
        court_id: 7, version: 12,
        player1_name: 'Anna', player1_name2: 'Bo', player1_score: 7, player1_games: 1,
        player2_name: 'Carl', player2_name2: 'Dorte', player2_score: 5, player2_games: 0,
        timer_seconds: 640, match_start_time: '2026-11-16 10:00:00', match_end_time: null, match_completed: 0,
        set_scores_history: JSON.stringify([{ score: '15-11' }]),
        serving_player: 1, initial_server: 2, serving_team: 1, serving_player_on_team: 2,
        team1_right_court: 2, team2_right_court: 1, between_sets: 0,
        sides_swapped: 1, sides_manually_switched: 0, sets_to_win: 2,
        rest_break_active: 0, rest_break_started_at: null, rest_break_duration: 60,
        taeller_id: 'tablet-1', ...ekstra
    };
}

test('89: admins navnerettelse under en kørende kamp rører ikke stillingen (kun navne, intet versionstjek nødvendigt)', async () => {
    const raekke = koerendeKamp();
    nulstil(async (sql) => {
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 7, is_active: 1, is_doubles: 1, game_mode: '15' }];
        if (/SELECT \* FROM game_states/.test(sql)) return [raekke];
        if (/SELECT version FROM game_states/.test(sql)) return [{ version: 13 }];
        if (/^\s*(UPDATE|DELETE|INSERT)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
    // Præcis det, Rediger bane i admin sender (admin-script.js saveCourtChanges)
    const r = await gameStates.gemTilstand({}, 3, {
        player1: { name: 'Anna Ny', name2: 'Bo' },
        player2: { name: 'Carl', name2: 'Dorthe' }
    }, { skipAutoActive: true });
    assert.equal(r.status, 200);

    const k = kald.find(x => /^\s*UPDATE game_states SET\s+player1_name/.test(x.sql));
    assert.ok(k, 'rækken er skrevet');
    assert.doesNotMatch(k.sql, /AND version = \?/, 'ingen versionstjek — og intet behov for det');
    const v = saetVaerdier(k.sql, k.params);
    assert.equal(v.player1_name, 'Anna Ny');
    assert.equal(v.player2_name2, 'Dorthe');
    // Stillingen er rækkens egen — ikke noget, admin havde på skærmen
    assert.equal(v.player1_score, 7);
    assert.equal(v.player2_score, 5);
    assert.equal(v.player1_games, 1);
    assert.equal(v.timer_seconds, 640);
    assert.equal(v.set_scores_history, raekke.set_scores_history);
    assert.equal(v.serving_team, 1);
    assert.equal(v.serving_player_on_team, 2);
    assert.equal(v.team1_right_court, 2);
    assert.equal(v.sides_swapped, true);
    // Hverken start- eller sluttid nulstilles, og tælleren slippes ikke
    assert.match(k.sql, /match_start_time = COALESCE\(match_start_time, NOW\(\)\)/);
    assert.match(k.sql, /match_end_time = match_end_time/);
    assert.ok(!kald.some(x => /taeller_id = NULL/.test(x.sql)), 'tælleren beholder banen');
});

test('89: Rediger bane og turneringstildelingen i admin sender kun navne', () => {
    const kilde = laes('frontend/admin-script.js');
    const gem = udsnit(kilde, 'const updatedState = {', '};');
    assert.doesNotMatch(gem, /score|games|\.\.\./);
    const turnering = udsnit(kilde, 'await api.updateCourt(bane, { isActive: true, isDoubles: !!m.doubles });', '}, true);');
    assert.doesNotMatch(turnering, /score|games|\.\.\./);
});

// admin-script.js: delkampPaaBaneKrop i en sandkasse med de rigtige holdkamp-regler
function delkampKrop() {
    const kilde = laes('frontend/admin-script.js');
    const kode = udsnit(kilde, 'function delkampPaaBaneKrop(', '\nasync function assignCourtToGame(');
    const HoldkampFormater = require('../../../frontend/js/holdkamp-formater.js');
    const ctx = { HoldkampFormater, DOUBLES_CATEGORIES: HoldkampFormater.DOUBLE_KATEGORIER };
    vm.createContext(ctx);
    vm.runInContext(kode + '\nthis.delkampPaaBaneKrop = delkampPaaBaneKrop;', ctx);
    return ctx.delkampPaaBaneKrop;
}

test('89: en delkamp sat på banen sender kun den nye kamp og banens version', () => {
    const krop = delkampKrop();
    // Banen, som admin læste den: forrige kamps golden set og byttede sider
    const laest = {
        version: 7, gameMode: '15', sidesSwapped: true, sidesManuallySwitched: true, setsToWin: 1,
        restBreakDuration: 120, taeller: { navn: 'Tablet' }, lastFinishedMatch: { id: 1 }, livestream: { live: true },
        player1: { name: 'Gammel', score: 0, games: 0 }, player2: { name: 'Gammel', score: 0, games: 0 }
    };
    const k = krop({ category: 'HD', team1_player1: 'Anna', team1_player2: 'Bo', team2_player1: 'Carl', team2_player2: 'Dorte' },
        { team1_name: 'Lyngby', team2_name: 'Holte' }, laest);
    assert.equal(k.expectedVersion, 7, 'versionen fra læsningen — 409, hvis tabletten har skrevet imellem');
    assert.deepEqual({ ...k.player1 }, { name: 'Anna', name2: 'Bo', score: 0, games: 0 });
    assert.equal(k.isDoubles, true);
    assert.equal(k.setsToWin, 2);
    assert.equal(k.sidesSwapped, false, 'forrige kamps sidebytte følger ikke med');
    assert.equal(k.sidesManuallySwitched, false);
    assert.equal(k.gameMode, '15');
    for (const felt of ['taeller', 'lastFinishedMatch', 'livestream', 'restBreakDuration', 'version']) {
        assert.ok(!(felt in k), `${felt} sendes ikke med tilbage`);
    }
    // Golden set-delkamp: ét sæt
    assert.equal(krop({ category: 'GS', team1_player1: 'A', team2_player1: 'B' }, { team1_name: 'X', team2_name: 'Y' }, null).setsToWin, 1);
    // Tom bane (GET svarer version 0 uden række)
    assert.equal(krop({ category: 'HS' }, { team1_name: 'X', team2_name: 'Y' }, { version: 0 }).expectedVersion, 0);
});

test('89: en 409 fra delkamp-tildelingen efterlader banen til tabletten', () => {
    const kilde = laes('frontend/admin-script.js');
    const tildel = udsnit(kilde, 'async function assignCourtToGame(', '\nfunction toggleEditGame(');
    assert.doesNotMatch(tildel, /\.\.\.\(currentState/);
    assert.match(tildel, /api\.updateGameState\(courtNumber, delkampPaaBaneKrop\(game, teamMatch, currentState\)\)/);
    assert.match(tildel, /if \(e\.status !== 409\) throw e;/);
});

test('89: serveren afviser en gemning med forældet version uden at skrive', async () => {
    nulstil(async (sql) => {
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 7, is_active: 1, is_doubles: 1, game_mode: '15' }];
        if (/SELECT \* FROM game_states/.test(sql)) return [koerendeKamp()];
        return { affectedRows: 1 };
    });
    const r = await gameStates.gemTilstand({}, 3, {
        player1: { name: 'Anna', score: 0, games: 0 }, player2: { name: 'Carl', score: 0, games: 0 },
        matchStartTime: null, timerSeconds: 0, expectedVersion: 7 });
    assert.equal(r.status, 409);
    assert.equal(r.json.state.player1.score, 7, 'svaret har banens stilling');
    assert.ok(!kald.some(x => /^\s*UPDATE game_states/.test(x.sql)), 'intet skrevet');
});

// court-script-v3.js: navneEfterKonflikt
function navneEfterKonflikt() {
    const kilde = laes('frontend/court-script-v3.js');
    const kode = udsnit(kilde, 'function navneEfterKonflikt(', '\nasync function handleSaveConflict(');
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(kode + '\nthis.f = navneEfterKonflikt;', ctx);
    return ctx.f;
}

test('89: tabletten beholder admins navnerettelse efter en 409 — også i andet sæt', () => {
    const f = navneEfterKonflikt();
    const lokal = (byttet) => ({
        sidesSwapped: byttet,
        player1: byttet ? { name: 'Carl', name2: 'Dorte', games: 0 } : { name: 'Anna', name2: 'Bo', games: 1 },
        player2: byttet ? { name: 'Anna', name2: 'Bo', games: 1 } : { name: 'Carl', name2: 'Dorte', games: 0 }
    });
    // Samme orientering på server og tablet (andet sæt, siderne byttet begge steder)
    let n = f(lokal(true), { sidesSwapped: true,
        player1: { name: 'Carl', name2: 'Dorthe' }, player2: { name: 'Anna Ny', name2: 'Bo' } });
    assert.equal(n.player1.name2, 'Dorthe');
    assert.equal(n.player2.name, 'Anna Ny');
    // Tabletten har byttet side, men gemningen nåede ikke serveren, før admin rettede
    n = f(lokal(true), { sidesSwapped: false,
        player1: { name: 'Anna Ny', name2: 'Bo' }, player2: { name: 'Carl', name2: 'Dorthe' } });
    assert.equal(n.player1.name, 'Carl', 'navnene følger tablettens sider');
    assert.equal(n.player1.name2, 'Dorthe');
    assert.equal(n.player2.name, 'Anna Ny');
    // Intet at adoptere
    assert.equal(f(lokal(false), null), null);
});

test('89: tablettens 409-håndtering bruger navneEfterKonflikt og har ikke længere sætgrænsen', () => {
    const kilde = laes('frontend/court-script-v3.js');
    const h = udsnit(kilde, 'async function handleSaveConflict(', '\nasync function adoptServerReset(');
    assert.match(h, /navneEfterKonflikt\(gameState, server\)/);
    assert.doesNotMatch(h, /player1\.games > 0/);
});

// ======================= Rest af nr. 4: en frigivet kamp gemmes først =======================

const scheduler = require('../../scheduler');

// Rutens sidste handler (forbi auth-middleware) køres med et falsk req/res
function rute(router, metode, sti) {
    const lag = router.stack.find(l => l.route && l.route.path === sti && l.route.methods[metode]);
    assert.ok(lag, `${metode.toUpperCase()} ${sti} findes`);
    const handlers = lag.route.stack;
    return handlers[handlers.length - 1].handle;
}
async function koer(handler, req) {
    const res = { statusKode: 200, krop: null,
        status(s) { this.statusKode = s; return this; }, json(j) { this.krop = j; return this; }, set() { return this; } };
    let fejl = null;
    await handler(req, res, (e) => { fejl = e; });
    if (fejl) throw fejl;
    return res;
}

function frigivDb({ raekke = koerendeKamp(), gemFejler = false, slettet = 1 } = {}) {
    nulstil(async (sql) => {
        if (/FROM courts c\s+JOIN game_states gs/.test(sql)) return [{ id: 7, court_number: 3 }];
        if (/planner_court_assignments/.test(sql)) return [];
        if (/SELECT \* FROM game_states WHERE court_id/.test(sql)) return raekke ? [raekke] : [];
        if (/INSERT INTO frigivne_kampe/.test(sql)) {
            if (gemFejler) { const e = new Error('Table doesn\'t exist'); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
            return { affectedRows: 1 };
        }
        if (/DELETE FROM game_states/.test(sql)) return { affectedRows: slettet };
        return { affectedRows: 1 };
    });
}
const sqlIndeks = (re) => kald.findIndex(k => re.test(k.sql));

test('4: scheduleren gemmer kampen i frigivne_kampe, før den slettes — og kun den gemte version', async () => {
    frigivDb();
    await scheduler.releaseInactiveCourts('test');
    const valg = kald[0].sql;
    assert.match(valg, /updated_at < NOW\(\) - INTERVAL 20 MINUTE/, '20 minutter (før 10)');
    assert.match(valg, /taeller_set_at < UTC_TIMESTAMP\(\) - INTERVAL 20 MINUTE/);

    const gem = sqlIndeks(/INSERT INTO frigivne_kampe/);
    const slet = sqlIndeks(/DELETE FROM game_states/);
    assert.ok(gem >= 0 && slet > gem, 'gemt før sletning');
    const data = JSON.parse(kald[gem].params[1]);
    assert.equal(data.player1_score, 7);
    assert.equal(data.player1_games, 1);
    assert.match(kald[slet].sql, /WHERE court_id = \? AND version = \?/);
    assert.deepEqual(kald[slet].params, [7, 12]);
    assert.ok(sqlIndeks(/UPDATE courts SET is_active = FALSE/) > slet, 'banen frigives bagefter');
    assert.ok(sqlIndeks(/DELETE FROM device_tokens/) > slet);
});

test('4: kan kampen ikke gemmes, eller kom et point imellem, bliver banen stående', async () => {
    frigivDb({ gemFejler: true });
    await scheduler.releaseInactiveCourts('test');
    assert.equal(sqlIndeks(/DELETE FROM game_states/), -1, 'intet slettet uden spor');
    assert.equal(sqlIndeks(/UPDATE courts SET is_active = FALSE/), -1);

    frigivDb({ slettet: 0 });   // versionen var en anden: tabletten gemte imellem
    await scheduler.releaseInactiveCourts('test');
    assert.ok(sqlIndeks(/DELETE FROM game_states/) >= 0);
    assert.equal(sqlIndeks(/UPDATE courts SET is_active = FALSE/), -1, 'banen er stadig i brug');
    assert.equal(sqlIndeks(/DELETE FROM device_tokens/), -1);
});

test('4: midnats-nulstillingen og "Ryd banen" rydder de frigivne kampe', async () => {
    nulstil(async () => ({ affectedRows: 0 }));
    await scheduler.resetDatabase('test');
    assert.ok(sqlIndeks(/^DELETE FROM frigivne_kampe$/) >= 0);

    nulstil(async (sql) => {
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 7, is_doubles: 0 }];
        if (/SELECT \* FROM game_states/.test(sql)) return [];
        return { affectedRows: 1 };
    });
    const res = await koer(rute(gameStates, 'delete', '/:courtId'), { params: { courtId: '3' }, user: { admin: true }, body: {} });
    assert.equal(res.statusKode, 200);
    const k = kald.find(x => /DELETE FROM frigivne_kampe WHERE court_id = \?/.test(x.sql));
    assert.ok(k, 'den frigivne kamp er glemt');
    assert.deepEqual(k.params, [7]);
});

test('4: en tom bane viser den frigivne kamp (højst 24 timer), en bane i brug gør ikke', async () => {
    const gemt = JSON.stringify(koerendeKamp());
    const getDb = (medRaekke) => nulstil(async (sql) => {
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 7, is_active: 0, is_doubles: 1, game_mode: '15' }];
        if (/FROM game_states WHERE court_id/.test(sql)) return medRaekke ? [koerendeKamp()] : [];
        if (/FROM frigivne_kampe/.test(sql)) return [{ data: gemt, frigivet_at: new Date('2026-11-16T10:30:00Z') }];
        return [];
    });
    getDb(false);
    let res = await koer(rute(gameStates, 'get', '/:courtId'), { params: { courtId: '3' }, query: {} });
    const f = res.krop.frigivetKamp;
    assert.ok(f, 'frigivetKamp er med');
    assert.match(kald.find(x => /FROM frigivne_kampe/.test(x.sql)).sql, /frigivet_at > NOW\(\) - INTERVAL 24 HOUR/);
    assert.deepEqual(f.player1, { name: 'Anna', name2: 'Bo', score: 7, games: 1 });
    assert.equal(f.taeller.kort, 'tablet-1');
    assert.deepEqual(Object.keys(f).sort(), ['frigivetAt', 'matchStartTime', 'player1', 'player2', 'setScoresHistory', 'taeller']);
    assert.equal(res.krop.player1.score, 0, 'selve banen er tom');

    getDb(true);
    res = await koer(rute(gameStates, 'get', '/:courtId'), { params: { courtId: '3' }, query: {} });
    assert.ok(!('frigivetKamp' in res.krop));
    assert.ok(!kald.some(x => /frigivne_kampe/.test(x.sql)), 'ikke slået op, når banen er i brug');

    // Før migration 051: banen er bare tom
    nulstil(async (sql) => {
        if (/FROM frigivne_kampe/.test(sql)) { const e = new Error('nej'); e.code = 'ER_NO_SUCH_TABLE'; throw e; }
        return [];
    });
    assert.equal(await gameStates.hentFrigivetKamp({ id: 7 }), null);
});

// court-script-v3.js: tablettens "Fortsæt kampen?" i en sandkasse
function tomBaneSandkasse({ lokal, serMed = false } = {}) {
    const kilde = laes('frontend/court-script-v3.js');
    const kode = udsnit(kilde, '// ---- Rest af nr. 4:', '// Banen er nulstillet på serveren');
    const log = [];
    const overlay = { style: { display: 'none' } };
    const titel = { textContent: '' };
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Date, setTimeout: (fn) => log.push('setTimeout'), clearTimeout() {},
        TAELLER_ID: 'tablet-1-abcdef', courtId: 3,
        gameState: lokal, serMed, saveTimeout: null, pendingSave: false, isSaving: false,
        _fortsaetSpoerges: false, lastOwnSaveAt: 0,
        isMatchSessionToken: () => false,
        document: { getElementById: (id) => (id === 'messageOverlay' ? overlay : id === 'messageTitle' ? titel : null) },
        showMessage(t, tekst, knapper) { titel.textContent = t; overlay.style.display = 'flex'; log.push({ t, tekst, knapper }); },
        adoptServerReset: async (l) => { log.push('reset'); },
        buildSavePayload: () => ({ player1: lokal.player1, player2: lokal.player2, expectedVersion: lokal.version, matchStartTime: undefined }),
        setSyncStatus() {}, updateDisplay() {}, applyLoadedState: (s) => log.push({ anvendt: s }), performSave() {},
        api: {
            gemt: [],
            svar: { success: true, version: 1 },
            async updateGameState(bane, krop) { this.gemt.push(krop); if (this.svar instanceof Error) throw this.svar; return this.svar; },
            async getGameState() { return { player1: { score: 0 }, player2: { score: 0 }, version: 0 }; }
        }
    };
    vm.createContext(ctx);
    vm.runInContext(kode, ctx);
    return { ctx, log, overlay };
}
const lokalKamp = () => ({
    matchStartTime: Date.parse('2026-11-16T10:00:00Z'), matchCompleted: false, isDoubles: true, version: 12,
    player1: { name: 'Carl', name2: 'Dorte', score: 5, games: 0 },
    player2: { name: 'Anna', name2: 'Bo', score: 7, games: 1 }
});
const frigivet = (ekstra = {}) => ({ player1: { name: 'Anna', name2: 'Bo', score: 6, games: 1 }, player2: { name: 'Carl', name2: 'Dorte', score: 5, games: 0 }, taeller: null, ...ekstra });

test('4: tabletten spørger "Fortsæt kampen?" og gemmer sin kamp med den oprindelige starttid', async () => {
    const { ctx, log } = tomBaneSandkasse({ lokal: lokalKamp() });
    const spurgt = await ctx.haandterTomBane({ player1: { score: 0 }, frigivetKamp: frigivet() });
    assert.equal(spurgt, true);
    const dialog = log.find(x => x.t);
    assert.equal(dialog.t, 'Fortsæt kampen?');
    assert.match(dialog.tekst, /Carl \/ Dorte  5 – 7  Anna \/ Bo/, 'tablettens egen stilling (siderne byttet)');
    assert.deepEqual([...dialog.knapper.map(k => k.text)], ['Fortsæt kampen', 'Ny kamp']);
    assert.ok(!log.includes('reset'), 'kampen er ikke nulstillet');
    assert.equal(ctx._fortsaetSpoerges, true);
    // Synken kommer forbi igen, mens dialogen står fremme: ét spørgsmål
    assert.equal(await ctx.haandterTomBane({ frigivetKamp: frigivet() }), true);
    assert.equal(log.filter(x => x.t).length, 1);

    await dialog.knapper[0].callback();
    assert.equal(ctx.api.gemt.length, 1);
    const krop = ctx.api.gemt[0];
    assert.equal(krop.expectedVersion, 0, 'en ny række');
    assert.equal(krop.matchStartTime, '2026-11-16T10:00:00.000Z');
    assert.equal(krop.player2.score, 7);
    assert.equal(ctx.gameState.version, 1);
    assert.equal(ctx._fortsaetSpoerges, false);
    assert.equal(ctx.isSaving, false);
});

test('4: "Ny kamp" nulstiller, og en anden enheds kamp på banen overskrives ikke', async () => {
    let s = tomBaneSandkasse({ lokal: lokalKamp() });
    await s.ctx.haandterTomBane({ frigivetKamp: frigivet() });
    await s.log.find(x => x.t).knapper[1].callback();
    assert.ok(s.log.includes('reset'));
    assert.equal(s.ctx.api.gemt.length, 0);

    s = tomBaneSandkasse({ lokal: lokalKamp() });
    const fejl = new Error('konflikt'); fejl.status = 409; fejl.body = { state: { player1: { name: 'Ny', score: 2 } } };
    s.ctx.api.svar = fejl;
    await s.ctx.haandterTomBane({ frigivetKamp: frigivet() });
    await s.log.find(x => x.t).knapper[0].callback();
    assert.deepEqual(s.log.find(x => x.anvendt).anvendt.player1, { name: 'Ny', score: 2 }, 'tabletten følger banens nye kamp');
    assert.equal(s.ctx.api.gemt.length, 1, 'intet genforsøg oven i den');
});

test('4: uden frigivet kamp (admin ryddede banen) eller med en anden kamp nulstilles som før', async () => {
    let s = tomBaneSandkasse({ lokal: lokalKamp() });
    assert.equal(await s.ctx.haandterTomBane({ player1: { score: 0 } }), false);
    assert.ok(s.log.includes('reset'));

    // Andre spillere og en anden tæller: ikke tablettens kamp
    s = tomBaneSandkasse({ lokal: lokalKamp() });
    await s.ctx.haandterTomBane({ frigivetKamp: frigivet({ player1: { name: 'Eva' }, player2: { name: 'Finn' }, taeller: { kort: 'andenenh' } }) });
    assert.ok(s.log.includes('reset'));

    // Samme tæller, selv om navnene er rettet siden
    s = tomBaneSandkasse({ lokal: lokalKamp() });
    assert.equal(await s.ctx.haandterTomBane({ frigivetKamp: frigivet({ player1: { name: 'Eva' }, taeller: { kort: 'tablet-1' } }) }), true);

    // En tablet, der kun ser med, spørger ikke
    s = tomBaneSandkasse({ lokal: lokalKamp(), serMed: true });
    assert.equal(await s.ctx.haandterTomBane({ frigivetKamp: frigivet() }), false);
});

test('4: synken og 409-håndteringen går gennem haandterTomBane, og gemning venter på svaret', () => {
    const kilde = laes('frontend/court-script-v3.js');
    assert.match(kilde, /if \(wasReset && gameState\.matchStartTime && !ownSaveRacing\(\)\) \{[\s\S]{0,200}if \(await haandterTomBane\(loaded\)\) return;/);
    const h = udsnit(kilde, 'async function handleSaveConflict(', '\n// ---- Rest af nr. 4:');
    assert.match(h, /await haandterTomBane\(fresh\)/);
    const gem = udsnit(kilde, 'async function performSave() {', 'isSaving = true;');
    assert.match(gem, /if \(fortsaetDialogVises\(\)\) \{ pendingSave = false; return; \}/);
});

// ======================= Livestream: POST /pc og ytStyr med en falsk YouTube =======================
// Én PC på bane 3, der spørger, som Badman TV gør (hvert par sekunder), og en
// falsk YouTube, der husker kaldene. Uret er falsk (Date.now), og databasen
// husker banens court_streams-række, så forløbet kan følges over minutter.

process.env.YOUTUBE_DIREKTE = '1';   // YouTube-delen kører i direct mode i testen
const ls = require('../../screens/livestream');
const youtube = require('../../config/youtube');
const youtubeKvote = require('../../config/youtubeKvote');
const { krypter } = require('../../config/hemmelig');
const livestream = require('../../routes/livestream');

const SEK = 1000;
const MIN = 60 * SEK;
const NU = 1_800_000_000_000;   // 2027-01-15 kl. 09:00 dansk tid

// Falsk YouTube
let yt;
function nyYoutube(status = 'ready') {
    yt = { status, kald: [], nr: 0, fejl: {} };
}
const ytFejl = (grund, status = 403) => new youtube.YoutubeFejl(`YouTube: ${grund}`, { status, grund });
youtube.konfigureret = () => true;
youtube.adgangsToken = async () => 'token';
youtube.opretStream = async () => {
    yt.kald.push('opretStream');
    if (yt.fejl.opretStream) throw yt.fejl.opretStream;
    return { id: 's1', url: 'rtmp://a.rtmp.youtube.com/live2', noegle: 'yt-noegle' };
};
youtube.opretUdsendelse = async () => {
    yt.kald.push('opretUdsendelse');
    if (yt.fejl.opretUdsendelse) throw yt.fejl.opretUdsendelse;
    yt.nr += 1;
    return `b${yt.nr}`;
};
youtube.udsendelsesStatus = async (token, id) => {
    yt.kald.push(`status:${id}`);
    if (yt.fejl.status) throw yt.fejl.status;
    return yt.status;
};
youtube.gaaLive = async (token, id) => {
    yt.kald.push(`gaaLive:${id}`);
    if (yt.fejl.gaaLive) throw yt.fejl.gaaLive;
    yt.status = 'live';
};
youtube.afslut = async (token, id) => { yt.kald.push(`afslut:${id}`); return 'afsluttet'; };

// Falsk ur
const aegteNu = Date.now;
let klokke = NU;
const medUr = (fn) => async () => {
    Date.now = () => klokke;
    try { await fn(); } finally { Date.now = aegteNu; }
};

// UPDATE court_streams SET a = ?, b = UTC_TIMESTAMP(), c = NULL WHERE … → rækken
function anvendSet(sql, params, raekke) {
    const set = sql.slice(sql.indexOf('SET') + 3, sql.lastIndexOf('WHERE'));
    let i = 0;
    for (const del of set.split(',')) {
        const m = /^\s*(\w+)\s*=\s*([\s\S]+?)\s*$/.exec(del);
        if (!m) continue;
        const [, kol, v] = m;
        if (v === '?') raekke[kol] = params[i++];
        else if (/UTC_TIMESTAMP\(\)|NOW\(\)/.test(v)) raekke[kol] = new Date(Date.now());
        else if (v === 'NULL') raekke[kol] = null;
    }
}

// Banens verden: court_streams-rækken (hele dagen, så banen skal sende) og
// klubbens forbundne YouTube-kanal
function lsVerden(cs = {}, { kanal = true } = {}) {
    const v = {
        cs: {
            court_number: 3, enabled: 1, stream_key: null, stream_url: null, overlay: 0, logo: null,
            yt_stream_id: null, yt_ingest_url: null, yt_stream_key: null,
            yt_broadcast_id: null, yt_broadcast_start: null, yt_broadcast_tjek: null, yt_fejl: null, yt_fejl_tid: null,
            all_day_until: new Date(NU + 12 * 60 * MIN), armed_until: null, manual_since: null, holdkamp_stop_until: null,
            ...cs
        }
    };
    nulstil(async (sql, params) => {
        if (/FROM device_tokens WHERE token = \?/.test(sql)) {
            return [{ id: 9, camera_court: 3, camera_manual: 1, camera_device: null, destination: 'tv/3', token_type: 'permanent' }];
        }
        if (/FROM livestream_youtube/.test(sql)) return kanal ? [{ id: 1, refresh_token: krypter('r'), fejl: null, kanal_navn: 'Klubben' }] : [];
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 33, is_doubles: 0 }];
        if (/FROM court_streams WHERE court_number/.test(sql) || /FROM court_streams\s*$/.test(sql)) return [{ ...v.cs }];
        if (/^\s*UPDATE court_streams SET/.test(sql)) { anvendSet(sql, params, v.cs); return { affectedRows: 1 }; }
        if (/^\s*(UPDATE|INSERT|DELETE)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
    ls._nulstilStatus();
    livestream._ytPauseTil.clear();
    youtubeKvote.nulstil({ gem: false });
    return v;
}

// PC'en spørger: sender den allerede?
async function pcSpoerger(sender) {
    const req = {
        accessMode: 'direct', headers: {}, socket: { remoteAddress: '10.0.0.3' },
        get: (h) => (h.toLowerCase() === 'x-adgangslink' ? 'pc-token-bane3' : undefined),
        body: { navn: 'tv3', kamera: 'C920', sender }
    };
    return (await koer(rute(livestream, 'post', '/pc'), req)).krop;
}

// PC'en spørger hvert 5. sekund fra nu til nu + ms (sender hele tiden)
async function sendI(ms, trin = 5 * SEK) {
    const slut = klokke + ms;
    while (klokke < slut) {
        klokke += trin;
        await pcSpoerger(true);
    }
}
const tidFor = (re) => yt.tider.filter(([, k]) => re.test(k)).map(([t]) => t);

// Husk, hvornår hvert YouTube-kald skete
function medTider() {
    yt.tider = [];
    const push = yt.kald.push.bind(yt.kald);
    yt.kald.push = (k) => { yt.tider.push([klokke, k]); return push(k); };
}

// ======================= Nr. 38: første tjek efter et minut =======================

test('38: opret → (ca. 1 min billede) → tjek + gaaLive → (30 s: er den live? nr. 40) → (5 min) → tjek', medUr(async () => {
    klokke = NU;
    lsVerden();
    nyYoutube('ready');      // YouTube går ikke live af sig selv (enableAutoStart svigtede)
    medTider();

    // PC'en er klar, men sender ikke: nøgle og udsendelse oprettes, nøglen sendes
    const r = await pcSpoerger(false);
    assert.equal(r.send, true);
    assert.equal(r.noegle, 'yt-noegle');
    assert.deepEqual(yt.kald.slice(), ['opretStream', 'opretUdsendelse']);
    const billede = klokke + 5 * SEK;   // PC'en melder "sender" ved næste forespørgsel

    await sendI(7 * MIN);
    const live = tidFor(/^gaaLive:b1$/);
    assert.equal(live.length, 1, 'sat live én gang');
    const efterBillede = live[0] - billede;
    assert.ok(efterBillede >= 60 * SEK && efterBillede <= 70 * SEK,
        `sat live ca. et minut efter billedet kom (${efterBillede / SEK} s) — før gik der over 5 minutter`);

    // Bagefter: ét tjek efter 30 s, der ser den live (til LIVE-mærket, nr. 40),
    // og så først efter 5 minutter
    const tjek = tidFor(/^status:b1$/);
    const efterLive = tjek.filter(t => t > live[0]);
    assert.ok(efterLive.length >= 2, 'tjekket igen');
    assert.equal(efterLive[0] - live[0], 30 * SEK, 'bekræftet live efter 30 s');
    assert.ok(efterLive[1] - efterLive[0] >= 5 * MIN && efterLive[1] - efterLive[0] <= 5 * MIN + 5 * SEK,
        `næste tjek efter 5 min (${(efterLive[1] - efterLive[0]) / SEK} s)`);
    // Ventetiden kostede få kald: tjek hvert halve minut, kun indtil den var live
    assert.ok(tjek.filter(t => t <= live[0]).length <= 4, `få tjek før live (${tjek.filter(t => t <= live[0]).length})`);
    assert.equal(yt.kald.filter(k => k === 'opretUdsendelse').length, 1);
}));

test('38: går udsendelsen live af sig selv, sættes den ikke live, og der tjekkes hvert 5. minut', medUr(async () => {
    klokke = NU;
    lsVerden();
    nyYoutube('live');
    medTider();
    await pcSpoerger(false);
    await sendI(11 * MIN);
    assert.equal(tidFor(/^gaaLive/).length, 0);
    const tjek = tidFor(/^status:b1$/);
    // Det tvungne tjek, da billedet kom, og derefter hvert 5. minut
    assert.equal(tjek.length, 3, `tjek: ${tjek.map(t => (t - NU) / SEK).join(', ')} s`);
    assert.ok(tjek[1] - tjek[0] >= 5 * MIN && tjek[2] - tjek[1] >= 5 * MIN);
}));

test('38: ytNaesteTjek — 30 s, mens den venter de første 5 minutter, ellers 5 minutter', () => {
    const start = NU - 2 * MIN;
    const om = (status, s) => ls.ytNaesteTjek(status, s, NU).getTime() - (NU - ls.YT_TJEK_MS);
    assert.equal(om('ready', start), 30 * SEK);
    assert.equal(om('testing', start), 30 * SEK);
    assert.equal(om('live', start), 5 * MIN);
    assert.equal(om('ready', NU - 6 * MIN), 5 * MIN, 'går den aldrig live, tjekkes der ikke hvert halve minut hele dagen');
    assert.equal(om('ready', null), 5 * MIN);
    assert.equal(ls.ytTjekOm(ls.YT_FOERSTE_TJEK_MS, NU).getTime(), NU - ls.YT_TJEK_MS + MIN);
    // ytHandling giver 'tjek', præcis når tiden er gået
    const tjek = ls.ytNaesteTjek('ready', start, NU);
    assert.equal(ls.ytHandling({ send: true, udsendelse: 'b1', tjek, nu: NU + 29 * SEK }), null);
    assert.equal(ls.ytHandling({ send: true, udsendelse: 'b1', tjek, nu: NU + 30 * SEK }), 'tjek');
});

// ======================= Nr. 40: LIVE efter YouTubes status =======================

test('40: YouTubes status gemmes fra tjekket (ingen ekstra kald) — LIVE først, når YouTube er live', medUr(async () => {
    klokke = NU;
    const v = lsVerden();
    nyYoutube('ready');
    await pcSpoerger(false);
    assert.equal(v.cs.yt_broadcast_id, 'b1');
    assert.equal(v.cs.yt_status, null, 'ukendt, indtil den er tjekket');

    klokke += 5 * SEK;
    await pcSpoerger(true);                 // det tvungne tjek: 'ready'
    assert.equal(v.cs.yt_status, 'ready');
    const live = async () => {
        klokke += 4 * SEK;   // forbi /live's cache på 3 s
        const res = await koer(rute(livestream, 'get', '/live'), { accessMode: 'direct', headers: {}, get: () => undefined });
        return res.krop.baner.find(b => b.bane === 3);
    };
    assert.equal((await live()).live, false, '/live: Starter …');
    const tablet = () => ls.tabletStatus({ opsaetning: v.cs, kamera: true, pc: { online: true, sender: true, kamera: 'C920' }, youtube: true, nu: klokke });
    assert.equal(tablet().youtube, 'starter');

    await sendI(70 * SEK);                  // 60 s billede: sat live → 'liveStarting'
    assert.ok(yt.kald.includes('gaaLive:b1'));
    assert.equal(v.cs.yt_status, 'liveStarting');
    assert.equal(tablet().youtube, 'starter');
    await sendI(30 * SEK);                  // tjekket efter 30 s ser den live
    assert.equal(v.cs.yt_status, 'live');
    assert.equal(tablet().youtube, 'live');
    assert.equal((await live()).live, true, '/live: LIVE');

    // Afsluttet i Studio: glemt, og en ny udsendelse starter forfra som "Starter …"
    yt.status = 'complete';
    await sendI(5 * MIN + 5 * SEK);
    assert.equal(v.cs.yt_broadcast_id, 'b2');
    assert.ok(v.cs.yt_status !== 'live');
    assert.equal(tablet().youtube, 'starter');
    const opkald = yt.kald.filter(k => /^status:/.test(k)).length;
    assert.ok(opkald <= 10, `kun de tjek, der var i forvejen (${opkald})`);
}));

test('40: uden forbundet kanal (egen nøgle) er LIVE som før — PC\'en sender', () => {
    const status = { 9: { online: true, sender: true, skalSende: true, bane: 3, tavle: null } };
    const udsendelser = new Map([[3, null]]);
    assert.equal(ls.liveBaner(status, udsendelser)[0].live, true);
    assert.equal(ls.liveBaner(status, udsendelser, { kanal: false, ytStatus: new Map([[3, 'ready']]) })[0].live, true);
    // Med kanal: kun YouTubes 'live' — og kun mens banen har en udsendelse
    const medId = new Map([[3, 'abcdefghijk']]);
    assert.equal(ls.liveBaner(status, medId, { kanal: true, ytStatus: new Map([[3, 'live']]) })[0].live, true);
    assert.equal(ls.liveBaner(status, medId, { kanal: true, ytStatus: new Map([[3, 'ready']]) })[0].live, false);
    assert.equal(ls.liveBaner(status, udsendelser, { kanal: true, ytStatus: new Map([[3, 'live']]) })[0].live, false);

    const t = (o) => ls.tabletStatus({ opsaetning: { enabled: 1, stream_key: 'egen', ...o }, kamera: true, pc: null, youtube: false });
    assert.equal(t({ yt_broadcast_id: 'b1', yt_status: 'ready' }).youtube, null);
});

test('40: tablettens knap — "●" og live-farven kun, når YouTube er live', () => {
    const kilde = laes('frontend/court-script-v3.js');
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(udsnit(kilde, 'function livestreamKnapTekst(', '\n// Bekræftelsen før') + '\nthis.f = livestreamKnapTekst;', ctx);
    const k = (l) => ({ ...ctx.f(l) });
    assert.deepEqual(k({ start: 'valgt', youtube: 'live' }), { tekst: '● Stop livestream', live: true });
    assert.deepEqual(k({ start: 'valgt', youtube: 'starter' }), { tekst: 'Livestream starter … — stop', live: false });
    assert.deepEqual(k({ start: 'hele-dagen', youtube: 'starter' }), { tekst: 'Livestream starter (hele dagen) …', live: false });
    assert.deepEqual(k({ start: null, holdkamp: true, youtube: 'starter' }), { tekst: 'Livestream: holdkampen starter …', live: false });
    assert.deepEqual(k({ start: null, holdkamp: true, youtube: 'live' }), { tekst: '● Livestream: holdkampen sendes', live: true });
    // Uden kanal (youtube: null) som før
    assert.deepEqual(k({ start: 'valgt', youtube: null }), { tekst: '● Stop livestream', live: true });
    assert.deepEqual(k({ start: 'klar', youtube: 'starter' }), { tekst: 'Livestream venter på kampen — fortryd', live: true });
    assert.deepEqual(k({ start: null, holdkamp: false, youtube: 'starter' }), { tekst: 'Start livestream', live: false });

    const live = laes('frontend/live-script.js');
    assert.match(live, /maerke\.textContent = live \? 'LIVE' : 'Starter …';/);
    assert.match(laes('frontend/live-styles.css'), /\.live-maerke--starter \{[^}]*var\(--color-warning-rgb\)/);
    assert.match(laes('frontend/live.html'), /live-script\.js\?v=2/);
    assert.match(laes('backend/migrations/052_yt_status.sql'), /ALTER TABLE court_streams ADD COLUMN yt_status VARCHAR\(20\) NULL/);
});

// ======================= Nr. 42: ytStyr og POST /pc =======================

test('42: første forespørgsel opretter stream-nøgle og udsendelse og sender til YouTubes nøgle', medUr(async () => {
    klokke = NU;
    const v = lsVerden({ stream_key: 'egen-noegle', stream_url: 'rtmp://egen' });
    nyYoutube('ready');
    const r = await pcSpoerger(false);
    assert.deepEqual(yt.kald.slice(), ['opretStream', 'opretUdsendelse']);
    assert.equal(r.send, true);
    assert.equal(r.url, 'rtmp://a.rtmp.youtube.com/live2', 'kanalens nøgle går forud for den indtastede');
    assert.equal(r.noegle, 'yt-noegle');
    assert.equal(v.cs.yt_stream_key, 'yt-noegle');
    assert.equal(v.cs.yt_broadcast_id, 'b1');
    assert.ok(v.cs.yt_broadcast_start instanceof Date);
    assert.ok(kald.some(k => /INSERT IGNORE INTO yt_udsendelser/.test(k.sql)), 'udsendelsen huskes (nr. 12C)');

    // Næste forespørgsel: intet nyt hos YouTube (nøglen er gemt, tjekket er om et minut)
    klokke += 3 * SEK;
    const r2 = await pcSpoerger(false);
    assert.equal(yt.kald.length, 2);
    assert.equal(r2.noegle, 'yt-noegle');
}));

test('42 (nr. 5): dagens kvote brugt op — intet oprettes, send:false med grund youtube-fejl, og pause', medUr(async () => {
    klokke = NU;
    const v = lsVerden();
    nyYoutube('ready');
    youtubeKvote.tael(0, { opbrugt: true, nu: klokke });
    const r = await pcSpoerger(false);
    assert.deepEqual(yt.kald.slice(), [], 'ingen kald til YouTube');
    assert.equal(r.send, false);
    assert.equal(r.grund, 'youtube-fejl');
    assert.match(v.cs.yt_fejl, /kvote for i dag er brugt op/);
    assert.ok(livestream._ytPauseTil.get('direct:3') >= klokke + ls.YT_KVOTE_PAUSE_MS - SEK, 'en times pause for banen');

    // Med en indtastet nøgle sendes der stadig — dertil
    lsVerden({ stream_key: 'egen-noegle', stream_url: 'rtmp://egen' });
    youtubeKvote.tael(0, { opbrugt: true, nu: klokke });
    const r2 = await pcSpoerger(false);
    assert.equal(r2.send, true);
    assert.equal(r2.noegle, 'egen-noegle');
    assert.deepEqual(yt.kald.slice(), []);
}));

test('42 (nr. 5): med kvoten brugt op tjekkes og afsluttes en kørende udsendelse stadig', medUr(async () => {
    klokke = NU;
    const v = lsVerden({ yt_stream_key: 'yt-noegle', yt_ingest_url: 'rtmp://yt', yt_broadcast_id: 'b7',
        yt_broadcast_start: new Date(NU - 20 * MIN), yt_broadcast_tjek: new Date(NU - 6 * MIN), yt_status: 'live' });
    nyYoutube('live');
    youtubeKvote.tael(0, { opbrugt: true, nu: klokke });
    const r = await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), ['status:b7']);
    assert.equal(r.send, true);
    assert.equal(r.noegle, 'yt-noegle');

    v.cs.all_day_until = new Date(NU - MIN);    // banen holder op
    klokke += 3 * SEK;
    const r2 = await pcSpoerger(true);
    assert.ok(yt.kald.includes('afslut:b7'));
    assert.equal(r2.send, false);
    assert.equal(v.cs.yt_broadcast_id, null);
}));

test('42: fejlpausen gælder alle handlinger — opret, tjek og afslut', medUr(async () => {
    // Opret: banen sender, men YouTube fejlede for et minut siden
    klokke = NU;
    let v = lsVerden({ yt_stream_key: 'yt-noegle', yt_ingest_url: 'rtmp://yt', yt_fejl: 'YouTube nede', yt_fejl_tid: new Date(NU - MIN) });
    nyYoutube('ready');
    let r = await pcSpoerger(false);
    assert.deepEqual(yt.kald.slice(), []);
    assert.equal(r.send, true, 'den gemte nøgle bruges stadig — en fejl stopper aldrig streamen');
    // … efter de to minutter prøves der igen
    klokke += 61 * SEK;
    await pcSpoerger(false);
    assert.deepEqual(yt.kald.slice(), ['opretUdsendelse']);

    // Tjek: forfaldent, men i pause
    klokke = NU;
    v = lsVerden({ yt_stream_key: 'yt-noegle', yt_ingest_url: 'rtmp://yt', yt_broadcast_id: 'b7',
        yt_broadcast_tjek: new Date(NU - 10 * MIN), yt_fejl_tid: new Date(NU - MIN) });
    nyYoutube('ready');
    await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), []);

    // Afslut: banen holder op, men i pause
    v.cs.all_day_until = new Date(NU - MIN);
    r = await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), []);
    assert.equal(r.send, false);
    assert.equal(v.cs.yt_broadcast_id, 'b7', 'afsluttes efter pausen');

    // Den lange pause (i hukommelsen) efter en varig fejl
    v.cs.yt_fejl_tid = null;
    livestream._ytPauseTil.set('direct:3', NU + 30 * MIN);
    klokke += 5 * MIN;
    await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), []);
    klokke = NU + 31 * MIN;
    await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), ['afslut:b7']);
}));

test('42: en varig fejl ved oprettelsen gemmes på banen og giver en lang pause — streamen fortsætter', medUr(async () => {
    klokke = NU;
    const v = lsVerden();
    nyYoutube('ready');
    yt.fejl.opretUdsendelse = ytFejl('liveStreamingNotEnabled');
    const r = await pcSpoerger(false);
    assert.deepEqual(yt.kald.slice(), ['opretStream', 'opretUdsendelse']);
    assert.equal(v.cs.yt_stream_key, 'yt-noegle', 'nøglen fra før fejlen er gemt');
    assert.match(v.cs.yt_fejl, /liveStreamingNotEnabled/);
    assert.ok(v.cs.yt_fejl_tid instanceof Date);
    assert.ok(livestream._ytPauseTil.get('direct:3') >= NU + ls.YT_VARIG_PAUSE_MS - SEK);
    assert.equal(r.send, true);
    assert.equal(r.noegle, 'yt-noegle');
    // Ingen nye forsøg i pausen, selv hvert 3. sekund
    for (let i = 0; i < 20; i++) { klokke += 3 * SEK; await pcSpoerger(true); }
    assert.equal(yt.kald.length, 2);
}));

test('42: tjek → afsluttet i Studio → glemt, og en ny udsendelse oprettes', medUr(async () => {
    klokke = NU;
    const v = lsVerden({ yt_stream_key: 'yt-noegle', yt_ingest_url: 'rtmp://yt', yt_stream_id: 's1', yt_broadcast_id: 'b7',
        yt_broadcast_start: new Date(NU - 30 * MIN), yt_broadcast_tjek: new Date(NU - 5 * MIN), yt_status: 'live' });
    nyYoutube('complete');
    yt.nr = 7;
    await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), ['status:b7']);
    assert.equal(v.cs.yt_broadcast_id, null);
    klokke += 3 * SEK;
    await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), ['status:b7', 'opretUdsendelse']);
    assert.equal(v.cs.yt_broadcast_id, 'b8');
    assert.equal(v.cs.yt_status, null);
}));

test('42: banen holder op — udsendelsen afsluttes, og PC\'en får send:false', medUr(async () => {
    klokke = NU;
    const v = lsVerden({ yt_stream_key: 'yt-noegle', yt_ingest_url: 'rtmp://yt', yt_broadcast_id: 'b7',
        yt_broadcast_start: new Date(NU - 30 * MIN), yt_broadcast_tjek: new Date(NU - MIN), yt_status: 'live',
        all_day_until: new Date(NU - SEK) });
    nyYoutube('live');
    const r = await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), ['afslut:b7']);
    assert.equal(r.send, false);
    assert.equal(v.cs.yt_broadcast_id, null);
    assert.equal(v.cs.yt_stream_key, 'yt-noegle', 'stream-nøglen genbruges næste gang');
    // Bagefter: intet mere hos YouTube
    klokke += 3 * SEK;
    await pcSpoerger(false);
    assert.equal(yt.kald.length, 1);
}));

test("42: POST /pc — tvingTjek, når PC'en begynder at sende; senderNu først efter 60 s billede", medUr(async () => {
    klokke = NU;
    const v = lsVerden({ yt_stream_key: 'yt-noegle', yt_ingest_url: 'rtmp://yt', yt_broadcast_id: 'b7',
        yt_broadcast_start: new Date(NU - 2 * MIN), yt_broadcast_tjek: new Date(NU) });
    nyYoutube('ready');
    // PC'en har spurgt uden at sende: tjekket er ikke forfaldent — intet kald
    await pcSpoerger(false);
    assert.deepEqual(yt.kald.slice(), []);
    // Den begynder at sende: tvunget tjek (lever udsendelsen?), men ikke gaaLive endnu
    klokke += 3 * SEK;
    await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), ['status:b7']);
    // Sender videre: intet tvunget tjek ved hver forespørgsel
    klokke += 3 * SEK;
    await pcSpoerger(true);
    assert.equal(yt.kald.length, 1);
    // 33 s billede: tjekket kommer (30 s-rytmen), men ikke gaaLive
    klokke = NU + 3 * SEK + 33 * SEK;
    await pcSpoerger(true);
    assert.deepEqual(yt.kald.slice(), ['status:b7', 'status:b7']);
    // Holder PC'en op med at sende, sættes den ikke live
    klokke = NU + 3 * SEK + 66 * SEK;
    await pcSpoerger(false);
    assert.ok(!yt.kald.some(k => /^gaaLive/.test(k)));
    // Sender igen: nyt tvunget tjek, og senderSiden starter forfra
    klokke += 3 * SEK;
    await pcSpoerger(true);
    assert.equal(yt.kald.at(-1), 'status:b7');
    assert.ok(!yt.kald.some(k => /^gaaLive/.test(k)), 'ikke live på billede fra før pausen');
    await sendI(100 * SEK);   // 60 s: gaaLive, 30 s efter: bekræftet live
    const live = yt.kald.indexOf('gaaLive:b7');
    assert.ok(live > 0, 'sat live efter 60 s billede');
    assert.equal(v.cs.yt_status, 'live');
}));

test("42: POST /pc — ukendt eller tilbagekaldt adgangslink, og en PC uden bane", medUr(async () => {
    klokke = NU;
    lsVerden();
    nyYoutube('ready');
    const handler = rute(livestream, 'post', '/pc');
    const req = (token) => ({ accessMode: 'direct', headers: {}, socket: {}, get: () => token, body: { kamera: 'C920' } });
    assert.equal((await koer(handler, req(undefined))).statusKode, 401);
    nulstil(async () => []);
    assert.equal((await koer(handler, req('tilbagekaldt-link'))).statusKode, 403);
    // Demoen (eller en ukendt vært) har ingen PC-rute
    assert.equal((await koer(handler, { ...req('pc-token-bane3'), accessMode: 'landing' })).statusKode, 404);
    assert.deepEqual(yt.kald.slice(), []);
}));

// ======================= Rettelse A (rest af nr. 4): en frigivet kamp glemmes =======================
// Forløbet, der ikke må kunne ske: bane 3 frigives (tablet T), T vælger
// "Fortsæt", tæller videre; senere sættes en turneringskamp på banen (rækken
// slettes), og T's synk ser en tom bane + den gamle frigivne kamp med sit eget
// tæller-id → "Fortsæt kampen?" → den gamle kamp oven på den nye tildeling.

const baneTildeling = require('../../config/baneTildeling');
const banerydning = require('../../config/banerydning');

// Database med hukommelse for banens game_states-række og frigivne_kampe
function frigivetVerden({ raekke = null } = {}) {
    const v = { gs: raekke, frigivne: new Map([[7, { data: JSON.stringify(koerendeKamp()), frigivet_at: new Date() }]]) };
    nulstil(async (sql, params) => {
        if (/FROM courts WHERE court_number/.test(sql)) return [{ id: 7, court_number: 3, is_active: 0, is_doubles: 1, game_mode: '15' }];
        if (/DELETE FROM frigivne_kampe WHERE court_id = \?/.test(sql)) { v.frigivne.delete(params[0]); return { affectedRows: 1 }; }
        if (/FROM frigivne_kampe/.test(sql)) { const r = v.frigivne.get(params[0]); return r ? [r] : []; }
        if (/INSERT INTO game_states/.test(sql)) { v.gs = koerendeKamp({ version: 1 }); return { affectedRows: 1 }; }
        if (/DELETE FROM game_states/.test(sql)) { v.gs = null; return { affectedRows: 1 }; }
        if (/FROM game_states WHERE court_id/.test(sql)) return v.gs ? [v.gs] : [];
        if (/^\s*(UPDATE|INSERT|DELETE)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
    return v;
}
const tomBaneGet = async () => (await koer(rute(gameStates, 'get', '/:courtId'), { params: { courtId: '3' }, query: {} })).krop;

test('A: "Fortsæt kampen" (en ny række) glemmer den frigivne kamp — den tilbydes ikke igen', async () => {
    const v = frigivetVerden();
    assert.ok((await tomBaneGet()).frigivetKamp, 'før: tilbydes på den tomme bane');
    const r = await gameStates.gemTilstand({}, 3, {
        player1: { name: 'Carl', name2: 'Dorte', score: 5, games: 0 }, player2: { name: 'Anna', name2: 'Bo', score: 7, games: 1 },
        matchStartTime: '2026-11-16T10:00:00.000Z', expectedVersion: 0, taellerId: 'tablet-1-abcdef' });
    assert.equal(r.status, 200);
    assert.equal(v.frigivne.size, 0, 'rækken i frigivne_kampe er væk');
    // Turneringskampen sættes på banen (tjekOgRydBane → afbrydKamp): tom bane, intet tilbud
    await baneTildeling.afbrydKamp(3, {});
    assert.equal(v.gs, null);
    assert.ok(!('frigivetKamp' in await tomBaneGet()), 'tabletten får ikke "Fortsæt kampen?" om den gamle kamp');
});

test('A: rydning og tildeling glemmer den frigivne kamp — alle steder, game_states slettes med vilje', async () => {
    // Afbrudt af en tildeling (baneTildeling.afbrydKamp)
    let v = frigivetVerden({ raekke: koerendeKamp() });
    await baneTildeling.afbrydKamp(3, {});
    assert.equal(v.frigivne.size, 0);
    assert.ok(!('frigivetKamp' in await tomBaneGet()));

    // En afsluttet kamp ryddet ved en ny delkamp (banerydning.rydAfsluttetBane)
    v = frigivetVerden({ raekke: koerendeKamp({ match_completed: 1, player1_games: 2 }) });
    assert.equal(await banerydning.rydAfsluttetBane(3, {}), true);
    assert.equal(v.frigivne.size, 0);
    assert.ok(!('frigivetKamp' in await tomBaneGet()));

    // Admin/tablet "Ryd banen" (DELETE-ruten)
    v = frigivetVerden({ raekke: koerendeKamp() });
    await koer(rute(gameStates, 'delete', '/:courtId'), { params: { courtId: '3' }, user: { admin: true }, body: {} });
    assert.equal(v.frigivne.size, 0);

    // Planneren (navne på banen / ryd banen) og skjulte baner (Antal baner)
    const planner = laes('backend/routes/plannerIntegration.js');
    assert.match(udsnit(planner, 'async function visNavne(', '\n}'), /DELETE FROM game_states[^\n]*\n\s*await glemFrigivetKamp\(court\.id\)/);
    assert.match(udsnit(planner, 'async function rydBane(', '\n}'), /DELETE FROM game_states[^\n]*\n\s*await glemFrigivetKamp\(court\.id\)/);
    assert.match(laes('backend/routes/settings.js'), /DELETE fk FROM frigivne_kampe fk JOIN courts c ON c\.id = fk\.court_id WHERE c\.court_number > \?/);
    // Scheduleren er den eneste, der sletter game_states og lader rækken stå
    assert.doesNotMatch(udsnit(laes('backend/scheduler.js'), 'async function releaseInactiveCourts(', '\nfunction startInactivityCheck('), /glemFrigivetKamp/);
});

test('A: en almindelig gemning på en eksisterende række rører ikke frigivne_kampe', async () => {
    const v = frigivetVerden({ raekke: koerendeKamp() });
    await gameStates.gemTilstand({}, 3, { player1: { score: 8 } });
    assert.equal(v.frigivne.size, 1);
    assert.ok(!kald.some(k => /frigivne_kampe/.test(k.sql)));
});
