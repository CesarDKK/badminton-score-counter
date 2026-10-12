// Jesper 2026-10-12: U11 må få 12 kampe på en dag (U9-U11-vejledningen: "Max. antal kampe på en dag for U11 er 12
// kampe"), også når turneringen har flere dage — men målet er ikke 12: planneren sigter efter en middelvej i
// anbefalingen "4 – 6 singlekampe og 2 – 5 doublekampe" (5 single, 3 double), når den selv vælger form.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, flytKamp, anvendForslag } from '../../src/store.js';
import { STANDARD_REGLER } from '../../src/regler.js';
import { lavRegelmodel } from '../../src/regelmodel.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem } from '../../src/solver-klient.js';
import { foreslaaForm } from '../../src/form.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21', SOEN = '2026-11-22';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const par = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${2 * i + 1}`, `${praefiks}${2 * i + 2}`]);

/** To dage (reglementet: 10 kampe pr. dag), U11 og U13 med samme slags kampe. */
function toDage(aargang = 'U11', n = 13) {
    let p = nytProjekt(model([{ id: `${aargang} D`, aargang, raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('s', 2) }] }], [LOER, SOEN]));
    p = opdaterDag(p, LOER, { baner: 4, start: '08:00', slut: '23:30', foerSkoledag: false });
    // n kunstige kampe til spiller s1 på lørdag
    for (let i = 0; i < n; i += 1) {
        p.kampe.push({ id: `x${i}`, kategori: `${aargang} D HS`, fase: 'pulje', runde: 1, navn: `x${i}`, spillere: ['s1', `z${i}`], muligeSpillere: ['s1', `z${i}`], afhaengerAf: [], tpRef: { draw: 100 + i }, tpTid: null, varighed: 0 });
        p = flytKamp(p, `x${i}`, LOER, `${String(8 + i).padStart(2, '0')}:00`);
    }
    return p;
}
const maxKampeFejl = (p) => tjekPlan(p).problemer.filter((x) => x.type === 'max-kampe');

describe('U11: max 12 kampe på en dag — også ved flere dage', () => {
    test('tallene står i reglerne', () => {
        assert.equal(STANDARD_REGLER.maxKampePrDagU11, 12);
        assert.deepEqual(STANDARD_REGLER.maalKampeU9U11, { single: 5, double: 3 });
        const M = lavRegelmodel(toDage('U11', 0));
        assert.equal(M.maxPrDagFor({ aargang: 'U11' }), 12);
        assert.equal(M.maxPrDagFor({ aargang: 'U13' }), 10, 'reglementet ved flere dage');
        assert.equal(M.maxPrDagFor({ aargang: 'U09' }), 10);
    });
    test('Tjek: 12 kampe er ok for U11, 13 er for mange; U13 må kun få 10', () => {
        assert.equal(maxKampeFejl(toDage('U11', 12)).length, 0);
        assert.match(maxKampeFejl(toDage('U11', 13))[0].tekst, /13 kampe .*\(max 12\)/);
        assert.match(maxKampeFejl(toDage('U13', 11))[0].tekst, /11 kampe .*\(max 10\)/);
    });
    test('planlæggeren giver en U11-spiller op til 12 kampe på dagen — også i Swiss, hvor spilleren ikke kendes', () => {
        let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [
            { kat: 'HS', type: 'single', spillere: enkelt('d', 8) },
            { kat: 'HD', type: 'double', spillere: par('d', 4) },
        ] }], [LOER, SOEN]));
        for (const d of [LOER, SOEN]) p = opdaterDag(p, d, { baner: 6, start: '09:00', slut: '19:00', foerSkoledag: false });
        // Rækken spiller kun lørdag (uden varighedsgrænser, så det kun er max kampe, der prøves): 7 Swiss-runder i single
        // og 4 i double = 11 kampe. Turneringen har to dage, så reglementets 10 ville før have givet brud.
        p = { ...p, raekker: p.raekker.map((r) => ({ ...r, dage: [LOER], maxHaltidMin: null, maxDoubleMin: null })) };
        p = saetForm(saetForm(p, 'U11 D HS', { formValg: 'swiss', swissRunder: 7 }), 'U11 D HD', { formValg: 'swiss', swissRunder: 4 });
        const f = lavForslag(p);
        assert.deepEqual(f.brud.filter((x) => x.brud === 'max-kampe'), []);
        assert.deepEqual(maxKampeFejl(anvendForslag(p, f)), []);
    });
    test('løseren: U11-spillere med 11 kampe får ingen grænse; med 13 en egen grænse på 12', () => {
        assert.deepEqual(bygProblem(toDage('U11', 11)).maxPrGruppe, []);
        const pr = bygProblem(toDage('U11', 13));
        const g = pr.maxPrGruppe.find((x) => x.regel === 'maxKampe');
        assert.equal(g.max, 12);
        assert.equal(g.kampe.length, 13);
        assert.equal(bygProblem(toDage('U13', 11)).mangeKampe.length, 1, 'U13: den fælles grænse på 10');
    });
});

describe('middelvejen i anbefalingen, når planneren selv vælger form', () => {
    const regler = STANDARD_REGLER;
    const u11 = { aargang: 'U11', raekke: 'D' };
    test('single: 5 kampe — ikke 4 (minimum) og ikke 6 (flest)', () => {
        const f = foreslaaForm(20, { type: 'single', halvBane: false }, u11, regler, { form: 'auto' });
        assert.equal(f.minKampe, 5, f.tekst);
    });
    test('double: tættest på 3 og højst 5', () => {
        const f = foreslaaForm(8, { type: 'double', halvBane: false }, u11, regler, { form: 'auto' });
        assert.ok(Math.abs(f.minKampe - 3) <= 1 && f.maxKampe <= 5, f.tekst);
    });
    test('er der ikke plads til middelvejen, gælder minimum som før', () => {
        const trangt = foreslaaForm(20, { type: 'single', halvBane: false }, u11, regler, { form: 'swiss', ledigeBaneSlots: 40 });
        assert.equal(trangt.runder, 4, '4 runder á 10 = 40 bane-slots');
    });
    test('U13 og ældre: uændret — færrest bane-slots, der når minimum', () => {
        const f = foreslaaForm(20, { type: 'single', halvBane: false }, { aargang: 'U13', raekke: 'D' }, regler, { form: 'swiss' });
        assert.equal(f.runder, 4);
    });
});
