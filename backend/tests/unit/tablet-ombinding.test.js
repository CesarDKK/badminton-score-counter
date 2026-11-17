/**
 * Tabletten binder om, når admin bytter banens turneringskamp før der er talt,
 * og slipper kampen, når banen ikke har en turneringskamp mere (rest af nr. 105).
 * Turnerings-synken fra serverSyncTick og funktionerne omkring
 * applyTournamentMatchToCourt hentes ud af court-script-v3.js og køres i en
 * vm-sandkasse med en falsk api og de rigtige regler (nulstilKamp → nyKamp).
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROD = path.join(__dirname, '..', '..', '..');
const KILDE = fs.readFileSync(path.join(ROD, 'frontend/court-script-v3.js'), 'utf8');
const regler = require('../../taeller/regler');

function udsnit(kilde, fra, til) {
    const a = kilde.indexOf(fra);
    assert.ok(a >= 0, `markøren findes: ${fra}`);
    const b = kilde.indexOf(til, a + fra.length);
    assert.ok(b > a, `slutmarkøren findes: ${til}`);
    return kilde.slice(a, b);
}

const KODE = [
    udsnit(KILDE, 'function nulstilKamp(', '// Overtag banens tilstand fra serveren'),
    udsnit(KILDE, 'function kampStartet() {', '// Holdenes navne for en delkamp'),
    udsnit(KILDE, 'function sideOrientering(', '// Delkampen banen er bundet til'),
    udsnit(KILDE, 'function turneringSideNavne(match) {', 'async function reportTournamentResult('),
    // Synkens turneringsdel (resten af serverSyncTick, til dens afsluttende }) som sin egen funktion
    'async function turneringsSync(checkAssignments) {\n' + turneringsdel() + '\n}'
].join('\n');

function turneringsdel() {
    const del = udsnit(KILDE, '// Tournament sync: detect', '// Setup editable player name');
    return del.slice(0, del.lastIndexOf('}'));
}

const SINGLE = { id: 11, label: 'HS 1', doubles: 0, court_number: 5, status: 'active', side1_player1: 'Gustav', side2_player1: 'Holger' };
const DOUBLE = { id: 12, label: 'MD 1', doubles: 1, court_number: 5, status: 'active',
    side1_player1: 'Ida', side1_player2: 'Jens', side2_player1: 'Karen', side2_player2: 'Lars' };
const turnering = (...matches) => [{ id: 3, name: 'Lyngby', matches }];
const tomBane = () => ({ matchStartTime: null, version: 9, isDoubles: false, gameMode: '15',
    player1: { name: 'Spiller 1', name2: 'Makker 1', score: 0, games: 0 },
    player2: { name: 'Spiller 2', name2: 'Makker 2', score: 0, games: 0 } });

// En tablet på bane 5, bundet til `bundet` (som efter en første tildeling)
function tablet({ bundet = null, paaBanen = [], server = tomBane() } = {}) {
    const sb = {
        TaellerRegler: regler, courtId: 5, console,
        gameState: { ...regler.nyKamp({ gameMode: '15' }), version: 4, timerInterval: null, sidesManuallySwitched: false },
        paaBanen, server, qr: false,
        gemt: 0, vist: 0, kald: [],
        api: {
            getTournamentForCourt: async () => sb.paaBanen,
            getGameState: async () => JSON.parse(JSON.stringify(sb.server))
        }
    };
    vm.createContext(sb);
    vm.runInContext(`
        var serMed = false, _kampSlutVist = false, _fortsaetSpoerges = false;
        var isSaving = false, pendingSave = false, saveTimeout = null;
        var resultForm = { open: false };
        var assignedHoldkampGameId = null, assignedTournamentMatchId = null, activeTournament = null;
        function isMatchSessionToken() { return qr; }
        function updateDisplay() { vist++; }
        function saveGameState() { gemt++; }
        function runServerSync(grund) { kald.push('sync:' + grund); }
        async function adoptServerReset(loaded) {
            kald.push('reset');
            nulstilKamp({ navne: { p1: loaded.player1.name, p1b: loaded.player1.name2, p2: loaded.player2.name, p2b: loaded.player2.name2 },
                isDoubles: loaded.isDoubles || false });
            gameState.version = loaded.version;
            assignedTournamentMatchId = null; activeTournament = null;
        }
    ` + KODE, sb);
    if (bundet) {
        sb.assignedTournamentMatchId = bundet.id;
        sb.activeTournament = turnering(bundet)[0];
        sb.applyTournamentMatchToCourt(bundet);
        sb.gemt = 0;
    }
    return sb;
}
const navne = (gs) => [gs.player1.name, gs.player1.name2, gs.player2.name, gs.player2.name2];

test('single byttes til double før der er talt: tabletten binder om med navne, double og bedst af 3', async () => {
    const t = tablet({ bundet: SINGLE, paaBanen: turnering(DOUBLE) });
    t.gameState.setsToWin = 1;
    t.gameState.sidesManuallySwitched = true;
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, 12);
    assert.equal(t.activeTournament.id, 3);
    assert.equal(t.gameState.isDoubles, true);
    assert.deepEqual(navne(t.gameState), ['Ida', 'Jens', 'Karen', 'Lars']);
    assert.equal(t.gameState.setsToWin, 2);
    assert.equal(t.gameState.isActive, true);
    assert.equal(t.gameState.sidesManuallySwitched, false);
    assert.equal(t.gameState.version, 4, 'versionen er stadig tablettens (409 håndteres som før)');
    assert.equal(t.gemt, 1);
});

test('double byttes til single: ingen gammel makker bliver hængende', async () => {
    const t = tablet({ bundet: DOUBLE, paaBanen: turnering(SINGLE) });
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, 11);
    assert.equal(t.gameState.isDoubles, false);
    assert.deepEqual(navne(t.gameState), ['Gustav', 'Makker 1', 'Holger', 'Makker 2']);
    // Også ved point-events (checkAssignments falsk) — en bundet tablet tjekker altid
    const t2 = tablet({ bundet: DOUBLE, paaBanen: turnering(SINGLE) });
    await t2.turneringsSync(false);
    assert.equal(t2.assignedTournamentMatchId, 11);
});

const IKKE_I_RO = {
    'kampen er startet': (t) => { t.gameState.matchStartTime = Date.now(); },
    'der er et point': (t) => { t.gameState.player2.score = 1; },
    'der er et sæt': (t) => { t.gameState.player1.games = 1; },
    'sæthistorik': (t) => { t.gameState.setScoresHistory = [{ score: '15-3' }]; },
    'kampen er afgjort': (t) => { t.gameState.matchCompleted = true; },
    'pause': (t) => { t.gameState.restBreakActive = true; },
    'ser med': (t) => { t.serMed = true; },
    'QR-session': (t) => { t.qr = true; },
    'kamp vundet-dialogen vises': (t) => { t._kampSlutVist = true; },
    '"Fortsæt kampen?" spørges': (t) => { t._fortsaetSpoerges = true; },
    'resultatformularen er åben': (t) => { t.resultForm.open = true; },
    'egen gemning i gang': (t) => { t.isSaving = true; },
    'egen gemning venter': (t) => { t.pendingSave = true; },
    'egen gemning planlagt': (t) => { t.saveTimeout = 1; }
};

test('tabletten binder ikke om, når den ikke står i ro', async () => {
    for (const [hvad, saet] of Object.entries(IKKE_I_RO)) {
        const t = tablet({ bundet: SINGLE, paaBanen: turnering(DOUBLE) });
        saet(t);
        await t.turneringsSync(true);
        assert.equal(t.assignedTournamentMatchId, 11, `${hvad}: stadig bundet til den gamle kamp`);
        assert.equal(t.gameState.isDoubles, false, `${hvad}: single/double uændret`);
        // Den nye kamps navne skrives heller ikke over den gamle (før: navnene fulgte med)
        assert.deepEqual([t.gameState.player1.name, t.gameState.player2.name], ['Gustav', 'Holger'], `${hvad}: navnene uændret`);
    }
});

test('banen har ingen turneringskamp mere (W.O. og ryddet): kampen slippes, banen står tom', async () => {
    const t = tablet({ bundet: DOUBLE, paaBanen: [] });
    await t.turneringsSync(false);   // ryddet → 'reset'-event
    assert.deepEqual(t.kald, ['reset']);
    assert.equal(t.assignedTournamentMatchId, null);
    assert.equal(t.activeTournament, null);
    assert.equal(t.gameState.isDoubles, false);
    assert.deepEqual(navne(t.gameState), ['Spiller 1', 'Makker 1', 'Spiller 2', 'Makker 2']);
    assert.equal(t.gameState.version, 9, 'serverens version — ingen 409 ved næste gemning');
});

test('kampen taget af, men banen ikke tom på serveren: koblingen slippes, synken overtager banen', async () => {
    const server = tomBane();
    server.player1.score = 3;   // en anden enhed har talt
    const t = tablet({ bundet: SINGLE, paaBanen: turnering(), server });
    await t.turneringsSync(true);
    assert.deepEqual(t.kald, ['sync:poll']);
    assert.equal(t.assignedTournamentMatchId, null);
    assert.deepEqual(navne(t.gameState), ['Gustav', 'Makker 1', 'Holger', 'Makker 2'], 'navnene røres ikke her');
});

test('kampen slippes ikke, når tabletten ikke står i ro', async () => {
    for (const [hvad, saet] of Object.entries(IKKE_I_RO)) {
        const t = tablet({ bundet: SINGLE, paaBanen: [] });
        saet(t);
        await t.turneringsSync(true);
        assert.equal(t.assignedTournamentMatchId, 11, `${hvad}: stadig bundet`);
        assert.deepEqual(t.kald, [], `${hvad}: intet hentet eller nulstillet`);
    }
    // Bliver tabletten optaget, mens banen hentes, gøres intet
    const t = tablet({ bundet: SINGLE, paaBanen: [] });
    t.api.getGameState = async () => { t.pendingSave = true; return tomBane(); };
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, 11);
    assert.deepEqual(t.kald, []);
});

test('det almindelige forløb (to kampe i træk) rører aldrig den nye kode', async () => {
    const t = tablet({ paaBanen: [] });
    const nye = [];
    t.bindOmTilTurneringskamp = () => nye.push('bindOm');
    t.slipTurneringskamp = async () => { nye.push('slip'); };
    // Ingen tildeling endnu: point-events henter slet ikke turneringen
    await t.turneringsSync(false);
    await t.turneringsSync(true);
    // Kamp 1 sættes på — første binding som før
    t.paaBanen = turnering(SINGLE);
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, 11);
    assert.deepEqual(navne(t.gameState).filter((n, i) => i % 2 === 0), ['Gustav', 'Holger']);
    // Admin retter et navn før start: samme kamp, navnet følges som før
    t.paaBanen = turnering({ ...SINGLE, side2_player1: 'Holger B' });
    await t.turneringsSync(true);
    assert.equal(t.gameState.player2.name, 'Holger B');
    // Kampen tælles
    t.gameState.matchStartTime = Date.now();
    t.gameState.player1.score = 7;
    await t.turneringsSync(false);
    t.gameState.player1.games = 1;
    await t.turneringsSync(false);
    // Kampslut: saveMatchResult glemmer kampen, serveren har den som 'finished'
    t.gameState.matchCompleted = true;
    t.assignedTournamentMatchId = null;
    t.paaBanen = [];
    await t.turneringsSync(true);
    // "Ryd banen", og kamp 2 sættes på
    Object.assign(t.gameState, regler.nyKamp({ gameMode: '15' }));
    t.paaBanen = turnering(DOUBLE);
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, 12);
    assert.equal(t.gameState.isDoubles, true);
    assert.deepEqual(nye, [], 'hverken ombinding eller slip i det almindelige forløb');
});

test('en anden kamps afgjorte resultat på tabletten: den ventende kamp bindes først efter "Ryd banen"', async () => {
    // Kampen blev talt færdig, mens admin havde sat en ny kamp på banen
    // (saveMatchResult har glemt koblingen) — før kom den nye kamps navne og
    // double hen over resultatet
    const t = tablet({ paaBanen: turnering(DOUBLE) });
    Object.assign(t.gameState, { matchStartTime: Date.now(), matchCompleted: true });
    t.gameState.player1.name = 'Ærø'; t.gameState.player2.name = 'Øvig'; t.gameState.player2.games = 2;
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, null);
    assert.deepEqual([t.gameState.player1.name, t.gameState.player2.name, t.gameState.isDoubles], ['Ærø', 'Øvig', false]);
    assert.equal(t.gemt, 0);
    // "Ryd banen" → bindes
    Object.assign(t.gameState, regler.nyKamp({ gameMode: '15' }));
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, 12);
    // Genindlæst efter kampens egen afslutning (samme navne): bindes som før (nr. 71)
    const r = tablet({ paaBanen: turnering(DOUBLE) });
    Object.assign(r.gameState, { matchStartTime: Date.now(), matchCompleted: true, isDoubles: true });
    Object.assign(r.gameState.player1, { name: 'Karen', name2: 'Lars', games: 0 });
    Object.assign(r.gameState.player2, { name: 'Ida', name2: 'Jens', games: 2 });
    await r.turneringsSync(true);
    assert.equal(r.assignedTournamentMatchId, 12);
    assert.deepEqual(navne(r.gameState), ['Karen', 'Lars', 'Ida', 'Jens'], 'navnene bliver, hvor de står');
});

test('holdkamp-bundet bane: turneringsdelen springes over som før', async () => {
    const t = tablet({ bundet: SINGLE, paaBanen: turnering(DOUBLE) });
    t.assignedHoldkampGameId = 77;
    await t.turneringsSync(true);
    assert.equal(t.assignedTournamentMatchId, 11);
});

// ---------- Serveren: "Start kamp" uden point er en kamp i gang (tildelingsvagten) ----------

test('tildelingsvagten: en startet kamp ved 0-0 er i gang; force virker altid; holdkampens banenErIGang er uændret', () => {
    const baneTildeling = require('../../config/baneTildeling');
    const { banenErIGang } = require('../../config/delkampRegler');
    const nul = { player1_score: 0, player2_score: 0, player1_games: 0, player2_games: 0, timer_seconds: 0, match_completed: 0 };
    const startet = { ...nul, match_start_time: new Date() };
    const forladt = { ...nul, match_start_time: new Date(Date.now() - 2 * 24 * 3600 * 1000) };
    assert.equal(baneTildeling.kampKoerer(startet), true);
    assert.equal(baneTildeling.tildelingAfvist({ stilling: startet }).code, 'bane_i_gang');
    assert.equal(baneTildeling.tildelingAfvist({ stilling: forladt }).code, 'bane_i_gang');
    assert.equal(baneTildeling.tildelingAfvist({ stilling: forladt, force: true }), null, 'force virker altid');
    assert.equal(baneTildeling.tildelingAfvist({ stilling: startet, sammeBane: true }), null);
    // Uden starttid som før; en afsluttet kamp ryddes som før
    assert.equal(baneTildeling.tildelingAfvist({ stilling: { ...nul, match_start_time: null } }), null);
    assert.equal(baneTildeling.tildelingAfvist({ stilling: { ...startet, player1_games: 2, match_completed: 1 } }), null);
    // banenErIGang (holdkampens egne regler) er urørt
    assert.equal(banenErIGang(startet), false);
    // Stillingen hentes med starttiden
    const kilde = fs.readFileSync(path.join(ROD, 'backend/config/baneTildeling.js'), 'utf8');
    assert.match(udsnit(kilde, 'function banensStilling(', '\n}'), /gs\.match_start_time/);
});
