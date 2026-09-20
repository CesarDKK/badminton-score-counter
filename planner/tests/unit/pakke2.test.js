// Pakke 2 fra gennemgangen 2026-09-20: ét fælles regelmodul, så Tjek, planlægger og løser er enige.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, opdaterOpsaetning, flytKamp, anvendForslag } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem } from '../../src/solver-klient.js';
import { lavRegelmodel, pauseForRaekke, standardMaxDage, banerBrugt } from '../../src/regelmodel.js';
import { model } from '../hjaelp/model.js';

/** U9: a, b, c, d i single (Swiss, 3 runder) og som to doublepar (én kamp). Pause 10 min, så naboslots er lovlige. */
function u9(haltid = 240) {
    let p = nytProjekt(model([{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['a'], ['b'], ['c'], ['d']] }, { kat: 'HD', type: 'double', spillere: [['a', 'b'], ['c', 'd']] }] }]));
    p = opdaterDag(p, '2026-11-21', { baner: 4, start: '09:00', slut: '18:00' });
    p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
    p = saetForm(saetForm(p, 'U09 D HS', { formValg: 'swiss', swissRunder: 3 }), 'U09 D HD', { formValg: 'pulje' });
    return opdaterRaekke(p, 'U09 D', { maxHaltidMin: haltid });
}
const laeg = (p, filter, slot) => p.kampe.filter(filter).reduce((q, k) => flytKamp(q, k.id, '2026-11-21', slot), p);

describe('regelmodellen: byggestenene står ét sted', () => {
    test('pause: ukendt klasse regnes som ABCD, fælles pause vinder over ABCD og M men ikke E', () => {
        const pm = { ABCD: 10, M: 15, E: 20, faelles: null };
        assert.equal(pauseForRaekke(pm, undefined), 10);
        assert.equal(pauseForRaekke(pm, 'M'), 15);
        assert.equal(pauseForRaekke({ ...pm, faelles: 12 }, 'M'), 12);
        assert.equal(pauseForRaekke({ ...pm, faelles: 12 }, 'E'), 20);
        assert.equal(pauseForRaekke({}, 'M'), 15, 'uden indstillinger: reglementets M-pause, ikke 10');
    });
    test('max dage: rækkens værdi, dispensation fjerner grænsen, ældre projekter uden feltet får reglementets standard', () => {
        const M = lavRegelmodel(u9());
        assert.equal(M.maxDageFor({ aargang: 'U11', raekke: 'D', maxDage: 1 }), 1);
        assert.equal(M.maxDageFor({ aargang: 'U11', raekke: 'D', maxDage: 1, dispensationFlereDage: true }), null);
        assert.equal(M.maxDageFor({ aargang: 'U11', raekke: 'D' }), 1, 'feltet mangler: B/C/D må kun spille én dag');
        assert.equal(M.maxDageFor({ aargang: 'U13', raekke: 'M' }), null);
        assert.equal(M.maxDageFor({ aargang: 'U11', raekke: 'D', maxDage: null }), null, 'brugeren har fjernet grænsen');
        assert.equal(standardMaxDage({ aargang: 'U11', raekke: 'A' }), 1);
    });
    test('anti-samtidighed: kun slået til, når feltet er sandt — ens for Tjek, planlægger og løser', () => {
        const p = u9();
        const uden = { ...p, opsaetning: { ...p.opsaetning, antiSamtidighed: undefined } };
        assert.equal(lavRegelmodel(uden).antiSamtidighed, false);
        assert.equal(lavRegelmodel(opdaterOpsaetning(p, { antiSamtidighed: true })).antiSamtidighed, true);
        assert.deepEqual(bygProblem(uden).ikkeSamtidig, []);
    });
    test('banetælling og vindue', () => {
        assert.equal(banerBrugt(2, 3), 4);
        const p = opdaterRaekke(u9(), 'U09 D', { tidligst: '12:00', senest: '17:00' });
        const M = lavRegelmodel(p);
        const v = M.raekkeVindue(p.raekker[0], p.opsaetning.dage[0]);
        assert.deepEqual(v, { fra: 12 * 60, til: 17 * 60 });
        assert.equal(M.iVindue(v, 16 * 60 + 30), true);
        assert.equal(M.iVindue(v, 17 * 60), false, 'hele slottet skal ligge i vinduet');
    });
});

describe('tid i hallen tæller Swiss-runderne med — i Tjek, planlægger og løser', () => {
    const opstil = () => {
        let p = laeg(u9(), (k) => k.kategori === 'U09 D HD', '09:00');
        p = laeg(p, (k) => k.fase === 'swiss' && k.runde === 1, '12:00');
        p = laeg(p, (k) => k.fase === 'swiss' && k.runde === 2, '13:00');
        return laeg(p, (k) => k.fase === 'swiss' && k.runde === 3, '14:00');
    };
    test('Tjek: double kl. 9 og Swiss kl. 12–14:30 er 330 min i hallen — fejl ved grænse 240', () => {
        const fund = tjekPlan(opstil()).problemer.filter((x) => x.type === 'max-haltid');
        assert.equal(fund.length, 4, 'alle fire spillere');
        assert.match(fund[0].tekst, /330 min/);
        assert.equal(fund[0].alvor, 'fejl');
    });
    test('Tjek: et Swiss-forløb alene meldes én gang samlet, ikke pr. spiller', () => {
        let p = laeg(u9(60), (k) => k.fase === 'swiss' && k.runde === 1, '12:00');
        p = laeg(p, (k) => k.fase === 'swiss' && k.runde === 2, '13:00');
        p = laeg(p, (k) => k.fase === 'swiss' && k.runde === 3, '14:00');
        const fund = tjekPlan(p).problemer.filter((x) => x.type === 'max-haltid');
        assert.equal(fund.length, 1);
        assert.match(fund[0].tekst, /Swiss Ladder-runderne/);
    });
    test('planlæggeren holder grænsen, når Swiss-runderne tælles med', () => {
        const p = u9();
        const f = lavForslag(p);
        assert.equal(f.brud.length, 0);
        assert.deepEqual(tjekPlan(anvendForslag(p, f)).problemer.filter((x) => x.alvor === 'fejl'), []);
    });
    test('løserens problem: spillerens haltid-gruppe rummer double, runde 1 og Swiss-runde 2+', () => {
        const p = u9();
        const pr = bygProblem(p);
        const kampFor = (i) => p.kampe.find((k) => k.id === pr.kampe[i].id);
        const egne = pr.haltid.filter((h) => h.kampe.some((i) => kampFor(i).kategori === 'U09 D HD'));
        assert.equal(egne.length, 4, 'én gruppe pr. spiller');
        for (const h of egne) {
            const kampe = h.kampe.map(kampFor);
            assert.equal(kampe.filter((k) => k.kategori === 'U09 D HD').length, 1);
            assert.equal(kampe.filter((k) => k.fase === 'swiss' && k.spillere.length).length, 1, 'runde 1 (kendt)');
            assert.equal(kampe.filter((k) => k.fase === 'swiss' && !k.spillere.length).length, 4, 'runde 2 og 3: to kampe i hver');
            assert.equal(h.graense, 240);
        }
    });
});
