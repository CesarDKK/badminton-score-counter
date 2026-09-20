// Krydstjek mod reglementet 2026-09-20 (Reglement for Individuelle Turneringer, Appendiks 1 og U9/U11-vejledningen):
// standarderne i et nyt projekt skal være reglementets — og ældre gemte projekter bringes på linje.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, normaliserHalvBane, standardRaekkefoelge, STANDARD_REGLER, STANDARD_PAUSE, TIDSVINDUE } from '../../src/store.js';
import { minKampeKrav } from '../../src/form.js';
import { lavForslag } from '../../src/scheduler.js';
import { saetForm, opdaterDag, opdaterOpsaetning } from '../../src/store.js';
import { model } from '../hjaelp/model.js';

const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

describe('reglementets tal er standard', () => {
    test('§ 4 stk. 5: minimumstid pr. kamp', () => {
        assert.deepEqual(STANDARD_REGLER.minKampMin, { ungdomABCD: 20, ungdomEM: 25, seniorABCD: 25, seniorEM: 30 });
    });
    test('§ 3 stk. 8: pauser — E 20, M 15, ABCD 10, fælles 12', () => {
        assert.deepEqual(STANDARD_PAUSE, { ABCD: 10, M: 15, E: 20, faelles: 12 });
    });
    test('§ 4 stk. 5.1: tidsvinduer, 2 timer tidligere før skoledag, max 12/10 kampe pr. dag, E-rækker tidligst kl. 10 og finaler 10–13', () => {
        assert.deepEqual(TIDSVINDUE.U09, ['09:00', '19:00']);
        assert.deepEqual(TIDSVINDUE.U11, ['09:00', '19:00']);
        assert.deepEqual(TIDSVINDUE.U13, ['09:00', '20:00']);
        assert.deepEqual(TIDSVINDUE.U15, ['09:00', '20:00']);
        assert.deepEqual(TIDSVINDUE.U17, ['09:00', '21:00']);
        assert.deepEqual(TIDSVINDUE.SEN, ['09:00', '21:00']);
        assert.equal(STANDARD_REGLER.foerSkoledagTimer, 2);
        assert.equal(STANDARD_REGLER.maxKampePrDagEnDag, 12);
        assert.equal(STANDARD_REGLER.maxKampePrDag, 10);
        assert.equal(STANDARD_REGLER.eTidligst, '10:00');
        assert.deepEqual(STANDARD_REGLER.eFinale, ['10:00', '13:00']);
        assert.equal(STANDARD_REGLER.seniorMaxPrKategori, 3);
    });
    test('Appendiks 1: minimum kampe PR. KATEGORI — M/A 2; B/C/D 3 i single og 2 i double; U9/U11 4 i single', () => {
        const krav = (aargang, raekke, type) => minKampeKrav({ type }, { aargang, raekke }, STANDARD_REGLER);
        assert.equal(krav('U13', 'M', 'single'), 2);
        assert.equal(krav('U13', 'A', 'double'), 2);
        assert.equal(krav('U15', 'C', 'single'), 3);
        assert.equal(krav('U15', 'C', 'double'), 2);
        assert.equal(krav('U09', 'D', 'single'), 4);
        assert.equal(krav('U11', 'B', 'single'), 4);
        assert.equal(krav('U11', 'B', 'double'), 2);
        assert.equal(krav('SEN', 'A', 'single'), 0, 'kravene gælder ungdom');
    });
});

describe('U9/U11-vejledningen: rækkefølge og max varighed for singlerne', () => {
    test('U9 og U11: single → double → mix; U13 og op: mix → double → single', () => {
        assert.deepEqual(standardRaekkefoelge('U09'), ['HS', 'DS', 'HD', 'DD', 'D', 'MD']);
        assert.deepEqual(standardRaekkefoelge('U11'), ['HS', 'DS', 'HD', 'DD', 'D', 'MD']);
        assert.deepEqual(standardRaekkefoelge('U13'), ['MD', 'HD', 'DD', 'D', 'HS', 'DS']);
        assert.deepEqual(standardRaekkefoelge('SEN'), ['MD', 'HD', 'DD', 'D', 'HS', 'DS']);
        const p = nytProjekt(model([
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 4) }] },
            { id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('b', 4) }] },
        ]));
        assert.equal(p.raekker[0].raekkefoelge[0], 'HS');
        assert.equal(p.raekker[1].raekkefoelge[0], 'MD');
    });
    test('planlæggeren lægger U11-singlen før doublen og U13-doublen før singlen', () => {
        const byg = (aargang) => {
            let p = nytProjekt(model([{ id: `${aargang} D`, aargang, raekke: 'D', kategorier: [
                { kat: 'HS', type: 'single', spillere: enkelt('s', 4) },
                { kat: 'HD', type: 'double', spillere: [['d1', 'd2'], ['d3', 'd4'], ['d5', 'd6'], ['d7', 'd8']] },
            ] }]));
            p = opdaterDag(p, '2026-11-21', { baner: 1, start: '09:00', slut: '18:00' });
            p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
            for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'pulje' });
            const f = lavForslag(p);
            const foerste = (kat) => p.kampe.filter((k) => k.kategori === `${aargang} D ${kat}`).map((k) => f.plan[k.id].slot).sort()[0];
            return { hs: foerste('HS'), hd: foerste('HD') };
        };
        const u11 = byg('U11'), u13 = byg('U13');
        assert.ok(u11.hs < u11.hd, `U11: single ${u11.hs} før double ${u11.hd}`);
        assert.ok(u13.hd < u13.hs, `U13: double ${u13.hd} før single ${u13.hs}`);
    });
    test('ældre gemte projekter: U11 uden grænse får én gang vejledningens 360 min — et senere fravalg bevares', () => {
        const p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 4) }] }, { id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('b', 4) }] }]));
        const gammelt = { ...p, opsaetning: { ...p.opsaetning, singleVarighedV1: undefined }, raekker: p.raekker.map((r) => ({ ...r, maxHaltidMin: null })) };
        const ny = normaliserHalvBane(gammelt);
        assert.deepEqual(ny.raekker.map((r) => r.maxHaltidMin), [360, null]);
        const fravalgt = { ...ny, raekker: ny.raekker.map((r) => ({ ...r, maxHaltidMin: null })) };
        assert.deepEqual(normaliserHalvBane(fravalgt).raekker.map((r) => r.maxHaltidMin), [null, null]);
    });
    test('ældre gemte projekter får én gang vejledningens rækkefølge (den kunne ikke rettes i brugerfladen)', () => {
        const p = nytProjekt(model([{ id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('b', 4) }] }]));
        const gammelt = { ...p, opsaetning: { ...p.opsaetning, raekkefoelgeV2: undefined }, raekker: [{ ...p.raekker[0], raekkefoelge: ['MD', 'HS', 'DS', 'HD', 'DD'] }] };
        const ny = normaliserHalvBane(gammelt);
        assert.deepEqual(ny.raekker[0].raekkefoelge, standardRaekkefoelge('U13'));
        assert.equal(ny.opsaetning.raekkefoelgeV2, true);
    });
});
