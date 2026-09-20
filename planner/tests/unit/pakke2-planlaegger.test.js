// Pakke 2: planlæggeren og Tjek er enige om reserverede baner (overløb), og planlæggeren bryder
// én regel ad gangen og prøver rækkens anden dag, før den bryder noget.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, opdaterOpsaetning, flytKamp, laasKamp, anvendForslag } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem } from '../../src/solver-klient.js';
import { banebrugISlot } from '../../src/kapacitet.js';
import { model } from './pakke2.test.js';

const fejl = (p) => tjekPlan(p).problemer.filter((x) => x.alvor === 'fejl');
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

describe('reserverede baner: overløb på en fri fælles bane er lovligt', () => {
    test('banebrugISlot: egne baner først, resten tæller på de fælles', () => {
        const kap = { faelles: 2, reserveret: new Map([['U09 D', 1]]) };
        const u9 = (halv) => ({ raekkeId: 'U09 D', halv });
        const u11 = { raekkeId: 'U11 D', halv: false };
        assert.equal(banebrugISlot([u9(true), u9(true), u11], kap).forMange, false, '2 halve = 1 reserveret bane, 1 fælles');
        const b = banebrugISlot([u9(true), u9(true), u9(true), u11], kap);
        assert.equal(b.overloeb.get('U09 D'), 1);
        assert.equal(b.faellesBrugt, 2);
        assert.equal(b.forMange, false, 'den tredje halve bruger den frie fælles bane');
        assert.equal(banebrugISlot([u9(true), u9(true), u9(true), u11, u11], kap).forMange, true, 'nu er de fælles også fulde');
    });
    test('planlæggeren låner en fri fælles bane uden at melde regelbrud — og Tjek er enig', () => {
        // U9: 6 i pulje = 15 kampe; tidsrum 10–12 (4 slots) med 1 reserveret bane = 4 kampe. Resten må låne af de 3 fælles.
        let p = nytProjekt(model([{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 6) }] }]));
        p = opdaterDag(p, '2026-11-21', { baner: 4, start: '09:00', slut: '18:00' });
        p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
        p = saetForm(p, 'U09 D HS', { formValg: 'pulje' });
        p = opdaterRaekke(p, 'U09 D', { tidligst: '10:00', senest: '13:00', reserveredeBaner: 1, maxHaltidMin: null });
        const f = lavForslag(p);
        assert.equal(f.ikkePlaceret.length, 0);
        assert.deepEqual(f.brud, [], 'lån af fri fælles bane er ikke et regelbrud');
        assert.deepEqual(fejl(anvendForslag(p, f)), []);
        const iTidsrum = Object.values(f.plan).every((x) => x.slot >= '10:00' && x.slot < '13:00');
        assert.ok(iTidsrum, 'alle kampe ligger i rækkens tidsrum');
    });
    test('løserens problem: en låst kamp uden for rækkens tidsrum ligger på de fælles baner', () => {
        let p = nytProjekt(model([{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 4) }] }]));
        p = opdaterDag(p, '2026-11-21', { baner: 4, start: '09:00', slut: '18:00' });
        p = saetForm(p, 'U09 D HS', { formValg: 'pulje' });
        p = opdaterRaekke(p, 'U09 D', { tidligst: '12:00', senest: '15:00', reserveredeBaner: 1 });
        const k = p.kampe[0];
        p = laasKamp(flytKamp(p, k.id, '2026-11-21', '09:00'), k.id, true);
        const pr = bygProblem(p);
        assert.equal(pr.kampe.find((x) => x.id === k.id).pulje, 'faelles');
        assert.ok(pr.kampe.filter((x) => x.id !== k.id).every((x) => x.pulje === 'U09 D'));
    });
});

describe('planlæggeren: rækkens anden dag prøves, og der brydes én regel ad gangen', () => {
    // To rækker á 8 spillere i pulje (2 puljer á 4 = 12 kampe hver), to dage med 2 baner 09–13 (16 bane-slots pr. dag)
    const toRaekker = (slut = '13:00') => {
        let p = nytProjekt(model([
            { id: 'U11 C', aargang: 'U11', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('c', 8) }] },
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 8) }] },
        ], ['2026-11-21', '2026-11-22']));
        for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner: 2, start: '09:00', slut });
        p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
        for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'pulje' });
        return p;
    };
    test('forslaget fortæller, hvilke dage én-dags-rækkerne fik', () => {
        const f = lavForslag(toRaekker());
        assert.equal(f.brud.length, 0);
        assert.deepEqual(Object.keys(f.dagValg).sort(), ['U11 C', 'U11 D']);
        assert.notDeepEqual(f.dagValg['U11 C'], f.dagValg['U11 D'], 'hver sin dag');
    });
    test('dagTvang fastlægger rækkens dag', () => {
        const p = toRaekker('18:00');
        const f = lavForslag(p, { dagTvang: { 'U11 C': ['2026-11-22'] } });
        const dage = new Set(p.kampe.filter((k) => k.kategori === 'U11 C HS').map((k) => f.plan[k.id].dag));
        assert.deepEqual([...dage], ['2026-11-22']);
    });
    test('er skønnet forkert, prøves den ramte række på sin anden dag, før der brydes regler', () => {
        // Lørdag er spærret det meste af dagen, så skønnet (85 % af dagens baner) er for optimistisk for lørdag
        let p = toRaekker('13:00');
        p = opdaterDag(p, '2026-11-21', { spaerret: [{ fra: '10:00', til: '13:00', baner: 1 }] });
        const uden = lavForslag(p, { udenDagforsoeg: true });
        const med = lavForslag(p);
        assert.ok(med.brud.length + med.ikkePlaceret.length <= uden.brud.length + uden.ikkePlaceret.length);
    });
    test('en kamp, der ikke kan være på rækkens dag, flyttes til den anden dag INDEN FOR tidsvinduet — den bryder kun én regel', () => {
        // Én række med max 1 dag og for mange kampe til én dag: resten skal over på dag 2, ikke uden for tidsvinduet på dag 1
        let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 14) }] }], ['2026-11-21', '2026-11-22']));
        for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner: 1, start: '09:00', slut: '21:00' });
        p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
        p = saetForm(p, 'U11 D HS', { formValg: 'pulje' });
        const f = lavForslag(p);
        assert.equal(f.ikkePlaceret.length, 0);
        assert.ok(f.brud.length > 0, 'kan ikke være på én dag');
        const typer = new Set(tjekPlan(anvendForslag(p, f)).problemer.filter((x) => x.alvor === 'fejl').map((x) => x.type));
        assert.equal(typer.has('tidsvindue'), false, `ingen kampe uden for tidsvinduet, fik: ${[...typer].join(', ')}`);
    });
});
