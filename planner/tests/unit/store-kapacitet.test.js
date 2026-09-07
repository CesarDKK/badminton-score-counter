// Unit-tests af projektstore og kapacitetsberegning på en lille model.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    nytProjekt, genindlaes, saetSlotMin, opdaterDag, opdaterRaekke, opdaterPause, validerProjekt,
    gemLokalt, hentLokalt, projektFilnavn, STANDARD_PAUSE,
} from '../../src/store.js';
import { slotsForDag, banerISlot, baneSlots, kapacitetPrDag, kampePrKategori } from '../../src/kapacitet.js';

function model({ tider = true } = {}) {
    const tid = (dag, slot) => (tider ? { dag, slot } : null);
    return {
        version: 1,
        kilde: { filnavn: 'x.tp', laestUtc: '2026-09-07T12:00:00.000Z', tpVersion: '202501' },
        turnering: { navn: 'Testby', hal: 'Hallen', dage: ['2025-11-22', '2025-11-23'] },
        tpGitter: { slotMin: 30, dage: [{ dato: '2025-11-22', start: '09:00', slut: '19:00', baner: 10 }, { dato: '2025-11-23', start: null, slut: null, baner: null }], baner: { hele: 10, halve: 5, navne: [] }, harTider: tider, advarsler: 0 },
        raekker: [
            { id: 'U09 D', aargang: 'U09', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U09 D HS'] },
            { id: 'U13 M', aargang: 'U13', raekke: 'M', pauseKlasse: 'M', kategorier: ['U13 M HS'] },
        ],
        kategorier: [
            { id: 'U09 D HS', eventId: 1, raekke: 'U09 D', aargang: 'U09', kat: 'HS', type: 'single', mix: false, form: 'swiss', tilmeldte: 4, kampe: 2, runder: 1, halvBane: true },
            { id: 'U13 M HS', eventId: 2, raekke: 'U13 M', aargang: 'U13', kat: 'HS', type: 'single', mix: false, form: 'pulje-cup', tilmeldte: 4, kampe: 3, runder: 0, halvBane: false },
        ],
        spillere: { p1: { id: 'p1' } },
        kampe: [
            { id: 'd1:1002', kategori: 'U09 D HS', fase: 'swiss', runde: 1, spillere: [], muligeSpillere: [], afhaengerAf: [], tpRef: { draw: 1 }, tpTid: tid('2025-11-22', '12:00') },
            { id: 'd1:3004', kategori: 'U09 D HS', fase: 'swiss', runde: 1, spillere: [], muligeSpillere: [], afhaengerAf: [], tpRef: { draw: 1 }, tpTid: tid('2025-11-22', '12:00') },
            { id: 'd2:1002', kategori: 'U13 M HS', fase: 'pulje', runde: 1, spillere: [], muligeSpillere: [], afhaengerAf: [], tpRef: { draw: 2 }, tpTid: tid('2025-11-22', '09:00') },
            { id: 'd2:1003', kategori: 'U13 M HS', fase: 'pulje', runde: 2, spillere: [], muligeSpillere: [], afhaengerAf: [], tpRef: { draw: 2 }, tpTid: tid('2025-11-23', '09:00') },
            { id: 'd3:1001', kategori: 'U13 M HS', fase: 'cup', runde: 1, spillere: [], muligeSpillere: [], afhaengerAf: [], tpRef: { draw: 3 }, tpTid: null },
        ],
        bemaerkninger: [],
    };
}

describe('store: nyt projekt', () => {
    test('uden tider: tom plan, alle dage på hver række, standardpauser', () => {
        const p = nytProjekt(model(), { tagTiderMed: false });
        assert.deepEqual(p.plan, {});
        assert.equal(p.kilde.tagTiderMed, false);
        assert.deepEqual(p.raekker.map((r) => r.dage), [['2025-11-22', '2025-11-23'], ['2025-11-22', '2025-11-23']]);
        assert.deepEqual(p.opsaetning.pauseMin, { ...STANDARD_PAUSE, faelles: 12 }, 'M og ABCD i samme turnering → fælles pause');
        assert.equal(p.opsaetning.slotMin, 30);
    });
    test('dage tager TP-gitterets tider og ellers reglementets seneste sluttid', () => {
        const p = nytProjekt(model(), { tagTiderMed: false });
        assert.deepEqual(p.opsaetning.dage, [
            { dato: '2025-11-22', start: '09:00', slut: '19:00', baner: 10, spaerret: [] },
            { dato: '2025-11-23', start: '09:00', slut: '20:00', baner: 10, spaerret: [] },
        ]);
    });
    test('med tider: planen kommer fra TP og rækkens dage udledes af den', () => {
        const p = nytProjekt(model(), { tagTiderMed: true });
        assert.equal(Object.keys(p.plan).length, 4);
        assert.deepEqual(p.plan['d2:1003'], { dag: '2025-11-23', slot: '09:00' });
        assert.deepEqual(p.raekker.find((r) => r.id === 'U09 D').dage, ['2025-11-22']);
        assert.deepEqual(p.raekker.find((r) => r.id === 'U13 M').dage, ['2025-11-22', '2025-11-23']);
    });
    test('fælles pause kun når både M og ABCD findes', () => {
        const m = model();
        m.raekker = [m.raekker[0]];
        assert.equal(nytProjekt(m).opsaetning.pauseMin.faelles, null);
    });
    test('projektet er gyldigt og kan gemmes/hentes', () => {
        const p = nytProjekt(model());
        assert.equal(validerProjekt(p), null);
        const lager = new Map();
        const storage = { setItem: (k, v) => lager.set(k, v), getItem: (k) => lager.get(k) ?? null, removeItem: (k) => lager.delete(k) };
        assert.equal(gemLokalt(p, storage), true);
        assert.deepEqual(hentLokalt(storage), JSON.parse(JSON.stringify(p)));
        assert.equal(hentLokalt({ getItem: () => '{"version":99}' }), null);
        assert.equal(projektFilnavn(p), 'Testby 2025-11-22.planner.json');
    });
    test('validerProjekt afviser fremmede filer', () => {
        assert.match(validerProjekt(null), /ikke et planner-projekt/);
        assert.match(validerProjekt({ version: 2 }), /version 2/);
        assert.match(validerProjekt({ version: 1, turnering: {} }), /mangler "opsaetning"/);
    });
});

describe('store: ændringer', () => {
    const p = nytProjekt(model());
    test('slotlængde rundes til 5-min trin', () => {
        assert.equal(saetSlotMin(p, 27).opsaetning.slotMin, 25);
        assert.equal(saetSlotMin(p, 2).opsaetning.slotMin, 5);
    });
    test('dag, række og pause opdateres uden at røre resten', () => {
        const p2 = opdaterDag(p, '2025-11-23', { baner: 8, spaerret: [{ fra: '12:00', til: '13:00', baner: 2 }] });
        assert.equal(p2.opsaetning.dage[1].baner, 8);
        assert.equal(p2.opsaetning.dage[0].baner, 10);
        const p3 = opdaterRaekke(p2, 'U09 D', { dage: ['2025-11-23'] });
        assert.deepEqual(p3.raekker[0].dage, ['2025-11-23']);
        assert.deepEqual(p3.raekker[1].dage, ['2025-11-22', '2025-11-23']);
        const p4 = opdaterPause(p3, 'M', '20');
        assert.equal(p4.opsaetning.pauseMin.M, 20);
        assert.equal(opdaterPause(p4, 'faelles', '').opsaetning.pauseMin.faelles, null);
        assert.equal(p.opsaetning.pauseMin.M, 15, 'originalen er uændret');
    });
    test('genindlæsning beholder opsætning og tider på kampe der stadig findes', () => {
        let p2 = nytProjekt(model(), { tagTiderMed: true });
        p2 = opdaterDag(p2, '2025-11-22', { baner: 7 });
        p2 = opdaterRaekke(p2, 'U09 D', { dage: ['2025-11-23'] });
        const nyModel = model({ tider: false });
        nyModel.kampe = nyModel.kampe.filter((k) => k.id !== 'd2:1002');
        const p3 = genindlaes(p2, nyModel, { behold: true });
        assert.equal(p3.opsaetning.dage[0].baner, 7);
        assert.deepEqual(p3.raekker[0].dage, ['2025-11-23']);
        assert.deepEqual(Object.keys(p3.plan).sort(), ['d1:1002', 'd1:3004', 'd2:1003']);
        assert.equal(p3.kampe.length, 4);
        assert.deepEqual(genindlaes(p2, nyModel, { behold: false }).plan, {});
    });
});

describe('kapacitet', () => {
    const dag = { dato: '2025-11-22', start: '09:00', slut: '12:00', baner: 4, spaerret: [{ fra: '10:00', til: '11:00', baner: 1 }] };
    test('slots og spærringer', () => {
        assert.deepEqual(slotsForDag(dag, 30), ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
        assert.deepEqual(slotsForDag(dag, 45), ['09:00', '09:45', '10:30', '11:15']);
        assert.equal(banerISlot(dag, '09:00'), 4);
        assert.equal(banerISlot(dag, '10:30'), 3);
        assert.equal(baneSlots(dag, 30), 6 * 4 - 2);
    });
    test('kapacitet pr. dag: faste, fleksible, halve baner og planlagte', () => {
        let p = nytProjekt(model(), { tagTiderMed: true });
        p = opdaterRaekke(p, 'U09 D', { dage: ['2025-11-22'] });
        const k = kapacitetPrDag(p);
        assert.equal(k.kampeIAlt, 5);
        assert.equal(k.udenDag, 0);
        const [d1, d2] = k.dage;
        assert.equal(d1.baneSlots, 20 * 10);
        assert.equal(d1.faste, 1, 'to U9-singler på halv bane = 1 bane-slot');
        assert.equal(d1.halveKampe, 2);
        assert.equal(d1.fleksible, 3, 'U13 M spiller begge dage');
        assert.equal(d1.fordelt, 1 + 1.5);
        assert.equal(d1.planlagte, 3);
        assert.equal(d2.planlagte, 1);
        assert.equal(d2.faste, 0);
        assert.equal(d2.fordelt, 1.5);
        assert.ok(Math.abs(d1.udnyttelse - 2.5 / 200) < 1e-9);
    });
    test('række uden dage giver kampe uden dag', () => {
        const p = opdaterRaekke(nytProjekt(model()), 'U13 M', { dage: [] });
        assert.equal(kapacitetPrDag(p).udenDag, 3);
    });
    test('kampe pr. kategori', () => {
        const p = nytProjekt(model(), { tagTiderMed: true });
        const pr = kampePrKategori(p);
        assert.deepEqual(pr.get('U13 M HS'), { pulje: 2, cup: 1, swiss: 0, ialt: 3, medTid: 2 });
        assert.deepEqual(pr.get('U09 D HS'), { pulje: 0, cup: 0, swiss: 2, ialt: 2, medTid: 2 });
    });
});
