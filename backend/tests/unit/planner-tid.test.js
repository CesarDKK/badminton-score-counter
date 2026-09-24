/**
 * Unit-tests af badmintonplanner-integrationens rene logik: tidsrum
 * (pr. ugedag og pr. nøgle), dansk tid og validering af en modtaget runde.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tid = require('../../config/plannerTid');

// Mandag 7. september 2026 (sommertid, +2): 19:00 dansk = 17:00Z
const MANDAG_1900 = new Date('2026-09-07T17:00:00Z');
const MANDAG_2030 = new Date('2026-09-07T18:30:00Z');
const MANDAG_2130 = new Date('2026-09-07T19:30:00Z');
const MANDAG_2129 = new Date('2026-09-07T19:29:00Z');
const TIRSDAG_1000 = new Date('2026-09-08T08:00:00Z');
// Mandag 11. januar 2027 (vintertid, +1): 19:00 dansk = 18:00Z
const VINTER_MANDAG_1900 = new Date('2027-01-11T18:00:00Z');

// Nøgle 5 mandag 18:45–20:00 på bane 1–3, nøgle 7 mandag 20:00–21:30 på bane 1–2,
// alle nøgler torsdag 19–22 på bane 2 og 4
const CONFIG = {
    enabled: true,
    slots: [
        { days: [1], from: '18:45', to: '20:00', courts: [1, 2, 3], tokenId: 5 },
        { days: [1], from: '20:00', to: '21:30', courts: [1, 2], tokenId: 7 },
        { days: [4], from: '19:00', to: '22:00', courts: [2, 4], tokenId: null }
    ]
};

test('danskNu: ugedag og minutter i dansk tid (sommer og vinter)', () => {
    let nu = tid.danskNu(MANDAG_1900);
    assert.equal(nu.ugedag, 1);
    assert.equal(nu.minutter, 19 * 60);
    assert.deepEqual([nu.aar, nu.maaned, nu.dag], [2026, 8, 7]);

    nu = tid.danskNu(VINTER_MANDAG_1900);
    assert.equal(nu.ugedag, 1);
    assert.equal(nu.minutter, 19 * 60);
});

test('aabneBaner: nøglen bestemmer hvilket tidsrum der gælder samme aften', () => {
    // Kl. 19:00: nøgle 5 er inde, nøgle 7 er ikke
    const a5 = tid.aabneBaner(CONFIG, MANDAG_1900, 5);
    assert.equal(a5.aaben, true);
    assert.deepEqual(a5.baner, [1, 2, 3]);
    assert.deepEqual(a5.vindue, { ugedag: 1, from: '18:45', to: '20:00' });
    assert.equal(tid.aabneBaner(CONFIG, MANDAG_1900, 7).aaben, false);

    // Kl. 20:30: omvendt
    assert.equal(tid.aabneBaner(CONFIG, MANDAG_2030, 5).aaben, false);
    const a7 = tid.aabneBaner(CONFIG, MANDAG_2030, 7);
    assert.equal(a7.aaben, true);
    assert.deepEqual(a7.baner, [1, 2]);

    // Ukendt nøgle rammer kun "alle nøgler"-tidsrum → lukket mandag
    assert.equal(tid.aabneBaner(CONFIG, MANDAG_1900, 99).aaben, false);
});

test('aabneBaner: slutminut eksklusivt, lukket uden for, vintertid virker', () => {
    assert.equal(tid.aabneBaner(CONFIG, MANDAG_2129, 7).aaben, true);
    assert.equal(tid.aabneBaner(CONFIG, MANDAG_2130, 7).aaben, false);
    assert.equal(tid.aabneBaner(CONFIG, TIRSDAG_1000, 5).aaben, false);
    assert.equal(tid.aabneBaner(CONFIG, VINTER_MANDAG_1900, 5).aaben, true);
});

test('aabneBaner: "alle nøgler"-tidsrum gælder enhver nøgle, admin (undefined) ser alt', () => {
    const torsdag = new Date('2026-09-10T18:00:00Z'); // torsdag 20:00 dansk
    assert.deepEqual(tid.aabneBaner(CONFIG, torsdag, 5).baner, [2, 4]);
    assert.deepEqual(tid.aabneBaner(CONFIG, torsdag, 99).baner, [2, 4]);
    // Admin-status uden nøgle: kl. 20:00 mandag er kun nøgle 7's tidsrum åbent
    const alle = tid.aabneBaner(CONFIG, MANDAG_2030);
    assert.deepEqual(alle.baner, [1, 2]);
    assert.equal(alle.slots.length, 1);
    assert.equal(alle.slots[0].tokenId, 7);
});

test('aabneBaner: overlappende tidsrum forenes (baner og spænd)', () => {
    const cfg = { enabled: true, slots: [
        { days: [1], from: '18:00', to: '20:00', courts: [1, 2], tokenId: null },
        { days: [1], from: '19:00', to: '21:00', courts: [3], tokenId: null }
    ] };
    const a = tid.aabneBaner(cfg, MANDAG_1900, 1);
    assert.deepEqual(a.baner, [1, 2, 3]);
    assert.deepEqual(a.vindue, { ugedag: 1, from: '18:00', to: '21:00' });
});

test('aabneBaner: slået fra → altid lukket', () => {
    assert.equal(tid.aabneBaner({ ...CONFIG, enabled: false }, MANDAG_1900, 5).aaben, false);
    assert.equal(tid.aabneBaner(null, MANDAG_1900, 5).aaben, false);
});

test('naesteVindue: pr. nøgle, igangværende først, ellers næste dag med tidsrum', () => {
    assert.deepEqual(tid.naesteVindue(CONFIG, MANDAG_1900, 5), { ugedag: 1, navn: 'mandag', from: '18:45', to: '20:00', courts: [1, 2, 3], tokenId: 5 });
    // Nøgle 7 kl. 19:00: dens tidsrum kl. 20 er senere samme dag
    assert.equal(tid.naesteVindue(CONFIG, MANDAG_1900, 7).from, '20:00');
    // Nøgle 5 kl. 20:30: mandag er ovre → torsdag (alle nøgler)
    const n = tid.naesteVindue(CONFIG, MANDAG_2030, 5);
    assert.equal(n.ugedag, 4);
    assert.equal(n.tokenId, null);
    // Fredag → næste mandag, tidligste tidsrum først
    assert.equal(tid.naesteVindue(CONFIG, new Date('2026-09-11T10:00:00Z'), 7).from, '20:00');
    assert.equal(tid.naesteVindue(CONFIG, new Date('2026-09-11T10:00:00Z')).from, '18:45');
    assert.equal(tid.naesteVindue({ enabled: true, slots: [] }, MANDAG_1900, 5), null);
});

test('normaliserConfig: gyldige tidsrum normaliseres (sorterede, unikke dage og baner)', () => {
    const n = tid.normaliserConfig({
        enabled: true,
        slots: [{ days: [3, 1, 3], from: '18.45', to: '21:30', courts: [3, 1, 3, '2'], tokenId: '5' }]
    });
    assert.equal(n.error, undefined);
    assert.deepEqual(n.value, { enabled: true, slots: [{ days: [1, 3], from: '18:45', to: '21:30', courts: [1, 2, 3], tokenId: 5 }] });
    assert.equal(tid.normaliserConfig({ enabled: false, slots: [{ days: [1], from: '18:00', to: '19:00', courts: [1], tokenId: '' }] }).value.slots[0].tokenId, null);
});

test('normaliserConfig: gammelt format (days pr. ugedag) konverteres til tidsrum for alle nøgler', () => {
    const n = tid.normaliserConfig({ enabled: true, days: { '1': { from: '18:45', to: '21:30', courts: [1, 2] }, '4': { from: '19:00', to: '22:00', courts: [2] } } });
    assert.equal(n.error, undefined);
    assert.deepEqual(n.value.slots, [
        { days: [1], from: '18:45', to: '21:30', courts: [1, 2], tokenId: null },
        { days: [4], from: '19:00', to: '22:00', courts: [2], tokenId: null }
    ]);
});

test('normaliserConfig: afviser uden for 07–23, ikke-kvarter, fra ≥ til, ingen baner/dage, ugyldig dag/nøgle', () => {
    const fejl = (slot) => tid.normaliserConfig({ enabled: true, slots: [slot] }).error;
    assert.match(fejl({ days: [1], from: '06:45', to: '21:00', courts: [1] }), /07:00 og 23:00/);
    assert.match(fejl({ days: [1], from: '18:00', to: '23:15', courts: [1] }), /07:00 og 23:00/);
    assert.match(fejl({ days: [1], from: '18:10', to: '21:00', courts: [1] }), /kvarter/);
    assert.match(fejl({ days: [1], from: '21:00', to: '21:00', courts: [1] }), /efter starttid/);
    assert.match(fejl({ days: [1], from: '18:00', to: '21:00', courts: [] }), /mindst én bane/);
    assert.match(fejl({ days: [], from: '18:00', to: '21:00', courts: [1] }), /mindst én ugedag/);
    assert.match(fejl({ days: [8], from: '18:00', to: '21:00', courts: [1] }), /ugedag/);
    assert.match(fejl({ days: [1], from: 'abc', to: '21:00', courts: [1] }), /klokkeslæt/);
    assert.match(fejl({ days: [1], from: '18:00', to: '21:00', courts: [1], tokenId: 'x' }), /nøgle/);
    assert.deepEqual(tid.normaliserConfig({ enabled: true }).value, { enabled: true, slots: [] });
});

test('klokkeslaetIDagTilUtc: "19:30" i dag (dansk) → UTC; passeret tid tolkes som i morgen', () => {
    assert.equal(tid.klokkeslaetIDagTilUtc('19:30', MANDAG_1900).toISOString(), '2026-09-07T17:30:00.000Z');
    assert.equal(tid.klokkeslaetIDagTilUtc('19:30', VINTER_MANDAG_1900).toISOString(), '2027-01-11T18:30:00.000Z');
    // Kl. 19:00 og "07:00" ligger 12 timer tilbage → i morgen
    assert.equal(tid.klokkeslaetIDagTilUtc('07:00', MANDAG_1900).toISOString(), '2026-09-08T05:00:00.000Z');
    assert.equal(tid.klokkeslaetIDagTilUtc('x', MANDAG_1900), null);
});

test('validerRunde: eksemplet fra badmintonplanner accepteres og normaliseres', () => {
    const v = tid.validerRunde({
        label: 'Runde 2',
        nextRoundStartsAt: '19:30',
        note: 'Fælles udstrækning efter sidste runde',
        forceNewMatch: true,
        matches: [
            { courtNumber: 1, side1Player1: 'Anders Jensen', side1Player2: 'Bo Nielsen',
              side2Player1: 'Carsten Hansen', side2Player2: 'Dan Petersen', substitutes: ['Erik Larsen'] },
            { courtNumber: 2, side1Player1: 'Finn Madsen', side1Player2: 'Hans Berg',
              side2Player1: 'Gert Olsen', side2Player2: 'Ib Kruse', note: 'Halvbane: Finn–Gert og Hans–Ib' },
            { courtNumber: '3', side1Player1: '  Jens   Holm ', side2Player1: 'Kim Lund' }
        ]
    });
    assert.equal(v.error, undefined);
    const r = v.runde;
    assert.equal(r.label, 'Runde 2');
    assert.equal(r.nextRoundStartsAt, '19:30');
    assert.equal(r.forceNewMatch, true);
    assert.equal(r.roundId, null);
    assert.equal(r.matches.length, 3);
    assert.deepEqual(r.matches[0].side1, ['Anders Jensen', 'Bo Nielsen']);
    assert.deepEqual(r.matches[0].substitutes, ['Erik Larsen']);
    assert.deepEqual(r.matches[2], { courtNumber: 3, matchId: null, side1: ['Jens Holm', null], side2: ['Kim Lund', null], substitutes: [], note: '' });
});

test('validerRunde: forceNewMatch er true som standard, tom nextRoundStartsAt = sidste runde', () => {
    const v = tid.validerRunde({ matches: [], nextRoundStartsAt: '' });
    assert.equal(v.runde.forceNewMatch, true);
    assert.equal(v.runde.nextRoundStartsAt, null);
    assert.equal(tid.validerRunde({ matches: [], forceNewMatch: false }).runde.forceNewMatch, false);
});

test('validerRunde: afviser manglende spillere, dobbelt bane, for mange, ugyldige felter', () => {
    const fejl = (body) => tid.validerRunde(body).details || [tid.validerRunde(body).error];
    assert.match(fejl({ matches: [{ courtNumber: 1, side1Player1: 'A' }] }).join(), /side2Player1/);
    assert.match(fejl({ matches: [{ courtNumber: 1, side1Player1: 'A', side2Player1: 'B' }, { courtNumber: 1, side1Player1: 'C', side2Player1: 'D' }] }).join(), /to gange/);
    assert.match(fejl({ matches: [{ courtNumber: 0, side1Player1: 'A', side2Player1: 'B' }] }).join(), /courtNumber/);
    assert.match(fejl({ matches: 'x' }).join(), /liste/);
    assert.match(fejl({ matches: [], nextRoundStartsAt: '25:99' }).join(), /nextRoundStartsAt/);
    assert.match(fejl({ matches: [], forceNewMatch: 'ja' }).join(), /forceNewMatch/);
    assert.match(fejl({ matches: [], sequence: -1 }).join(), /sequence/);
    assert.match(fejl({ matches: [{ courtNumber: 1, side1Player1: 'A', side2Player1: 'B', substitutes: Array(9).fill('X') }] }).join(), /udskiftere/);
    assert.match(fejl({ matches: Array.from({ length: 21 }, (_, i) => ({ courtNumber: i + 1, side1Player1: 'A', side2Player1: 'B' })) }).join(), /højst indeholde 20/);
    assert.match(tid.validerRunde(null).error, /JSON-objekt/);
});

test('validerRunde: navne renses for styretegn og klippes til 100 tegn', () => {
    const v = tid.validerRunde({ matches: [{ courtNumber: 1, side1Player1: 'A B\tC', side2Player1: 'x'.repeat(150) }] });
    assert.equal(v.runde.matches[0].side1[0], 'A B C');
    assert.equal(v.runde.matches[0].side2[0].length, 100);
});

test('validerRunde: matchId er valgfri og sendes med videre (til resultaterne)', () => {
    const v = tid.validerRunde({ matches: [
        { courtNumber: 1, matchId: ' k-17 ', side1Player1: 'A', side2Player1: 'B' },
        { courtNumber: 2, side1Player1: 'C', side2Player1: 'D' }
    ] });
    assert.equal(v.runde.matches[0].matchId, 'k-17');
    assert.equal(v.runde.matches[1].matchId, null);
});
