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
