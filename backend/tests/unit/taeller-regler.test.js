// Pointreglerne (taeller/regler.js) mod tabletten: kampene i
// data/taeller-kampe.json blev spillet på den rigtige tablet-side, FØR den selv
// kom til at regne med reglerne (scripts/taeller-sammenlign.js), og tilstanden
// skal være den samme efter hvert tryk. Filen er facit for reglerne — en ny
// optagelse laves kun ved en bevidst regelændring, og så gennemgås diffen af
// "slut"-linjerne.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const regler = require('../../taeller/regler');
const { kampe } = require('./data/taeller-kampe.json');

const NU = 1_800_000_000_000;
const aftryk = (st) => crypto.createHash('sha1').update(regler.signatur(st)).digest('hex').slice(0, 8);

function anvend(st, h, nu) {
    const n = Number(h[1]);
    switch (h[0]) {
        case 'S': return regler.vaelgServer(st, n);
        case 'V': return regler.skiftSide(st);
        case 'X': return regler.bytPladser(st, n);
        case 'P': return regler.point(st, n, nu);
        case 'K': return regler.startKamp(st, nu);
        case 'B': return regler.afslutPause(st);
        case 'U': return regler.fortryd(st);
        default: throw new Error('Ukendt handling ' + h);
    }
}

test('tælleren regner som tabletten — efter hvert tryk i kampene fra tablet-siden', () => {
    assert.ok(kampe.length >= 100);
    for (const [i, k] of kampe.entries()) {
        const st = regler.nyKamp(k.opsaetning);
        const handlinger = k.handlinger.split(' ');
        const forventet = k.aftryk.split(' ');
        for (const [n, h] of handlinger.entries()) {
            anvend(st, h, NU + n * 1000);
            if (aftryk(st) !== forventet[n]) {
                assert.fail(`Kamp ${i} ${JSON.stringify(k.opsaetning)}, tryk ${n} (${handlinger.slice(0, n + 1).join(' ')}):\n` +
                    `  server: ${regler.signatur(st)}\n  kør scripts/taeller-sammenlign.js for tablettens tilstand`);
            }
        }
        assert.equal(regler.signatur(st), k.slut, `kamp ${i}: sluttilstanden`);
    }
});

test('single 21: serv, pause ved 11, sæt, sideskift og kampslut', () => {
    const st = regler.nyKamp({ navne: { p1: 'Anna', p2: 'Bo' }, gameMode: '21' });
    assert.equal(regler.point(st, 1).ok, false);          // ingen server valgt
    regler.vaelgServer(st, 2);
    for (let i = 0; i < 10; i++) regler.point(st, 1, NU);
    assert.equal(st.servingPlayer, 1);                     // serven skifter, når serveren taber
    assert.deepEqual(regler.point(st, 1, NU).haendelser, ['pause']);
    assert.equal(st.restBreakActive, true);
    regler.afslutPause(st);
    for (let i = 0; i < 9; i++) regler.point(st, 1, NU);
    const r = regler.point(st, 1, NU);
    assert.deepEqual(r.haendelser, ['saet']);
    assert.equal(st.player1.games, 1);
    assert.equal(regler.point(st, 2).ok, false);           // sætpausen: sættet er vundet
    regler.afslutPause(st);
    // Nyt sæt: siderne er byttet, vinderen server
    assert.equal(st.player2.name, 'Anna');
    assert.equal(st.player2.games, 1);
    assert.equal(st.servingPlayer, 2);
    assert.deepEqual(st.setScoresHistory, [{ player1Name: 'Anna', player1Name2: 'Makker 1', player2Name: 'Bo', player2Name2: 'Makker 2', score: '21-0' }]);
});

test('afgørende sæt: siderne skiftes ved 11 (8 i 15/21), og 29-29 afgøres ved 30', () => {
    const st = regler.nyKamp({ navne: { p1: 'A', p2: 'B' }, gameMode: '15' });
    regler.vaelgServer(st, 1);
    const saet = (vinder) => { for (let i = 0; i < 15; i++) regler.point(st, vinder, NU); regler.afslutPause(st); };
    saet(1);          // A 1-0, siderne byttes: B står som player1
    saet(1);          // B vinder (player1 nu) → 1-1
    assert.equal(st.player1.games + st.player2.games, 2);
    const foer = st.player1.name;
    for (let i = 0; i < 7; i++) regler.point(st, 1, NU);
    assert.deepEqual(regler.point(st, 1, NU).haendelser, ['pause', 'sideskift']);
    assert.equal(st.player2.name, foer);
    assert.equal(st.player2.score, 8);

    const lang = regler.nyKamp({ gameMode: '21' });
    regler.vaelgServer(lang, 1);
    for (let i = 0; i < 29; i++) { regler.point(lang, 1, NU); regler.point(lang, 2, NU); if (lang.restBreakActive) regler.afslutPause(lang); }
    assert.equal(lang.player1.score, 29);
    assert.deepEqual(regler.point(lang, 2, NU).haendelser, ['saet']);
    assert.equal(lang.setScoresHistory[0].score, '29-30');
});

test('golden set: ét sæt afgør kampen', () => {
    const st = regler.nyKamp({ setsToWin: 1, navne: { p1: 'A', p2: 'B' }, gameMode: '21' });
    // Golden set er afgørende fra første bold: siderne skiftes ved 11, så
    // point gives efter navn
    const tilB = () => regler.point(st, st.player1.name === 'B' ? 1 : 2, NU);
    regler.vaelgServer(st, 1);
    for (let i = 0; i < 20; i++) tilB();
    assert.equal(st.decidingGameSwitched, true);
    if (st.restBreakActive) regler.afslutPause(st);
    assert.deepEqual(tilB().haendelser, ['kamp']);
    assert.equal(st.matchCompleted, true);
    assert.equal(regler.point(st, 1, NU).ok, false);       // kampen er låst
    regler.fortryd(st);                                     // fortryd matchbolden genåbner
    assert.equal(st.matchCompleted, false);
    assert.equal(st.player1.name === 'B' ? st.player1.score : st.player2.score, 20);
});

test('double: samme spiller server og bytter side ved vundet bold; pladsbyt kun før kampen og mellem sæt', () => {
    const st = regler.nyKamp({ isDoubles: true, navne: { p1: 'A', p1b: 'a', p2: 'B', p2b: 'b' } });
    assert.equal(regler.bytPladser(st, 1).ok, true);      // før kampen
    assert.equal(st.team1RightCourt, 2);
    regler.vaelgServer(st, 1);
    assert.equal(st.servingPlayerOnTeam, 2);               // makkeren står i højre
    regler.point(st, 1, NU);
    assert.equal(st.servingPlayerOnTeam, 2);
    assert.equal(st.team1RightCourt, 1);                   // serveren bytter side
    assert.equal(regler.bytPladser(st, 2).ok, false);     // kampen er i gang
    regler.point(st, 2, NU);
    assert.equal(st.servingTeam, 2);
    assert.equal(st.servingPlayerOnTeam, st.team2RightCourt === 1 ? 2 : 1);   // 1 point: venstre side
});

test('fortryd: kun serveren valgt fortryder valget; højst 20 tryk tilbage', () => {
    const st = regler.nyKamp({});
    regler.vaelgServer(st, 2);
    assert.deepEqual(regler.fortryd(st).haendelser, ['server-fortrudt']);
    assert.equal(st.servingPlayer, null);
    assert.equal(regler.fortryd(st).ok, false);
    regler.vaelgServer(st, 1);
    for (let i = 0; i < 25; i++) regler.point(st, i % 2 ? 1 : 2, NU);
    let n = 0;
    while (regler.fortryd(st).ok && n < 100) n++;
    assert.equal(n, regler.HISTORIK_MAKS);
});

test('kanFortryde svarer som fortryd: tom bane nej, server valgt ja, efter genindlæsning nej', () => {
    const st = regler.nyKamp({});
    assert.equal(regler.kanFortryde(st), false);                 // tom bane: knappen skjules
    regler.vaelgServer(st, 1);
    assert.equal(regler.kanFortryde(st), true);                  // valget kan fortrydes
    regler.point(st, 1, NU);
    assert.equal(regler.kanFortryde(st), true);
    st.history = [];                                             // som efter en genindlæsning
    assert.equal(regler.kanFortryde(st), false);
    assert.equal(regler.fortryd(st).ok, false);
    // Altid samme svar som fortryd selv
    for (const k of [regler.nyKamp({}), (() => { const x = regler.nyKamp({}); regler.vaelgServer(x, 2); return x; })()]) {
        assert.equal(regler.kanFortryde(k), regler.fortryd(k).ok);
    }
});

test('"Skift side" kun før kampen (og efter den), og fortryd hen over et sideskift', () => {
    const st = regler.nyKamp({ isDoubles: true, navne: { p1: 'A', p1b: 'a', p2: 'B', p2b: 'b' }, gameMode: '21' });
    regler.bytPladser(st, 1);                              // a i højre hos hold 1
    regler.vaelgServer(st, 1);
    assert.equal(regler.skiftSide(st).ok, true);
    assert.equal(st.player1.name, 'B');
    assert.equal(st.servingTeam, 2);                       // serven følger med holdet
    assert.equal(st.team2RightCourt, 1);                   // spejlet: a står nu i venstre
    assert.equal(st.servingPlayerOnTeam, 2);
    regler.point(st, 2, NU);                               // A&a (nu side 2) vinder bolden
    assert.equal(regler.skiftSide(st).ok, false);          // kampen er i gang
    assert.equal(st.player2.score, 1);
    regler.fortryd(st);
    assert.equal(st.player1.name, 'B');                    // sideskiftet før kampen bliver stående
    assert.equal(st.player2.score, 0);
    for (let i = 0; i < 21; i++) regler.point(st, 2, NU);
    regler.afslutPause(st);
    for (let i = 0; i < 21; i++) regler.point(st, 1, NU);
    assert.equal(st.matchCompleted, true);
    assert.equal(regler.skiftSide(st).ok, true);           // efter kampen er slut
});

test('sætbold og matchbold', () => {
    const st = regler.nyKamp({ navne: { p1: 'A', p2: 'B' }, gameMode: '21' });
    assert.deepEqual(regler.boldpoint(st), { player1: null, player2: null });   // ingen server
    regler.vaelgServer(st, 1);
    for (let i = 0; i < 20; i++) regler.point(st, 1, NU);
    regler.afslutPause(st);                                // pausen ved 11 (point tæller videre)
    assert.deepEqual(regler.boldpoint(st), { player1: 'set', player2: null });
    regler.point(st, 2, NU);
    for (let i = 0; i < 19; i++) regler.point(st, 2, NU);  // 20-20
    assert.deepEqual(regler.boldpoint(st), { player1: null, player2: null });
    regler.point(st, 2, NU);                               // 20-21
    assert.deepEqual(regler.boldpoint(st), { player1: null, player2: 'set' });
    for (let i = 0; i < 8; i++) { regler.point(st, 1, NU); regler.point(st, 2, NU); }   // 28-29
    assert.deepEqual(regler.boldpoint(st), { player1: null, player2: 'set' });
    regler.point(st, 1, NU);                               // 29-29: 30 er loftet, begge til sætbold
    assert.deepEqual(regler.boldpoint(st), { player1: 'set', player2: 'set' });
    assert.deepEqual(regler.point(st, 2, NU).haendelser, ['saet']);   // 29-30
    regler.afslutPause(st);                                // B står nu som player1 med 1 sæt
    for (let i = 0; i < 20; i++) regler.point(st, 1, NU);
    if (st.restBreakActive) regler.afslutPause(st);
    assert.deepEqual(regler.boldpoint(st), { player1: 'match', player2: null });
});

test('15/21 er standarden: en tilstand uden spilletype regnes til 15, som resten af systemet', () => {
    const st = regler.nyKamp({});
    assert.equal(st.gameMode, '15');
    delete st.gameMode;
    assert.deepEqual(regler.saetGraense(st), { vind: 15, maks: 21 });
    assert.equal(regler.midtpunkt(st), 8);
    st.player1.score = 15; st.player2.score = 3;
    assert.equal(regler.erSaetAfgjort(st), true);
    assert.equal(regler.nyKamp({ gameMode: '21' }).gameMode, '21');
    assert.equal(regler.nyKamp({ gameMode: 'x' }).gameMode, '15');
});
