// Fable-gennemgangen 2026-10-10, anden pakke: spillerens strengeste grænse for kampe pr. dag (M1), E-/senior-reglerne
// i løserens bredere tider (M2), reserverede baner kun i brugbare slots (M4), fejl i Tjek følger med til TP (V6) og
// ingen fødselsdato/medlemsnummer i projektet (dataminimering).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterOpsaetning, opdaterRaekke, normaliserHalvBane } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { tjekPlan } from '../../src/rules.js';
import { bygProblem } from '../../src/solver-klient.js';
import { reservationerISlot } from '../../src/kapacitet.js';
import { renderListe } from '../../src/ui/liste.js';
import { dagePanel } from '../../src/ui/opsaetning.js';
import { kandidater } from '../../src/kampprogram.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21', SOEN = '2026-11-22';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

describe('M1: max kampe pr. dag er spillerens strengeste grænse — også fra andre rækker', () => {
    test('en spiller i ungdom og senior på en éndagsturnering: planlæggeren holder senior-grænsen på 10', () => {
        // Spilleren "x" er med i fem puljer (13 kampe); ungdom alene må 12 på én dag, men med en seniorkamp er grænsen 10
        const raekker = ['U11 D', 'U11 C', 'U11 B', 'U13 D'].map((id) => ({ id, aargang: id.slice(0, 3), raekke: id.slice(-1), kategorier: [{ kat: 'HS', type: 'single', spillere: [['x'], ...enkelt(`${id[4]}`, 3)] }] }));
        raekker.push({ id: 'SEN A', aargang: 'SEN', raekke: 'A', kategorier: [{ kat: 'HS', type: 'single', spillere: [['x'], ...enkelt('s', 3)] }] });
        let p = nytProjekt(model(raekker, [LOER]));
        p = opdaterDag(p, LOER, { baner: 8, start: '09:00', slut: '22:00' });
        p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
        for (const r of raekker) p = saetForm(p, `${r.id} HS`, { formValg: 'pulje' });
        const g = lavForslag(p);
        // Hver kamp ud over 10 skal planlæggeren have registreret som brud (så kortene kan foreslå en løsning)
        const xKampe = p.kampe.filter((k) => k.spillere.includes('x') && g.plan[k.id]?.dag === LOER).map((k) => k.id);
        const brudX = g.brud.filter((b) => b.brud === 'max-kampe' && xKampe.includes(b.id)).length;
        assert.ok(xKampe.length > 10, 'scenariet giver spilleren mere end 10 kampe');
        assert.ok(xKampe.length - brudX <= 10, `${xKampe.length} kampe, men kun ${brudX} registreret som brud`);
        assert.ok(tjekPlan({ ...p, plan: g.plan }).problemer.some((x) => x.type === 'max-kampe'), 'Tjek melder det også');
    });
});

describe('M2: E-rækkens dagsregler gælder også i løserens bredere tider', () => {
    test('puljekampe må ikke flyttes til sidste dag, heller ikke når rækken bryder sine dage', () => {
        let p = nytProjekt(model([{ id: 'SEN E', aargang: 'SEN', raekke: 'E', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('e', 12) }] }], [LOER, SOEN]));
        for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner: 4, start: '09:00', slut: '20:00', foerSkoledag: false });
        p = saetForm(p, 'SEN E HS', { formValg: 'pulje-cup', cupTop: 2 });
        p = opdaterRaekke(p, 'SEN E', { dage: [LOER] });
        const prob = bygProblem(p);
        const e = prob.elastisk.find((x) => x.raekke === 'SEN E');
        assert.ok(e.dage.length, 'søndagens tider er med som brud på rækkens dage');
        const forbudt = new Map(e.forbudt.map(([i, t]) => [i, new Set(t)]));
        const soendag = e.dage.filter((t) => t >= 1440);
        prob.kampe.forEach((k, i) => {
            const kamp = p.kampe.find((x) => x.id === k.id);
            const erSemiEllerFinale = kamp.fase === 'cup' && ['Semifinale', 'Finale'].includes(kamp.rundeNavn);
            if (!erSemiEllerFinale) assert.ok(soendag.every((t) => forbudt.get(i)?.has(t)), `${kamp.navn} må ikke ligge søndag`);
        });
        const alt = prob.alternativer.find((a) => a.regel === 'dage' && a.raekke === 'SEN E');
        assert.ok(alt?.forbudt?.length, 'diagnosens "alle dage" har de samme undtagelser');
    });
});

describe('M4: reserverede baner spærres kun i slots, rækken selv kan bruge', () => {
    test('med 45-min-slots og tidsrum til 16:00 er 15:45 ikke reserveret', () => {
        const dag = { dato: LOER, start: '09:00', slut: '20:00', baner: 8 };
        const raekker = [{ id: 'U09 D', reserveredeBaner: 4, dage: [LOER], tidligst: '12:00', senest: '16:00' }];
        assert.deepEqual([...reservationerISlot(raekker, dag, '15:00', 45)], [['U09 D', 4]]);
        assert.deepEqual([...reservationerISlot(raekker, dag, '15:45', 45)], []);
        assert.deepEqual([...reservationerISlot(raekker, dag, '15:45')], [['U09 D', 4]], 'uden slotlængde som før');
    });
});

describe('V6: fejl i Tjek følger med til TP og på udskriften', () => {
    const projekt = () => ({ turnering: { navn: 'T', hal: '', dage: [LOER] }, opsaetning: { slotMin: 30, dage: [] }, kategorier: [], kampe: [], plan: {}, tilmeldinger: {} });
    test('ingen fejl: ingen advarsel', () => {
        const c = {};
        renderListe(c, projekt(), {}, 0);
        assert.doesNotMatch(c.innerHTML, /fejl i Tjek/);
    });
    test('fejl: advarsel både på skærmen og i udskriftens hoved', () => {
        const c = {};
        renderListe(c, projekt(), {}, 3);
        assert.equal((c.innerHTML.match(/3 fejl i Tjek/g) || []).length, 2);
    });
});

describe('Idé 4: flere baner end i TP-filen siges tydeligt', () => {
    test('mærket vises kun, når dagen har flere baner end TP', () => {
        let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['a'], ['b']] }] }], [LOER]));
        p = { ...p, tpGitter: { ...p.tpGitter, baner: { ...p.tpGitter.baner, hele: 4 } } };
        assert.doesNotMatch(dagePanel(opdaterDag(p, LOER, { baner: 4 })), /flere end TP/);
        assert.match(dagePanel(opdaterDag(p, LOER, { baner: 6 })), /flere end TP's 4/);
    });
});

describe('Idé 3: pause på dagen prøves også, når der mangler plads', () => {
    test('et pladskort får "pausen gives på dagen" som kandidat (prøves og vises kun, hvis det hjælper)', () => {
        let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('s', 6) }] }], [LOER]));
        p = opdaterRaekke(p, 'U11 D', { dage: [LOER] });
        const plads = { noegle: 'plads|U11 D', familie: 'plads', raekke: 'U11 D', kampe: [], aarsager: new Set() };
        const priser = (q) => kandidater(q, plads).flatMap((x) => x.trin.map((t) => t.pris));
        assert.ok(priser(opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, ABCD: 10 } })).includes('pause'));
        assert.ok(!priser(opdaterOpsaetning(p, { pauseMin: { ABCD: 0, M: 0, E: 0, faelles: null } })).includes('pause'), 'ingen pause at give på dagen');
    });
});

describe('Dataminimering: fødselsdato og medlemsnummer', () => {
    test('fjernes fra et projekt, der er gemt med dem', () => {
        const p = normaliserHalvBane({ ...nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['a'], ['b']] }] }])) });
        const gammel = { ...p, spillere: { a: { ...p.spillere.a, foedt: '2015-01-01', memberid: 'M1' } } };
        const ny = normaliserHalvBane(gammel);
        assert.equal('foedt' in ny.spillere.a, false);
        assert.equal('memberid' in ny.spillere.a, false);
        assert.equal(ny.spillere.a.fornavn, 'a');
    });
});
