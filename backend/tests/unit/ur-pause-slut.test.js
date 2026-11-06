/**
 * Pausen ved 11 (8), når uret tæller (routes/urTaeller.js pauseSlutterFoerTryk):
 * den slutter før et point og før andre tryk, når den er løbet ud — men "B"
 * (Fortsæt) slutter den selv. Blev den sluttet før "B", afviste reglerne "B"
 * bagefter, intet blev gemt, og TV'et hang på pausens 0:00 (Jespers kamp
 * 2026-11-06).
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-til-ur-pause-slut';
const { pauseSlutterFoerTryk } = require('../../routes/urTaeller');
const regler = require('../../taeller/regler');

const START = 1793872800000;

// 2. sæt, 4-8 i 15-point: pausen ved 8 er startet
function iPauseVed8() {
    const st = regler.nyKamp({ isDoubles: false, gameMode: '15' });
    st.player1.name = 'A'; st.player2.name = 'B';
    regler.vaelgServer(st, 1);
    regler.startKamp(st, START - 600000);
    st.player1.games = 1;
    st.player1.score = 4; st.player2.score = 7;
    st.servingPlayer = 2;
    const r = regler.point(st, 2, START);
    assert.ok(r.ok);
    assert.equal(st.restBreakActive, true, 'pausen ved 8 er startet');
    st.restBreakStartedAt = START;
    st.restBreakDuration = 60;
    return st;
}

test('"Fortsæt" (B), når pausen er løbet ud: kun B slutter pausen, og B gemmes', () => {
    const st = iPauseVed8();
    const nu = START + 61 * 1000;
    assert.equal(pauseSlutterFoerTryk(st, 'B', nu), false);
    const r = regler.afslutPause(st);
    assert.equal(r.ok, true, 'reglerne tager imod B');
    assert.equal(st.restBreakActive, false);
});

test('"Fortsæt" (B) før pausen er løbet ud', () => {
    const st = iPauseVed8();
    assert.equal(pauseSlutterFoerTryk(st, 'B', START + 20 * 1000), false);
    assert.equal(regler.afslutPause(st).ok, true);
});

test('et point i pausen slutter pausen først — også før den er løbet ud', () => {
    const st = iPauseVed8();
    assert.equal(pauseSlutterFoerTryk(st, 'P1', START + 5 * 1000), true);
    assert.equal(pauseSlutterFoerTryk(st, 'P2', START + 90 * 1000), true);
});

test('fortryd slutter aldrig pausen først', () => {
    const st = iPauseVed8();
    assert.equal(pauseSlutterFoerTryk(st, 'U', START + 90 * 1000), false);
});

test('andre tryk: pausen slutter først, når den er løbet ud', () => {
    const st = iPauseVed8();
    assert.equal(pauseSlutterFoerTryk(st, 'S1', START + 20 * 1000), false);
    assert.equal(pauseSlutterFoerTryk(st, 'S1', START + 61 * 1000), true);
});

test('sætpausen slutter aldrig før trykket', () => {
    const st = regler.nyKamp({ isDoubles: false, gameMode: '15' });
    st.player1.name = 'A'; st.player2.name = 'B';
    st.player1.score = 15; st.player2.score = 8;
    st.restBreakActive = true; st.restBreakStartedAt = START; st.restBreakDuration = 120;
    assert.equal(pauseSlutterFoerTryk(st, 'P1', START + 200 * 1000), false);
    assert.equal(pauseSlutterFoerTryk(st, 'K', START + 200 * 1000), false);
});

test('ingen pause: intet at slutte', () => {
    const st = regler.nyKamp({ isDoubles: false, gameMode: '15' });
    assert.equal(pauseSlutterFoerTryk(st, 'P1', START), false);
});
