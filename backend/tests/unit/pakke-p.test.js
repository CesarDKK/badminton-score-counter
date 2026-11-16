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
        status(s) { this.statusKode = s; return this; }, json(j) { this.krop = j; return this; } };
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
