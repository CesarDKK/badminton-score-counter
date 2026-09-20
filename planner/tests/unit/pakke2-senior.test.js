// Pakke 2: E- og senior-reglerne står i regelmodellen og overholdes nu også af planlæggeren og løseren
// (før kendte kun Tjek dem, så et forslag kunne have fejl, planlæggeren ikke vidste, den lavede).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterOpsaetning, flytKamp, anvendForslag } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem } from '../../src/solver-klient.js';
import { lavRegelmodel } from '../../src/regelmodel.js';
import { model } from '../hjaelp/model.js';

const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const LOER = '2026-11-21', SOEN = '2026-11-22';

/** Senior E herresingle: 12 spillere i 4 puljer á 3, cup for de to bedste = kvart-, semi- og finale. To dage. */
function seniorE() {
    let p = nytProjekt(model([{ id: 'SEN E', aargang: 'SEN', raekke: 'E', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('e', 12) }] }], [LOER, SOEN]));
    for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner: 4, start: '09:00', slut: '20:00', foerSkoledag: false });
    p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
    return saetForm(p, 'SEN E HS', { formValg: 'pulje-cup', cupTop: 2 });
}
const runde = (p, navn) => p.kampe.filter((k) => k.rundeNavn === navn);
const fejltyper = (p) => [...new Set(tjekPlan(p).problemer.filter((x) => x.alvor === 'fejl').map((x) => x.type))];

describe('regelmodellen: hvilken dag og tid en kamp må ligge', () => {
    test('E-række: sidste dag kun semifinaler og finaler; finalen i finalevinduet', () => {
        const p = seniorE();
        const M = lavRegelmodel(p);
        const pulje = p.kampe.find((k) => k.fase === 'pulje'), kvart = runde(p, 'Kvartfinale')[0], semi = runde(p, 'Semifinale')[0], finale = runde(p, 'Finale')[0];
        assert.ok(kvart && semi && finale, 'cuppen har kvart-, semi- og finale');
        assert.equal(M.kampForbud(pulje, LOER, 600), null);
        assert.match(M.kampForbud(pulje, SOEN, 600), /sidste dag/);
        assert.match(M.kampForbud(kvart, SOEN, 600), /sidste dag/);
        assert.equal(M.kampForbud(semi, SOEN, 600), null);
        assert.equal(M.kampForbud(finale, SOEN, 11 * 60), null);
        assert.match(M.kampForbud(finale, SOEN, 15 * 60), /finalevinduet/);
        assert.equal(M.seniorEM(p.raekker[0]), true);
    });
    test('endagsturnering: "kun semi og finale sidste dag" giver ingen mening og gælder ikke', () => {
        let p = nytProjekt(model([{ id: 'SEN E', aargang: 'SEN', raekke: 'E', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('e', 6) }] }], [LOER]));
        p = saetForm(p, 'SEN E HS', { formValg: 'pulje-cup' });
        assert.equal(lavRegelmodel(p).kampForbud(p.kampe.find((k) => k.fase === 'pulje'), LOER, 600), null);
    });
});

describe('Tjek: kvart-, semi- og finale samme dag', () => {
    const laeg = (p, kampe, dag, slot) => kampe.reduce((q, k) => flytKamp(q, k.id, dag, slot), p);
    test('semifinale og finale samme dag er tilladt (for E-rækker er det ligefrem kravet på sidste dag)', () => {
        let p = seniorE();
        p = laeg(p, runde(p, 'Kvartfinale'), LOER, '15:00');
        p = laeg(p, runde(p, 'Semifinale'), SOEN, '10:00');
        p = laeg(p, runde(p, 'Finale'), SOEN, '12:00');
        assert.equal(fejltyper(p).includes('senior-finalerunder'), false);
    });
    test('alle tre runder samme dag er en fejl', () => {
        let p = seniorE();
        p = laeg(p, runde(p, 'Kvartfinale'), LOER, '10:00');
        p = laeg(p, runde(p, 'Semifinale'), LOER, '12:00');
        p = laeg(p, runde(p, 'Finale'), LOER, '14:00');
        assert.equal(fejltyper(p).includes('senior-finalerunder'), true);
    });
});

describe('planlægger og løser overholder E- og senior-reglerne', () => {
    test('forslaget har ingen fejl i Tjek: puljer og kvartfinaler lørdag, semi og finale søndag i finalevinduet', () => {
        const p = seniorE();
        const f = lavForslag(p);
        assert.equal(f.ikkePlaceret.length, 0);
        assert.deepEqual(f.brud, []);
        const efter = anvendForslag(p, f);
        assert.deepEqual(fejltyper(efter), []);
        for (const k of [...runde(p, 'Kvartfinale'), ...p.kampe.filter((x) => x.fase === 'pulje')]) assert.equal(f.plan[k.id].dag, LOER, k.navn);
        for (const k of runde(p, 'Finale')) { assert.equal(f.plan[k.id].dag, SOEN); assert.ok(f.plan[k.id].slot >= '10:00' && f.plan[k.id].slot <= '13:00', f.plan[k.id].slot); }
    });
    test('løserens problem: tilladte tider følger reglerne, og finalen må ikke ligge samme dag som en kvartfinale', () => {
        const p = seniorE();
        const pr = bygProblem(p);
        const i = (k) => pr.kampe.findIndex((x) => x.id === k.id);
        const pulje = p.kampe.find((k) => k.fase === 'pulje'), finale = runde(p, 'Finale')[0], kvart = runde(p, 'Kvartfinale');
        assert.ok(pr.kampe[i(pulje)].tilladte.every((t) => t < 1440), 'puljekampe kun lørdag');
        assert.ok(pr.kampe[i(finale)].tilladte.every((t) => t % 1440 >= 600 && t % 1440 <= 780), 'finalen kun 10:00–13:00');
        assert.deepEqual(pr.ikkeSammeDag.sort(), kvart.map((k) => [i(k), i(finale)]).sort());
        assert.deepEqual(pr.maxPrGruppe, [], 'ingen spiller har over 3 sikre kampe i kategorien');
    });
    test('senior E/M: højst 3 kampe pr. kategori pr. dag (dobbelt pulje á 3 = 4 kampe skal deles over to dage)', () => {
        let p = nytProjekt(model([{ id: 'SEN M', aargang: 'SEN', raekke: 'M', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('m', 3) }] }], [LOER, SOEN]));
        for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner: 2, start: '09:00', slut: '20:00', foerSkoledag: false });
        p = saetForm(p, 'SEN M HS', { formValg: 'dobbelt-pulje' });
        const pr = bygProblem(p);
        assert.equal(pr.maxPrGruppe.length, 3, 'én gruppe pr. spiller');
        assert.ok(pr.maxPrGruppe.every((g) => g.max === 3 && g.kampe.length === 4));
        const f = lavForslag(p);
        assert.deepEqual(f.brud, []);
        assert.deepEqual(fejltyper(anvendForslag(p, f)), []);
        assert.equal(new Set(Object.values(f.plan).map((x) => x.dag)).size, 2, 'kampene er fordelt på begge dage');
    });
});
