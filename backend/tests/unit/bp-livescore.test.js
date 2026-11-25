/**
 * Unit-tests: livescore til badmintonplayer.dk for holdkampe (migration 057) —
 * Jesper 2026-11-23, Badminton Danmark har sagt god for det.
 *
 * Modellen herunder har samme form som badmintonplayers svar på
 * GET /api/LeagueMatch/{kampnr}?password=&isLiveScore=true (navnene er opdigtede).
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bpl = require('../../config/bpLivescore');

const HJEM = 124802, UDE = 124800;
const sp = (hold, idx, navn, playerId, clubId) => ({
    disciplineCode: 'X', leagueGroupTeamId: hold, playerId, playerIndex: idx,
    player: { clubId, name: navn, gender: 'K' },
});
const ctm = (nr, id, kode, hjem, ude) => ({
    matchIndex: nr, individualMatchIndex: 0, leagueMatchIndividualMatchId: id, disciplineCode: kode,
    teamPlayers: {
        [HJEM]: hjem.map(([n, pid], i) => sp(HJEM, i, n, pid, 1087)),
        [UDE]: ude.map(([n, pid], i) => sp(UDE, i, n, pid, 27)),
    },
    leagueMatchSet: [],
});
const MODEL = {
    match: {
        leagueMatchId: 516284, leagueGroupTeamId1: HJEM, leagueGroupTeamId2: UDE,
        teamName1: 'Hjemme 5', teamName2: 'Ude 5', venueId: 424,
        liveScore: true, liveScoreEnabled: true, liveScoreCode: '1234',
    },
    combinedTeamMatches: [
        ctm(1, 2418930, 'WomensDoubles', [['Anna Hansen', 1], ['Bea Holm', 2]], [['Cia Ude', 11], ['Dora Ude', 12]]),
        ctm(2, 2418923, 'WomensDoubles', [['Eva Lund', 3], ['Fie Berg', 4]], [['Gry Ude', 13], ['Hanne Ude', 14]]),
        ctm(5, 2418926, 'WomensSingles', [['Anna Hansen', 1]], [['Dora Ude', 12]]),
        ctm(6, 2418927, 'WomensSingles', [['Bea Holm', 2]], [['Gry Ude', 13]]),
    ],
};
const g = (id, game_number, t1, t2) => ({
    id, game_number, team1_player1: t1[0], team1_player2: t1[1] || null,
    team2_player1: t2[0], team2_player2: t2[1] || null,
});

test('kobling: på navnene (også i anden rækkefølge og med andre store/små bogstaver), ellers på nummeret', () => {
    const games = [
        g(101, 1, ['Bea Holm', 'anna  hansen'], ['Cia Ude', 'Dora Ude']),   // navne, byttet rækkefølge
        g(102, 5, ['Anna Hansen'], ['Dora Ude']),                            // single: nr. 5 hos dem, nr. 5 her
        g(103, 6, ['Gry Ude'], ['Bea Holm']),                                // holdene står omvendt
        g(104, 2, ['Eva Lund', 'Fie Bergg'], ['Gry Ude', 'Hanne Ude']),      // stavefejl → nummeret
        g(105, 9, ['Ukendt'], ['Ukendt 2']),                                 // findes ikke
    ];
    const { koblinger, ukoblede } = bpl.kobDelkampe(games, MODEL);
    assert.equal(koblinger.get(101).bpKampId, 2418930);
    assert.equal(koblinger.get(101).hold1ErHjemme, true);
    assert.equal(koblinger.get(102).bpKampId, 2418926);
    assert.equal(koblinger.get(103).bpKampId, 2418927);
    assert.equal(koblinger.get(103).hold1ErHjemme, false);
    assert.equal(koblinger.get(104).bpKampId, 2418923);
    assert.deepEqual(ukoblede, [105]);
    // Spillerne i den rækkefølge, badmintonplayer har dem (playerIndex)
    assert.deepEqual(koblinger.get(101).hjemme.map(p => p.playerId), [1, 2]);
    assert.deepEqual(koblinger.get(101).ude[0], { navn: 'Cia Ude', playerId: 11, clubId: 27 });
    // Ingen model: intet koblet
    assert.deepEqual(bpl.kobDelkampe([g(1, 1, ['A'], ['B'])], null).ukoblede, [1]);
});

test('koden: livescore skal være åbnet, og koden skal passe (ingen kode = alle må)', () => {
    assert.equal(bpl.kodeTjek(MODEL, '1234').ok, true);
    assert.equal(bpl.kodeTjek(MODEL, ' 1234 ').ok, true);
    assert.equal(bpl.kodeTjek(MODEL, '9999').ok, false);
    assert.match(bpl.kodeTjek(MODEL, '').grund, /koden passer ikke/);
    const udenKode = { match: { ...MODEL.match, liveScoreCode: null } };
    assert.equal(bpl.kodeTjek(udenKode, '').ok, true);
    // liveScoreEnabled alene (funktionen findes for rækken) er ikke nok — klubben skal have åbnet kampen
    const lukket = { match: { ...MODEL.match, liveScore: false, liveScoreEnabled: true } };
    assert.match(bpl.kodeTjek(lukket, '1234').grund, /ikke åbnet/);
    assert.equal(bpl.kodeTjek(null, '1234').ok, false);
});

const KOBLING = { bpKampId: 2418930, hjemme: [{ navn: 'Anna Hansen', playerId: 1, clubId: 1087 }, { navn: 'Bea Holm', playerId: 2, clubId: 1087 }],
    ude: [{ navn: 'Cia Ude', playerId: 11, clubId: 27 }, { navn: 'Dora Ude', playerId: 12, clubId: 27 }], hold1ErHjemme: true };
const GAME = g(101, 1, ['Anna Hansen', 'Bea Holm'], ['Cia Ude', 'Dora Ude']);
const BP = { leagueMatchId: '516284', venueId: 424 };
const gs = (o = {}) => ({
    player1_name: 'Anna Hansen', player1_name2: 'Bea Holm', player2_name: 'Cia Ude', player2_name2: 'Dora Ude',
    player1_score: 7, player2_score: 4, set_scores_history: '[]', match_completed: 0,
    is_doubles: 1, serving_team: 1, serving_player_on_team: 2, serving_player: null, ...o,
});

test('beskeden: samme form som badmintonplayers egen tæller', () => {
    const b = bpl.byggeBesked({ gs: gs(), game: GAME, kobling: KOBLING, bp: BP, bane: 3 });
    assert.deepEqual(b.matchResults, [{ score1: 7, score2: 4, setIndex: 0 }]);
    assert.equal(b.parentMatchId, 516284);
    assert.equal(b.matchId, 2418930);
    assert.equal(b.venueId, 424);
    assert.equal(b.courtNumber, 3);
    // A/B hjemme (A = spiller 2, B = spiller 1), C/D ude
    assert.deepEqual(b.playersLocation.playerA, { name: 'Bea Holm', clubId: 1087, playerId: 2, side: 0 });
    assert.deepEqual(b.playersLocation.playerB, { name: 'Anna Hansen', clubId: 1087, playerId: 1, side: 0 });
    assert.deepEqual(b.playersLocation.playerC, { name: 'Cia Ude', clubId: 27, playerId: 11, side: 1 });
    // Bea (makkeren på hjemmeholdet) server
    assert.equal(b.currentPlayerServeId, 2);
});

test('beskeden: sideskift og afsluttede sæt vendes, så score1 altid er hjemmeholdet', () => {
    const historik = JSON.stringify([
        { player1Name: 'Anna Hansen', player1Name2: 'Bea Holm', player2Name: 'Cia Ude', player2Name2: 'Dora Ude', score: '15-12' },
        { player1Name: 'Cia Ude', player1Name2: 'Dora Ude', player2Name: 'Anna Hansen', player2Name2: 'Bea Holm', score: '15-10' },
    ]);
    // 3. sæt: udeholdet står nu i player1 og fører 5-3; de server (Cia)
    const b = bpl.byggeBesked({ gs: gs({ player1_name: 'Cia Ude', player1_name2: 'Dora Ude', player2_name: 'Anna Hansen', player2_name2: 'Bea Holm',
        player1_score: 5, player2_score: 3, set_scores_history: historik, serving_team: 1, serving_player_on_team: 1 }),
        game: GAME, kobling: KOBLING, bp: BP, bane: 3 });
    assert.deepEqual(b.matchResults.map(s => [s.score1, s.score2]), [[15, 12], [10, 15], [3, 5]]);
    assert.equal(b.currentPlayerServeId, 11);
    // Holdene står omvendt i vores holdkamp (hold 1 = udeholdet hos badmintonplayer)
    const omvendt = bpl.byggeBesked({ gs: gs(), game: GAME, kobling: { ...KOBLING, hold1ErHjemme: false }, bp: BP, bane: 3 });
    assert.deepEqual(omvendt.matchResults, [{ score1: 4, score2: 7, setIndex: 0 }]);
});

test('beskeden: kampen slut, mellem sæt, single og ukendte spillere', () => {
    const historik = JSON.stringify([
        { player1Name: 'Anna Hansen', player2Name: 'Dora Ude', score: '15-8' },
        { player1Name: 'Anna Hansen', player2Name: 'Dora Ude', score: '15-9' },
    ]);
    const single = g(102, 5, ['Anna Hansen'], ['Dora Ude']);
    const ks = { bpKampId: 2418926, hjemme: [{ navn: 'Anna Hansen', playerId: 1, clubId: 1087 }], ude: [{ navn: 'Dora Ude', playerId: 12, clubId: 27 }], hold1ErHjemme: true };
    const slut = bpl.byggeBesked({ gs: gs({ player1_name: 'Anna Hansen', player1_name2: null, player2_name: 'Dora Ude', player2_name2: null,
        player1_score: 0, player2_score: 0, set_scores_history: historik, match_completed: 1, is_doubles: 0, serving_player: 2, serving_team: null }),
        game: single, kobling: ks, bp: BP, bane: 1 });
    assert.deepEqual(slut.matchResults.map(s => [s.score1, s.score2]), [[15, 8], [15, 9]]);
    assert.equal(slut.currentPlayerServeId, 12);
    assert.equal(slut.playersLocation.playerA, undefined);   // single: ingen makker
    // Mellem sæt (0-0 efter første sæt): intet tomt sæt sendes
    const mellem = bpl.byggeBesked({ gs: gs({ player1_score: 0, player2_score: 0, set_scores_history: JSON.stringify([{ player1Name: 'Anna Hansen', player2Name: 'Cia Ude', score: '15-13' }]) }),
        game: GAME, kobling: KOBLING, bp: BP, bane: 3 });
    assert.equal(mellem.matchResults.length, 1);
    // Ny kamp, intet talt endnu: 0-0 i første sæt
    assert.deepEqual(bpl.byggeBesked({ gs: gs({ player1_score: 0, player2_score: 0 }), game: GAME, kobling: KOBLING, bp: BP, bane: 3 }).matchResults,
        [{ score1: 0, score2: 0, setIndex: 0 }]);
    // Andre spillere på banen (fx en ny kamp startet uden om holdkampen): intet sendes
    assert.equal(bpl.byggeBesked({ gs: gs({ player1_name: 'Spiller 1', player1_name2: 'Makker 1', player2_name: 'Spiller 2', player2_name2: 'Makker 2' }),
        game: GAME, kobling: KOBLING, bp: BP, bane: 3 }), null);
});

function falskForbindelse() {
    const f = {
        state: 'Disconnected', connectionId: 'c1', kald: [], startet: 0,
        _paaGen: null,
        onreconnected(fn) { f._paaGen = fn; }, onclose() {},
        async start() { f.startet++; f.state = 'Connected'; },
        async stop() { f.state = 'Disconnected'; },
        async invoke(navn, ...args) { f.kald.push([navn, ...args]); return null; },
    };
    return f;
}

test('hubben: melder sig i delkampens gruppe én gang, sender, og sender igen efter en genforbindelse', async () => {
    let f;
    const hub = new bpl.Hub({ lavForbindelse: (url) => { assert.equal(url, 'https://badmintonplayer.dk/api/ws/livescore/leaguematch'); return (f = falskForbindelse()); } });
    const b1 = { matchId: 2418930, matchResults: [{ score1: 1, score2: 0, setIndex: 0 }] };
    await hub.send(b1);
    await hub.send({ ...b1, matchResults: [{ score1: 2, score2: 0, setIndex: 0 }] });
    assert.equal(f.startet, 1);
    assert.deepEqual(f.kald.map(k => k[0]), ['sendConnectionId', 'matchSendResult', 'matchSendResult']);
    assert.deepEqual(f.kald[0], ['sendConnectionId', 'c1', '2418930']);
    // Genforbundet (ny forbindelse hos dem): gruppen meldes igen, og seneste stilling sendes
    f.kald = [];
    await f._paaGen();
    assert.deepEqual(f.kald.map(k => k[0]), ['sendConnectionId', 'matchSendResult']);
    assert.equal(f.kald[1][1].matchResults[0].score1, 2);
});

test('serveren: ruten, lytteren, migrationen og admin', () => {
    const laes = (fil) => fs.readFileSync(path.join(__dirname, '../../..', fil), 'utf8');
    const r = laes('backend/routes/bpLivescore.js');
    assert.match(r, /router\.get\('\/:id', authMiddleware, requirePage\('holdkamp'\)/);
    assert.match(r, /router\.put\('\/:id', authMiddleware, requirePage\('holdkamp'\)/);
    assert.match(r, /onAnyGameStateChange\(/);
    // Koden sendes aldrig tilbage til admin — kun at den er sat
    assert.match(r, /kodeSat: !!tm\.bp_livescore_kode/);
    assert.doesNotMatch(r, /kode: tm\.bp_livescore_kode/);
    assert.match(laes('backend/server.js'), /app\.use\('\/api\/bp-livescore', require\('\.\/routes\/bpLivescore'\)\)/);
    assert.match(laes('backend/package.json'), /"@microsoft\/signalr"/);
    const m = laes('backend/migrations/057_bp_livescore.sql');
    for (const k of ['bp_livescore', 'bp_livescore_kode', 'bp_venue_id', 'bp_livescore_status', 'bp_livescore_sendt', 'bp_kamp_id', 'bp_spillere']) {
        assert.match(m, new RegExp(`ADD COLUMN ${k} `));
    }
    // De offentlige holdkamp-svar sender ikke koden
    assert.doesNotMatch(laes('backend/routes/teamMatches.js'), /bp_livescore_kode/);
    const a = laes('frontend/admin-script.js');
    assert.match(a, /\$\{renderBpLivescoreBlok\(teamMatch\)\}/);
    assert.match(a, /await hentBpLivescoreStatus\(teamMatches\);/);
    assert.ok(Number((laes('frontend/admin.html').match(/admin-script\.js\?v=(\d+)/) || [])[1]) >= 133, 'admin-script.js er talt op');
});

test('admin: "Send livescore" tegner kodeformularen, før gentegningen spærres', () => {
    // Fejlen i prod 2026-11-25: holdkampEditOpen blev sat før gentegningen,
    // så loadActiveHoldkamp sprang den over, og der skete intet ved klik.
    const a = fs.readFileSync(path.join(__dirname, '../../../frontend/admin-script.js'), 'utf8');
    const fn = a.slice(a.indexOf('async function aabnBpLivescore'), a.indexOf('function lukBpLivescore'));
    assert.ok(fn.length > 0, 'aabnBpLivescore er async');
    const tegn = fn.indexOf('await tegnHoldkampeIgen()');
    const spaer = fn.indexOf('holdkampEditOpen = true');
    assert.ok(tegn > 0 && spaer > tegn, 'formularen tegnes før holdkampEditOpen sættes');
    assert.match(a, /function tegnHoldkampeIgen\(\) \{[^}]*return loadActiveHoldkamp\(\);/);
});

test('lytteren på baneændringer: alle klubber, og en fejl vælter ikke gemningen', () => {
    const ev = require('../../events/gameStateEvents');
    const set = [];
    const af = ev.onAnyGameStateChange((klub, bane, type) => set.push([klub, bane, type]));
    const af2 = ev.onAnyGameStateChange(() => { throw new Error('bom'); });
    ev.publishGameStateChange({ clubDbName: 'klub_x' }, '4', 'update');
    ev.publishGameStateChange({ clubDbName: 'direct' }, 2, 'reset');
    ev.publishGameStateChange({}, 1);
    af(); af2();
    ev.publishGameStateChange({ clubDbName: 'klub_x' }, 5, 'update');
    assert.deepEqual(set, [['klub_x', 4, 'update'], [null, 2, 'reset'], [null, 1, 'update']]);
});
