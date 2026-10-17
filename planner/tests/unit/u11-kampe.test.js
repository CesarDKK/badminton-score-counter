// Jesper 2026-10-12: antallet af kampe for U9/U11. Max kampe pr. dag følger reglementet — også U11 — og planneren sigter
// efter en middelvej i vejledningens anbefaling ("4 – 6 singlekampe og 2 – 5 doublekampe": 5 single, 3 double), men kun
// når der er god plads på dagen. Ellers bygges kampene til minimum som før.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, flytKamp, anvendForslag, GOD_PLADS } from '../../src/store.js';
import { STANDARD_REGLER } from '../../src/regler.js';
import { lavRegelmodel } from '../../src/regelmodel.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag } from '../../src/scheduler.js';
import { kapacitetPrDag } from '../../src/kapacitet.js';
import { lavKampprogram } from '../../src/kampprogram.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21', SOEN = '2026-11-22';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const par = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${2 * i + 1}`, `${praefiks}${2 * i + 2}`]);

/** n kunstige kampe til spiller s1 lørdag i en U11-række — i en turnering med `dage` dage. */
function mangeKampe(n, dage = [LOER, SOEN]) {
    let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('s', 2) }] }], dage));
    p = opdaterDag(p, LOER, { baner: 4, start: '08:00', slut: '23:30', foerSkoledag: false });
    for (let i = 0; i < n; i += 1) {
        p.kampe.push({ id: `x${i}`, kategori: 'U11 D HS', fase: 'pulje', runde: 1, navn: `x${i}`, spillere: ['s1', `z${i}`], muligeSpillere: ['s1', `z${i}`], afhaengerAf: [], tpRef: { draw: 100 + i }, tpTid: null, varighed: 0 });
        p = flytKamp(p, `x${i}`, LOER, `${String(8 + i).padStart(2, '0')}:00`);
    }
    return p;
}
const maxKampeFejl = (p) => tjekPlan(p).problemer.filter((x) => x.type === 'max-kampe');

describe('max kampe pr. dag følger reglementet — også for U11', () => {
    test('§ 4 stk. 5.1: 12 kampe, når hele turneringen er på én dag; 10 pr. dag over flere dage', () => {
        assert.equal(lavRegelmodel(mangeKampe(0, [LOER])).maxPrDagFor({ aargang: 'U11' }), 12);
        assert.equal(lavRegelmodel(mangeKampe(0)).maxPrDagFor({ aargang: 'U11' }), 10);
        assert.equal(STANDARD_REGLER.maxKampePrDagU11, undefined, 'ingen U11-undtagelse');
        assert.match(maxKampeFejl(mangeKampe(11))[0].tekst, /11 kampe .*\(max 10\)/);
        assert.equal(maxKampeFejl(mangeKampe(12, [LOER])).length, 0);
    });
    test('planlæggeren giver en spiller, der kun spiller Swiss, sin egen rækkes grænse (én dag: 12)', () => {
        let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [
            { kat: 'HS', type: 'single', spillere: enkelt('d', 8) },
            { kat: 'HD', type: 'double', spillere: par('d', 4) },
        ] }], [LOER]));
        p = opdaterDag(p, LOER, { baner: 6, start: '09:00', slut: '19:00', foerSkoledag: false });
        p = { ...p, raekker: p.raekker.map((r) => ({ ...r, maxHaltidMin: null, maxDoubleMin: null })) };
        // 7 Swiss-runder i single + 4 i double = 11 kampe ≤ 12
        p = saetForm(saetForm(p, 'U11 D HS', { formValg: 'swiss', swissRunder: 7 }), 'U11 D HD', { formValg: 'swiss', swissRunder: 4 });
        const f = lavForslag(p);
        assert.deepEqual(f.brud.filter((x) => x.brud === 'max-kampe'), []);
        assert.deepEqual(maxKampeFejl(anvendForslag(p, f)), []);
    });
});

describe('middelvejen i anbefalingen — kun når der er god plads på dagen', () => {
    const projekt = (baner, slut = '19:00') => {
        let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 20) }] }], [LOER]));
        p = opdaterDag(p, LOER, { baner, start: '09:00', slut, foerSkoledag: false });
        return saetForm(p, 'U11 D HS', { formValg: 'swiss' });
    };
    const runder = (p) => p.kategorier[0].formForslag.runder;
    test('formen bygges til minimum; "Lav kampprogram" løfter til midten (5 singler), når programmet stadig går op', () => {
        const p = projekt(6);
        assert.equal(runder(p), 4, 'minimum, indtil programmet er lavet');
        const r = lavKampprogram(p);
        assert.equal(runder(r.projekt), 5);
        assert.equal(r.forslag.brud.length + r.forslag.ikkePlaceret.length, 0);
        assert.deepEqual(r.valg.middelvej, ['U11 D HS (5–5 kampe)']);
        assert.deepEqual(STANDARD_REGLER.maalKampeU9U11, { single: 5, double: 3 });
        assert.ok(kapacitetPrDag(r.projekt).dage[0].udnyttelse <= GOD_PLADS);
    });
    test('valget følger kategorien: en senere genberegning beholder middelvejen', () => {
        const r = lavKampprogram(projekt(6));
        assert.equal(runder(saetForm(r.projekt, 'U11 D HS', { prioritet: 1 })), 5);
    });
    test('trangt: ingen middelvej — programmet skal gå op med det, der SKAL være plads til', () => {
        const r = lavKampprogram(projekt(1, '15:00'));
        assert.equal(runder(r.projekt), 4);
        assert.deepEqual(r.valg.middelvej, []);
    });
    test('"Planlæg kun kampe uden tid" rører ikke antallet af kampe', () => {
        const r = lavKampprogram(projekt(6));
        const b = lavKampprogram(r.projekt, { behold: true });
        assert.equal(b.projekt.kampe.length, r.projekt.kampe.length);
    });
    test('en valgt form (antal runder) og U13 røres ikke', () => {
        assert.equal(runder(lavKampprogram(saetForm(projekt(6), 'U11 D HS', { swissRunder: 4 })).projekt), 4);
        let p = nytProjekt(model([{ id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 20) }] }], [LOER]));
        p = opdaterDag(p, LOER, { baner: 6, start: '09:00', slut: '20:00', foerSkoledag: false });
        assert.equal(runder(lavKampprogram(saetForm(p, 'U13 D HS', { formValg: 'swiss' })).projekt), 4);
    });
});
