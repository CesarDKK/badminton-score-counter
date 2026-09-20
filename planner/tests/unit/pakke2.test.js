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

describe('max varighed gælder afviklingen af rækkens SINGLEKAMPE (U9 4 timer, U11 6 timer) — i Tjek, planlægger og løser', () => {
    const swiss = (p, slots) => slots.reduce((q, slot, i) => laeg(q, (k) => k.fase === 'swiss' && k.runde === i + 1, slot), p);
    test('standard: U9 240 min og U11 360 min (vejledningen), andre årgange ingen grænse', () => {
        const p = nytProjekt(model([
            { id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['a'], ['b']] }] },
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['c'], ['d']] }] },
            { id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['e'], ['f']] }] },
        ]));
        assert.deepEqual(p.raekker.map((r) => r.maxHaltidMin), [240, 360, null]);
    });
    test('Tjek: doublen tæller ikke med — double kl. 9 og singler kl. 12–14:30 er 150 min singler', () => {
        const p = swiss(laeg(u9(), (k) => k.kategori === 'U09 D HD', '09:00'), ['12:00', '13:00', '14:00']);
        assert.deepEqual(tjekPlan(p).problemer.filter((x) => x.type === 'max-haltid'), []);
    });
    test('Tjek: singler fra kl. 9 til 14:30 er 330 min — én samlet fejl for rækken, der peger på de kampe, der ligger for sent', () => {
        const p = swiss(u9(), ['09:00', '11:00', '14:00']);
        const fund = tjekPlan(p).problemer.filter((x) => x.type === 'max-haltid');
        assert.equal(fund.length, 1);
        assert.equal(fund[0].alvor, 'fejl');
        assert.match(fund[0].tekst, /U09 D: singlekampene strækker sig over 330 min/);
        const runde3 = p.kampe.filter((k) => k.fase === 'swiss' && k.runde === 3).map((k) => k.id).sort();
        assert.deepEqual([...fund[0].kampe].sort(), runde3);
    });
    test('planlæggeren lægger rækkens singler samlet og holder grænsen', () => {
        const p = u9(120);
        const f = lavForslag(p);
        assert.equal(f.brud.length, 0);
        assert.deepEqual(tjekPlan(anvendForslag(p, f)).problemer.filter((x) => x.alvor === 'fejl'), []);
        const tider = p.kampe.filter((k) => k.kategori === 'U09 D HS').map((k) => f.plan[k.id].slot).sort();
        const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
        assert.ok(min(tider.at(-1)) - min(tider[0]) + 30 <= 120, `singlerne varer ${min(tider.at(-1)) - min(tider[0]) + 30} min`);
    });
    test('løserens problem: én gruppe for rækkens singlekampe — doublen er ikke med', () => {
        const p = u9();
        const pr = bygProblem(p);
        assert.equal(pr.haltid.length, 1);
        const kampe = pr.haltid[0].kampe.map((i) => p.kampe.find((k) => k.id === pr.kampe[i].id));
        assert.ok(kampe.every((k) => k.kategori === 'U09 D HS'));
        assert.equal(kampe.length, 6, '3 runder á 2 kampe');
        assert.equal(pr.haltid[0].graense, 240);
    });
});
