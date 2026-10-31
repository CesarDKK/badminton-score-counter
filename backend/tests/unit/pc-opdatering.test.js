/**
 * Unit-tests af "installér nyeste version nu" (admin → TV-PC) — ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const op = require('../../screens/pcOpdatering');

const NU = 1_800_000_000_000;
const MIN = 60 * 1000;
const pc = (ekstra = {}) => ({ navn: 'tv-bane-1', kioskVersion: '2026.10.29', status: null, tekst: '', maal: '', ...ekstra });

beforeEach(() => op._nulstil());

test('knappen kun for en PC, der har spurgt de seneste minutter', () => {
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU), null);
    assert.equal(op.bestil('lyngby', 7, 'tv-bane-1', NU), 'kan-ikke');

    assert.deepEqual(op.spoerg('lyngby', 7, pc(), NU), { opdater: false });
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + MIN).kan, true);
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + op.KAN_MS + 1).kan, false);
    assert.equal(op.bestil('lyngby', 7, 'tv-bane-1', NU + op.KAN_MS + 1), 'kan-ikke');
    // Andet link, anden klub
    assert.equal(op.forSkaerm('lyngby', 8, 'tv-bane-1', NU), null);
    assert.equal(op.forSkaerm('virum', 7, 'tv-bane-1', NU), null);
});

test('bestilt → PC\'en får besked, melder i gang og genstarter → opdateret', () => {
    op.spoerg('lyngby', 7, pc(), NU);
    assert.equal(op.bestil('lyngby', 7, 'tv-bane-1', NU + MIN), 'ok');
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + MIN).status, 'bestilt');

    assert.deepEqual(op.spoerg('lyngby', 7, pc(), NU + 2 * MIN), { opdater: true });
    op.spoerg('lyngby', 7, pc({ status: 'i-gang', tekst: 'Tjekker for ny version' }), NU + 2 * MIN);
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 3 * MIN).status, 'i-gang');
    assert.equal(op.fortryd('lyngby', 7, 'tv-bane-1'), false, 'kan ikke fortrydes, når PC\'en er i gang');

    const r = op.spoerg('lyngby', 7, pc({ status: 'genstarter', maal: '2026.10.31' }), NU + 10 * MIN);
    assert.deepEqual(r, { opdater: false }, 'færdig: ikke igen');
    let s = op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 10 * MIN);
    assert.equal(s.status, 'genstarter');
    assert.equal(s.maal, '2026.10.31');

    // Efter genstarten spørger den med den nye version
    op.spoerg('lyngby', 7, pc({ kioskVersion: '2026.10.31' }), NU + 14 * MIN);
    s = op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 14 * MIN);
    assert.equal(s.status, 'opdateret');
    assert.deepEqual(op.spoerg('lyngby', 7, pc({ kioskVersion: '2026.10.31' }), NU + 16 * MIN), { opdater: false });
});

test('den nye version blev ikke godkendt → mislykket', () => {
    op.spoerg('lyngby', 7, pc(), NU);
    op.bestil('lyngby', 7, 'tv-bane-1', NU);
    op.spoerg('lyngby', 7, pc({ status: 'genstarter', maal: '2026.10.31' }), NU + MIN);
    op.spoerg('lyngby', 7, pc({ kioskVersion: '2026.10.31' }), NU + 4 * MIN);
    // TV-siden kom ikke frem: 20 minutter senere tilbage på den gamle
    op.spoerg('lyngby', 7, pc(), NU + 26 * MIN);
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 26 * MIN).status, 'mislykket');
});

test('startede aldrig den nye: gammel version efter genstarten → mislykket, men ikke lige efter meldingen', () => {
    op.spoerg('lyngby', 7, pc(), NU);
    op.bestil('lyngby', 7, 'tv-bane-1', NU);
    op.spoerg('lyngby', 7, pc({ status: 'genstarter', maal: '2026.10.31' }), NU + MIN);
    op.spoerg('lyngby', 7, pc(), NU + MIN + 1000);
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 2 * MIN).status, 'genstarter');
    op.spoerg('lyngby', 7, pc(), NU + 5 * MIN);
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 5 * MIN).status, 'mislykket');
});

test('nyeste / fejl afslutter bestillingen; venter gør ikke', () => {
    op.spoerg('lyngby', 7, pc(), NU);
    op.bestil('lyngby', 7, 'tv-bane-1', NU);
    assert.deepEqual(op.spoerg('lyngby', 7, pc({ status: 'venter', tekst: 'Uret er ikke sat' }), NU + MIN), { opdater: true });
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + MIN).tekst, 'Uret er ikke sat');
    assert.deepEqual(op.spoerg('lyngby', 7, pc({ status: 'nyeste', tekst: 'Kører den nyeste version (2026.10.29).' }), NU + 3 * MIN), { opdater: false });
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 3 * MIN).status, 'nyeste');

    op.bestil('lyngby', 7, 'tv-bane-1', NU + 4 * MIN);
    op.spoerg('lyngby', 7, pc({ status: 'fejl', tekst: 'FEJL: signatur' }), NU + 5 * MIN);
    const s = op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 5 * MIN);
    assert.equal(s.status, 'fejl');
    assert.deepEqual(op.spoerg('lyngby', 7, pc(), NU + 7 * MIN), { opdater: false });
    // Vises et døgn
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + 25 * 60 * MIN).status, null);
});

test('fortryd før PC\'en er gået i gang', () => {
    op.spoerg('lyngby', 7, pc(), NU);
    op.bestil('lyngby', 7, 'tv-bane-1', NU);
    assert.equal(op.fortryd('lyngby', 7, 'tv-bane-1'), true);
    assert.deepEqual(op.spoerg('lyngby', 7, pc(), NU + MIN), { opdater: false });
    assert.equal(op.forSkaerm('lyngby', 7, 'tv-bane-1', NU + MIN).status, null);
});

test('en bestilling, PC\'en ikke henter i 12 timer, glemmes', () => {
    op.spoerg('lyngby', 7, pc(), NU);
    op.bestil('lyngby', 7, 'tv-bane-1', NU);
    assert.deepEqual(op.spoerg('lyngby', 7, pc(), NU + op.BESTILT_MAX_MS + 1), { opdater: false });
});

test('rensMelding: navn, status og versioner valideres', () => {
    assert.equal(op.rensMelding(null), null);
    assert.equal(op.rensMelding({ navn: '../etc' }), null);
    assert.equal(op.rensMelding({ navn: 'tv-1', status: 'slet-alt' }), null);
    assert.deepEqual(op.rensMelding({ navn: 'tv-1', kioskVersion: '<b>', status: 'genstarter', maal: '2026.10.31', tekst: 'a\nb' }),
        { navn: 'tv-1', kioskVersion: '', status: 'genstarter', tekst: 'a b', maal: '2026.10.31' });
    assert.equal(op.rensMelding({ navn: 'tv-1', status: '' }).status, null);
});
