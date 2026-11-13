// U9 på halve baner: er de halve baner talt med i TP's baneantal? (Jesper 2026-11-13 — Lyngby 2026: 10 baner, hvor 5 er
// delt til U9, står som 15 i TP; banenavnene er fritekst, så planneren gætter ud fra antallet og spørger)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetHalveBaner, validerProjekt } from '../../src/store.js';
import { fysiskeBaner } from '../../src/tp-reader.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21', SOEN = '2026-11-22';
function tpModel({ loer = 15, soen = 10, navne = [] } = {}) {
    const m = model([
        { id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['a'], ['b'], ['c'], ['d']] }] },
        { id: 'U11 B', aargang: 'U11', raekke: 'B', kategorier: [{ kat: 'HS', type: 'single', spillere: [['e'], ['f'], ['g'], ['h']] }] },
    ], [LOER, SOEN]);
    m.kategorier[0].halvBane = true;
    m.tpGitter = { ...m.tpGitter, baner: { hele: navne.length || 15, halve: 0, delte: fysiskeBaner(navne).delte, navne },
        dage: [{ dato: LOER, start: '09:00', slut: '19:00', baner: loer, ekstra: null }, { dato: SOEN, start: '09:00', slut: '19:00', baner: soen, ekstra: null }] };
    return m;
}

describe('Halve baner: gættet ved import', () => {
    test('U9-dagen har flere baner end de andre dage: de ekstra er halve — 10 baner, U9 har 5 delte kl. 9–14 (uden kampe: rækkens max varighed)', () => {
        const p = nytProjekt(tpModel());
        const l = p.opsaetning.dage.find((d) => d.dato === LOER);
        assert.equal(l.baner, 10);
        assert.deepEqual(l.halveBaner, { tp: 15, delte: 5, gaet: true });
        const u9 = p.raekker.find((r) => r.id === 'U09 D');
        assert.deepEqual([u9.dage, u9.tidligst, u9.senest, u9.reserveredeBaner], [[LOER], '09:00', '14:00', 5]);
        assert.equal(p.opsaetning.dage.find((d) => d.dato === SOEN).baner, 10);
        assert.equal(validerProjekt(JSON.parse(JSON.stringify(p))), null);
    });
    test('samme antal baner begge dage og intet i navnene: TP\'s baner er hele baner', () => {
        const p = nytProjekt(tpModel({ loer: 10 }));
        const l = p.opsaetning.dage.find((d) => d.dato === LOER);
        assert.equal(l.baner, 10);
        assert.equal(l.halveBaner.delte, 0);
        assert.equal(p.raekker.find((r) => r.id === 'U09 D').reserveredeBaner, 0);
    });
    test('banenavnene er kun et fingerpeg: "Bane 1"/"Bane 2" er ikke en delt bane, "01-B1"/"01-B2" er', () => {
        assert.deepEqual(fysiskeBaner(['Bane 1', 'Bane 2', 'Bane 3']), { fysiske: 3, delte: 0 });
        assert.deepEqual(fysiskeBaner(['01-B1', '01-B2', '06']), { fysiske: 2, delte: 1 });
        assert.deepEqual(fysiskeBaner(['01-B', '01-B½']), { fysiske: 1, delte: 1 });
    });
});

describe('Halve baner: brugerens svar', () => {
    test('"Nej" giver TP\'s baner som hele og fjerner U9\'s egne baner og tidsrum; "Ja, 4" giver 11 baner', () => {
        const p = nytProjekt(tpModel());
        const nej = saetHalveBaner(p, LOER, 0);
        assert.equal(nej.opsaetning.dage.find((d) => d.dato === LOER).baner, 15);
        const u9 = nej.raekker.find((r) => r.id === 'U09 D');
        assert.deepEqual([u9.tidligst, u9.senest, u9.reserveredeBaner], [null, null, 0]);
        const ja = saetHalveBaner(nej, LOER, 4);
        assert.equal(ja.opsaetning.dage.find((d) => d.dato === LOER).baner, 11);
        assert.deepEqual(ja.opsaetning.dage.find((d) => d.dato === LOER).halveBaner, { tp: 15, delte: 4, gaet: false });
        assert.equal(ja.raekker.find((r) => r.id === 'U09 D').reserveredeBaner, 4);
    });
});

describe('U9\'s tidsrum følger, hvor længe U9 skal bruge (Jesper 2026-11-13: "de skal starte tidligt")', () => {
    test('anslaaSenest: bane-slots på de egne baner og spilleren med flest kampe, plus ét slot luft', async () => {
        const { anslaaSenest } = await import('../../src/store.js');
        const p0 = nytProjekt(tpModel());
        const r = p0.raekker.find((x) => x.id === 'U09 D');
        const dag = p0.opsaetning.dage.find((d) => d.dato === LOER);
        // 4 kampe (halve baner) med to spillere hver: 2 kampe pr. spiller → 1 + 1 slot (+ pause), plus luft
        const kampe = [['a', 'b'], ['c', 'd'], ['a', 'c'], ['b', 'd']].map(([x, y], i) => ({ id: `k${i}`, kategori: 'U09 D HS', runde: 1, spillere: [x, y], muligeSpillere: [x, y], afhaengerAf: [], tpRef: {} }));
        const p = { ...p0, kampe, opsaetning: { ...p0.opsaetning, slotMin: 30, pauseMin: { ABCD: 0, M: 0, E: 0, faelles: null } } };
        assert.equal(anslaaSenest(p, r, dag, 5), '10:30');
        // Swiss-pladsholdere tæller én kamp pr. spiller pr. runde, ikke én pr. pladsholder
        const swiss = [1, 2].map((i) => ({ id: `s${i}`, kategori: 'U09 D HS', runde: 2, spillere: [], muligeSpillere: ['a', 'b', 'c', 'd'], afhaengerAf: [], tpRef: {} }));
        assert.equal(anslaaSenest({ ...p, kampe: [...kampe, ...swiss] }, r, dag, 5), '11:00');
    });
});
