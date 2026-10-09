// Kamplængde: forventet varighed fra sæsondata, ÉN anbefalet kamplængde for hele programmet
// (TP har kun én), reglementets minimum (§ 4 stk. 5), simulering af dagen og sammenligning.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, genberegnKampe, saetSlotMin, opdaterDag } from '../../src/store.js';
import {
    forventetVarighed, varighedsAargang, niveauTillaeg, kampType, programVarighed, reglementMinimum,
    anbefaletKamplaengde, kandidatLaengder, simulerDag, sammenlignKamplaengder, bedsteKamplaengde, VARIGHED, SKIFTE_MIN, MARGEN,
} from '../../src/kamplaengde.js';
import { model } from '../hjaelp/model.js';

const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const par = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${2 * i + 1}`, `${praefiks}${2 * i + 2}`]);

function projekt(raekker, { baner = 4 } = {}) {
    let p = nytProjekt(model(raekker));
    for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner, start: '09:00', slut: '18:00', foerSkoledag: false });
    // Puljer, så der er kampe at regne på (modellen har ingen lodtrækning)
    p = { ...p, kategorier: p.kategorier.map((k) => ({ ...k, formValg: 'pulje' })) };
    return genberegnKampe(p);
}

describe('kamplaengde: forventet varighed', () => {
    test('årgang, type og niveau: U11 D single, U15 M double, senior', () => {
        assert.equal(forventetVarighed('U11', 'D', 'single'), Math.round((VARIGHED.U11.single - 3.5) * 10) / 10);
        assert.equal(forventetVarighed('U15', 'M', 'double'), Math.round((VARIGHED.U15.double + 2.3) * 10) / 10);
        assert.equal(forventetVarighed('SEN', 'A', 'mix'), Math.round((VARIGHED.SEN.mix + 1.5) * 10) / 10);
    });
    test('sammenlagte niveauer ("CD") giver gennemsnittet af tillæggene; ukendt niveau giver 0', () => {
        assert.equal(niveauTillaeg('CD'), (-2.0 + -3.5) / 2);
        assert.equal(niveauTillaeg('?'), 0);
        assert.equal(niveauTillaeg(''), 0);
    });
    test('årgange uden egen række i tabellen lægges op til nærmeste: U07 → U09, senior og +35 → SEN', () => {
        assert.equal(varighedsAargang('U07'), 'U09');
        assert.equal(varighedsAargang('U12'), 'U13');
        assert.equal(varighedsAargang('SEN'), 'SEN');
        assert.equal(varighedsAargang('+35'), 'SEN');
        assert.equal(varighedsAargang(undefined), 'SEN');
    });
    test('kategoriens type: mix (MD), double, single', () => {
        assert.equal(kampType({ kat: 'MD', type: 'double' }), 'mix');
        assert.equal(kampType({ kat: 'HD', type: 'double' }), 'double');
        assert.equal(kampType({ kat: 'HS', type: 'single' }), 'single');
    });
});

describe('kamplaengde: én anbefaling for hele programmet', () => {
    test('vægtet gennemsnit over programmets kampe', () => {
        const p = projekt([
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 6) }] },
            { id: 'U15 B', aargang: 'U15', raekke: 'B', kategorier: [{ kat: 'HD', type: 'double', spillere: par('b', 4) }] },
        ]);
        const prog = programVarighed(p);
        const d = forventetVarighed('U11', 'D', 'single'), b = forventetVarighed('U15', 'B', 'double');
        const nD = p.kampe.filter((k) => k.kategori === 'U11 D HS').length, nB = p.kampe.filter((k) => k.kategori === 'U15 B HD').length;
        assert.equal(prog.antal, nD + nB);
        assert.equal(prog.gennemsnit, Math.round(((nD * d + nB * b) / (nD + nB)) * 10) / 10);
        assert.equal(prog.kategorier.length, 2);
    });
    test('(gennemsnit + skifte) × margen, rundet op til 5 min', () => {
        const p = projekt([{ id: 'U17 E', aargang: 'U17', raekke: 'E', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('e', 5) }] }]);
        const a = anbefaletKamplaengde(p);
        const forventet = Math.ceil(((forventetVarighed('U17', 'E', 'single') + SKIFTE_MIN) * MARGEN) / 5) * 5;
        assert.equal(a.fraData, forventet);
        assert.equal(a.minutter, Math.max(forventet, a.reglement));
    });
    test('aldrig under reglementets minimum (§ 4 stk. 5): ungdom E/M kræver 25 min', () => {
        // U11 D single giver ca. 15 min fra data → 20 efter margen; med en U13 M-række i programmet er minimum 25
        const p = projekt([
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 8) }] },
            { id: 'U13 M', aargang: 'U13', raekke: 'M', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('m', 3) }] },
        ]);
        assert.equal(reglementMinimum(p), 25);
        assert.ok(anbefaletKamplaengde(p).minutter >= 25);
    });
    test('kandidaterne er anbefalet ± 5 og den nuværende, aldrig under reglementets minimum', () => {
        const p = saetSlotMin(projekt([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 6) }] }]), 40);
        const a = anbefaletKamplaengde(p);
        const k = kandidatLaengder(p);
        assert.ok(k.includes(a.minutter) && k.includes(40));
        assert.ok(k.every((m) => m >= a.reglement));
    });
});

describe('kamplaengde: simulering og sammenligning', () => {
    test('én bane, kampe i naboslots: for korte slots giver forsinkelse', () => {
        let p = projekt([{ id: 'U17 A', aargang: 'U17', raekke: 'A', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 12) }] }], { baner: 1 });
        p = saetSlotMin(p, 20);
        const dato = p.opsaetning.dage[0].dato;
        const kampe = p.kampe.slice(0, 3);
        // Tre kampe med forskellige spillere i tre naboslots fra 09:00 — hver varer ca. 26,5 min + skifte
        const valgte = [];
        const brugte = new Set();
        for (const k of p.kampe) { if (k.spillere.some((s) => brugte.has(s))) continue; valgte.push(k); k.spillere.forEach((s) => brugte.add(s)); if (valgte.length === 3) break; }
        assert.equal(valgte.length, 3, `testopsætningen skal have tre kampe uden fælles spillere (${kampe.length})`);
        const plan = Object.fromEntries(valgte.map((k, i) => [k.id, { dag: dato, slot: ['09:00', '09:20', '09:40'][i] }]));
        const sim = simulerDag({ ...p, plan }, dato);
        const v = forventetVarighed('U17', 'A', 'single');
        assert.equal(sim.planSlut, '10:00');
        assert.equal(sim.forsinkelseMax, Math.round(2 * (v + SKIFTE_MIN - 20)));
        assert.ok(sim.forventetSlut > sim.planSlut);
    });
    test('sammenligningen giver et forslag pr. kamplængde, alle kampe får tid', () => {
        const p = projekt([
            { id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('c', 8) }] },
            { id: 'U15 B', aargang: 'U15', raekke: 'B', kategorier: [{ kat: 'HD', type: 'double', spillere: par('b', 4) }] },
        ]);
        const r = sammenlignKamplaengder(p, [20, 25, 30]);
        assert.deepEqual(r.map((x) => x.minutter), [20, 25, 30]);
        for (const x of r) {
            assert.equal(x.udenTid, 0);
            assert.ok(Number.isInteger(x.fejl) && Number.isInteger(x.muligeBrud));
            assert.ok(x.dage.length >= 1 && x.dage[0].planSlut && x.dage[0].forventetSlut);
        }
    });
});

describe('kamplaengde: bedst samlet i sammenligningen', () => {
    const r = (minutter, udenTid, fejl, forsinkelseMax, muligeBrud, haltidGnsMin) => ({ minutter, udenTid, fejl, forsinkelseMax, muligeBrud, haltidGnsMin });
    test('rækkefølge: uden tid, regelbrud (fejl), forsinkelse over grænsen, mulige brud, tid i hal', () => {
        // Lyngby U13/U15 (prod-test 2026-10-09): 25 min har ét muligt pausebrud før en finale, men kun 3 min forsinkelse
        assert.equal(bedsteKamplaengde([r(20, 0, 0, 46, 0, 178), r(25, 0, 0, 3, 3, 203), r(30, 0, 0, 27, 0, 153)]), 25);
        assert.equal(bedsteKamplaengde([r(20, 2, 0, 0, 0, 100), r(25, 0, 5, 0, 0, 300)]), 25);
        assert.equal(bedsteKamplaengde([r(20, 0, 1, 0, 0, 100), r(25, 0, 0, 40, 0, 300)]), 25);
        assert.equal(bedsteKamplaengde([r(20, 0, 0, 5, 2, 150), r(25, 0, 0, 5, 0, 200)]), 25);
        assert.equal(bedsteKamplaengde([r(20, 0, 0, 5, 0, 150), r(25, 0, 0, 5, 0, 200)]), 20);
        assert.equal(bedsteKamplaengde([]), null);
    });
});
