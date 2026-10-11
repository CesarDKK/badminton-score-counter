// Gennemgangen 2026-10-11, pakke D: realistisk prognose for dagen (tilfældige kamplængder, start op til 30 min før,
// igangsættelsesgrænsen som advarsel) og stabil omplanlægning ("Planlæg kun kampe uden tid").
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, flytKamp, anvendForslag } from '../../src/store.js';
import { prognoseDag, bedsteKamplaengde } from '../../src/kamplaengde.js';
import { lavKampprogram } from '../../src/kampprogram.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem } from '../../src/solver-klient.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

function projekt(baner = 2) {
    let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 8) }] }], [LOER]));
    p = opdaterDag(p, LOER, { baner, start: '09:00', slut: '20:00' });
    return saetForm(p, 'U11 D HS', { formValg: 'pulje' });
}

describe('K5/K6: prognose for dagen', () => {
    test('samme program giver samme prognose (frø), og 80 %-fraktilen ligger ikke før medianen', () => {
        const p = anvendForslag(projekt(), lavForslag(projekt()));
        const a = prognoseDag(p, LOER), b = prognoseDag(p, LOER);
        assert.deepEqual(a, b);
        assert.ok(a.slut80 >= a.slutMedian);
        assert.ok(a.forsinkelse80 >= a.forsinkelseMedian);
        assert.equal(a.igangsaetRisiko, 0);
    });
    test('kampe lagt tæt på grænsen (U11: kl. 20) giver risiko for sene kampe', () => {
        let p = projekt(1);
        // Alle kampe på én bane fra 18:00 og frem: de sidste bliver sat i gang efter kl. 20
        p.kampe.forEach((k, i) => { p = flytKamp(p, k.id, LOER, `${String(18 + Math.floor(i / 4)).padStart(2, '0')}:${['00', '15', '30', '45'][i % 4]}`); });
        assert.ok(prognoseDag(p, LOER).igangsaetRisiko > 0.5);
    });
    test('bedste kamplængde: risiko for sene kampe vejer før forsinkelsen', () => {
        const r = (minutter, igangsaetRisiko, forsinkelse80) => ({ minutter, udenTid: 0, fejl: 0, muligeBrud: 0, haltidGnsMin: 100, igangsaetRisiko, forsinkelse80, forsinkelseMax: 0 });
        assert.equal(bedsteKamplaengde([r(25, 0.5, 0), r(30, 0, 20)]).minutter, 30);
    });
});

describe('U6/I2: planlæg kun kampe uden tid', () => {
    test('kampe med tid beholder den; kun de nye planlægges; låsene røres ikke', () => {
        const p0 = projekt();
        const med = anvendForslag(p0, lavForslag(p0));
        // Én kamp mister sin tid (fx et afbud, og kampen skal lægges igen)
        const ny = med.kampe[0].id;
        const { [ny]: _, ...plan } = med.plan;
        const p = { ...med, plan };
        const r = lavKampprogram(p, { behold: true });
        for (const [id, t] of Object.entries(plan)) assert.deepEqual(r.projekt.plan[id], t, `${id} beholder sin tid`);
        assert.ok(r.projekt.plan[ny], 'den nye kamp har fået en tid');
        assert.deepEqual(r.projekt.laast || [], p.laast || []);
        assert.equal(r.valg.grund, 'behold');
    });
    test('løseren får de gamle kampe som "stabil" — kun dem', () => {
        const p0 = projekt();
        const med = anvendForslag(p0, lavForslag(p0));
        const ids = Object.keys(med.plan).slice(0, 3);
        const prob = bygProblem(med, med.plan, { stabil: ids });
        assert.equal(prob.stabil.kampe.length, 3);
        assert.equal(bygProblem(med, med.plan).stabil, undefined);
    });
});
