/**
 * Unit-tests af varighedsteksten for holdkamp-/turneringskampe (matchTiming).
 * banensStartTid kræver database og testes ikke her.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { varighedTekst } = require('../../config/matchTiming');

test('varighed: minutter og sekunder, nul-udfyldt', () => {
    assert.equal(varighedTekst('2026-09-07T10:00:00Z', '2026-09-07T10:23:45Z'), '23:45');
    assert.equal(varighedTekst('2026-09-07T10:00:00Z', '2026-09-07T10:05:07Z'), '05:07');
});

test('varighed: over en time bliver til ubegrænsede minutter (som bane-siden)', () => {
    assert.equal(varighedTekst('2026-09-07T10:00:00Z', '2026-09-07T11:15:12Z'), '75:12');
});

test('varighed: Date-objekter accepteres (mysql2 returnerer Date)', () => {
    assert.equal(varighedTekst(new Date('2026-09-07T10:00:00Z'), new Date('2026-09-07T10:01:30Z')), '01:30');
});

test('varighed: mangler start eller slut → tom streng', () => {
    assert.equal(varighedTekst(null, '2026-09-07T10:00:00Z'), '');
    assert.equal(varighedTekst('2026-09-07T10:00:00Z', null), '');
    assert.equal(varighedTekst(undefined, undefined), '');
});

test('varighed: ugyldig eller negativ (slut før start) → tom streng', () => {
    assert.equal(varighedTekst('bogus', '2026-09-07T10:00:00Z'), '');
    assert.equal(varighedTekst('2026-09-07T10:30:00Z', '2026-09-07T10:00:00Z'), '');
});

test('varighed: afrundes til hele sekunder', () => {
    assert.equal(varighedTekst('2026-09-07T10:00:00.000Z', '2026-09-07T10:00:59.600Z'), '01:00');
});
