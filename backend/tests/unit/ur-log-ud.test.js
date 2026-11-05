/**
 * Uret logges ud, når det ikke bruges (routes/urTaeller.js urLoggetUd): 15
 * minutter uden urets egne tryk — regnet fra koblingen eller det seneste tryk —
 * undtagen mens uret tæller en kamp, der er i gang.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-til-ur-log-ud';
const { urLoggetUd, UR_LEDIG_MIN } = require('../../routes/urTaeller');

const UR = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ANDEN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const NU = 1793872800;
const MIN = 60;

test('grænsen er 15 minutter', () => {
    assert.equal(UR_LEDIG_MIN, 15);
});

test('lige koblet på, ingen række endnu: ikke logget ud', () => {
    assert.equal(urLoggetUd(null, NU - 5 * MIN, UR, NU), false);
    assert.equal(urLoggetUd(null, NU - 16 * MIN, UR, NU), true, 'koblet for 16 min siden uden at trykke');
});

test('efter "Ny kamp" eller en afsluttet kamp: 15 min fra urets seneste tryk', () => {
    const ny = { match_start_time: null, match_completed: 0, tryk_taeller: UR, taeller_id: null };
    assert.equal(urLoggetUd({ ...ny, tryk_alder_sek: 14 * MIN }, NU - 3 * 3600, UR, NU), false);
    assert.equal(urLoggetUd({ ...ny, tryk_alder_sek: 15 * MIN + 1 }, NU - 3 * 3600, UR, NU), true);
    const slut = { match_start_time: '2026-11-05 10:00:00', match_completed: 1, tryk_taeller: UR, taeller_id: UR };
    assert.equal(urLoggetUd({ ...slut, tryk_alder_sek: 20 * MIN }, NU - 3 * 3600, UR, NU), true, 'afsluttet kamp tæller ikke som i gang');
});

test('uret tæller en kamp, der er i gang: aldrig logget ud', () => {
    const iGang = { match_start_time: '2026-11-05 10:00:00', match_completed: 0, taeller_id: UR, tryk_taeller: UR, tryk_alder_sek: 40 * MIN };
    assert.equal(urLoggetUd(iGang, NU - 3 * 3600, UR, NU), false);
});

test('en anden enhed tæller kampen: urets egne tryk gælder', () => {
    const anden = { match_start_time: '2026-11-05 10:00:00', match_completed: 0, taeller_id: ANDEN, tryk_taeller: UR, tryk_alder_sek: 20 * MIN };
    assert.equal(urLoggetUd(anden, NU - 3 * 3600, UR, NU), true);
    // Et andet ur trykkede sidst: dette urs eget tryk kendes ikke — koblingen gælder
    const andetUr = { match_start_time: null, match_completed: 0, tryk_taeller: ANDEN, tryk_alder_sek: 1 };
    assert.equal(urLoggetUd(andetUr, NU - 20 * MIN, UR, NU), true);
    assert.equal(urLoggetUd(andetUr, NU - 2 * MIN, UR, NU), false);
});

test('koblet igen med koden: den nye kobling gælder, selv om det gamle tryk er gammelt', () => {
    const gammel = { match_start_time: null, match_completed: 0, tryk_taeller: UR, tryk_alder_sek: 2 * 3600 };
    assert.equal(urLoggetUd(gammel, NU - 1 * MIN, UR, NU), false);
});
