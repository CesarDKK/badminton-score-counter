// Gennemgangen 2026-10-11, pakke C: bedre program — ventetid før cupkampe, sænket net (U9/U11 først), farver ved
// klik-flyt, kort om årgangens tidsvindue og lovlige bane-slots i kapacitetspanelet.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, flytKamp } from '../../src/store.js';
import { scorePlan, VAEGT_SKABELONER } from '../../src/kriterier.js';
import { bygProblem } from '../../src/solver-klient.js';
import { lavRegelmodel } from '../../src/regelmodel.js';
import { vurderSlots } from '../../src/slotvurdering.js';
import { kandidater, anvendAendring } from '../../src/kampprogram.js';
import { kapacitetPrDag } from '../../src/kapacitet.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const kriterie = (p, id) => scorePlan(p).dele.find((d) => d.id === id).vaerdi;

function endag(raekker) {
    let p = nytProjekt(model(raekker, [LOER]));
    return opdaterDag(p, LOER, { baner: 6, start: '09:00', slut: '20:00' });
}

describe('B3: ventetid før cupkampe', () => {
    const p0 = saetForm(endag([{ id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('c', 8) }] }]), 'U13 C HS', { formValg: 'pulje-cup', cupTop: 2 });
    test('kriteriet måler tiden fra den seneste kamp, en cupkamp bygger på, er slut', () => {
        let p = p0;
        for (const k of p.kampe.filter((x) => x.fase === 'pulje')) p = flytKamp(p, k.id, LOER, '10:00');
        const cup = p.kampe.find((x) => x.fase === 'cup' && x.afhaengerAf.length);
        p = flytKamp(p, cup.id, LOER, '12:30');
        // Afhængighederne slutter 10:30 (slot 30 min), cupkampen starter 12:30 → 2 timer (+ evt. andre cupkampe uden tid)
        assert.ok(kriterie(p, 'cupVent') >= 2);
        assert.equal(VAEGT_SKABELONER.standard.vaegte.cupVent, 1);
    });
    test('løseren får cupparrene for rækker, der spiller én dag', () => {
        const prob = bygProblem(p0);
        assert.ok(prob.cupVent.length > 0);
        for (const [b, deps] of prob.cupVent) assert.ok(deps.length && deps.every((d) => d !== b));
    });
});

describe('Sænket net: U9/U11 først, de ældre bagefter (Jesper 2026-10-11)', () => {
    test('overlap mellem sænket og normalt net måles pr. dag', () => {
        let p = endag([
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('u', 4) }] },
            { id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('v', 4) }] },
        ]);
        p = saetForm(saetForm(p, 'U11 D HS', { formValg: 'pulje' }), 'U13 D HS', { formValg: 'pulje' });
        const u11 = p.kampe.filter((k) => k.kategori === 'U11 D HS'), u13 = p.kampe.filter((k) => k.kategori === 'U13 D HS');
        let foer = p, blandet = p;
        u11.forEach((k, i) => { foer = flytKamp(foer, k.id, LOER, `09:${i % 2 ? '30' : '00'}`); blandet = flytKamp(blandet, k.id, LOER, '12:00'); });
        u13.forEach((k) => { foer = flytKamp(foer, k.id, LOER, '11:00'); blandet = flytKamp(blandet, k.id, LOER, '10:00'); });
        assert.equal(kriterie(foer, 'saenketNet'), 0, 'U11 færdig før U13 starter');
        assert.equal(kriterie(blandet, 'saenketNet'), 2.5, 'U13 fra 10:00, U11 til 12:30');
        const prob = bygProblem(p);
        assert.equal(prob.nethoejde.saenket.length, u11.length);
        assert.equal(prob.nethoejde.normal.length, u13.length);
    });
});

describe('U4/A8: hvor må den valgte kamp ligge', () => {
    test('samme spiller i slottet = rødt, uden for tidsvinduet = rødt, ledigt = grønt', () => {
        let p = saetForm(endag([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 4) }] }]), 'U11 D HS', { formValg: 'pulje' });
        p = opdaterRaekke(p, 'U11 D', { dage: [LOER] });
        const [a, b] = p.kampe.filter((k) => k.spillere.includes('d1'));
        p = flytKamp(p, a.id, LOER, '10:00');
        const v = vurderSlots(p, lavRegelmodel(p), [b.id], p.opsaetning.dage[0]);
        assert.equal(v.get('10:00').niveau, 'fejl');
        assert.match(v.get('10:00').grunde.join(), /anden kamp i slottet/);
        assert.equal(v.get('19:00').niveau, 'fejl', 'U11 slutter 19:00');
        assert.equal(v.get('14:00').niveau, 'ok');
    });
});

describe('A6: kort om årgangens tidsvindue', () => {
    test('kampe uden for vinduet får "udvid tidsvinduet" (dispensation), og ændringen virker', () => {
        let p = saetForm(endag([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 4) }] }]), 'U11 D HS', { formValg: 'pulje' });
        const g = { noegle: 'plads|U11 D', familie: 'plads', raekke: 'U11 D', kampe: [], aarsager: new Set(['uden for tidsvinduet']) };
        const k = kandidater(p, g).find((x) => x.gruppe === 'tidsvindue');
        assert.ok(k, 'kandidat findes');
        assert.equal(k.trin[0].pris, 'dispensation');
        const q = anvendAendring(p, k.trin[0]);
        assert.equal(q.opsaetning.regler.tidsvindue.U11[1], k.trin[0].vindue[1]);
    });
});

describe('U5/A7: kapacitetspanelet tæller kun lovlige bane-slots', () => {
    test('U11 på en dag til 20:00: slots efter 19:00 tæller ikke', () => {
        let p = saetForm(endag([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 4) }] }]), 'U11 D HS', { formValg: 'pulje' });
        p = opdaterRaekke(p, 'U11 D', { dage: [LOER] });
        const d = kapacitetPrDag(p).dage[0];
        assert.equal(d.baneSlotsHeleDagen, 22 * 6);
        assert.equal(d.baneSlots, 20 * 6, 'U11: 09:00–19:00 = 20 slots á 30 min');
    });
});
