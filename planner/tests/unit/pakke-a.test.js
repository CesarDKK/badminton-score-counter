// Gennemgangen 2026-10-11 (Opus 5.5 + Fable 5.1), pakke A: fejl, der kunne give et forkert program uden at nogen sagde
// det — max kampe pr. dag med Swiss-runder og mulige cupkampe, U9/U11-vejledningens højst 6 singler/5 doubler,
// puljekonflikter uden rundenumre, spærringer uden for slot-gitteret og "max dage" slået fra i stilhed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterOpsaetning, opdaterRaekke, flytKamp } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { tjekPlan } from '../../src/rules.js';
import { bygProblem } from '../../src/solver-klient.js';
import { banerISlot } from '../../src/kapacitet.js';
import { raekkePanel } from '../../src/ui/opsaetning.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21', SOEN = '2026-11-22';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const par = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${2 * i + 1}`, `${praefiks}${2 * i + 2}`]);
const typer = (p) => tjekPlan(p).problemer.map((x) => `${x.type}/${x.alvor}`);

function todage(raekker) {
    let p = nytProjekt(model(raekker, [LOER, SOEN]));
    for (const d of [LOER, SOEN]) p = opdaterDag(p, d, { baner: 8, start: '09:00', slut: '19:00' });
    return opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
}

describe('K1: max kampe pr. dag tæller Swiss-runder fuldt', () => {
    test('6 Swiss-runder i single + 5 i double = 11 kampe lørdag → fejl (max 10 ved flere dage), også i løserens grupper', () => {
        let p = todage([{ id: 'U13 B', aargang: 'U13', raekke: 'B', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('s', 8) }, { kat: 'HD', type: 'double', spillere: par('s', 12) }] }]);
        p = opdaterRaekke(p, 'U13 B', { dage: [LOER] });
        p = saetForm(p, 'U13 B HS', { formValg: 'swiss', swissRunder: 6 });
        p = saetForm(p, 'U13 B HD', { formValg: 'swiss', swissRunder: 5 });
        const f = lavForslag(p);
        const t = tjekPlan({ ...p, plan: f.plan }).problemer.filter((x) => x.type === 'max-kampe');
        assert.ok(t.length > 0, 'Tjek melder max kampe');
        assert.match(t[0].tekst, /11 kampe .*Swiss-runder.*max 10/);
        assert.ok(f.brud.some((b) => b.brud === 'max-kampe'), 'planlæggeren ved, at den bryder reglen');
        const prob = bygProblem(p);
        assert.ok(prob.mangeKampe.some((g) => g.length === 11), 'løseren har en gruppe med alle 11 (kendte + én pr. Swiss-runde)');
    });
});

describe('K1: mulige cupkampe giver en advarsel (Jesper 2026-10-11)', () => {
    test('puljer + cup i både single og double: kan nå over 10 → advarsel, ikke fejl', () => {
        let p = todage([{ id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('c', 16) }, { kat: 'HD', type: 'double', spillere: par('c', 8) }] }]);
        p = opdaterRaekke(p, 'U13 C', { dage: [LOER] });
        p = saetForm(p, 'U13 C HS', { formValg: 'pulje-cup', cupTop: 2 });
        p = saetForm(p, 'U13 C HD', { formValg: 'pulje-cup', cupTop: 2 });
        const f = lavForslag(p);
        const t = typer({ ...p, plan: f.plan });
        assert.ok(t.includes('max-kampe-mulige/advarsel'), t.join(', '));
        assert.ok(!t.includes('max-kampe/fejl'));
    });
});

describe('U9/U11-vejledningen: højst 6 singlekampe og 5 doublekampe', () => {
    test('U9 double som Swiss med 6 runder = 6 doubler → advarsel', () => {
        let p = todage([{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'D', type: 'double', spillere: par('u', 8) }] }]);
        p = saetForm(p, 'U09 D D', { formValg: 'swiss', swissRunder: 6 });
        const t = tjekPlan(p).problemer.filter((x) => x.noegle?.endsWith('max-kampe-kategori'));
        assert.equal(t.length, 1);
        assert.match(t[0].tekst, /op til 6 doublekampe.*2–5 doublekampe/);
    });
});

describe('K4: puljekonflikter afhænger ikke af rundenumre', () => {
    test('to puljekampe med samme spiller i samme slot er en fejl, selv når TP-filen mangler rundenumre', () => {
        let p = todage([{ id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 4) }] }]);
        p = saetForm(p, 'U13 D HS', { formValg: 'pulje' });
        // Som en TP-fil uden rundenumre: ingen runde og ingen afhængigheder mellem puljekampene
        p = { ...p, kampe: p.kampe.map((k) => ({ ...k, runde: 0, afhaengerAf: [] })) };
        const [a, b] = p.kampe.filter((k) => k.spillere.includes('d1'));
        p = flytKamp(flytKamp(p, a.id, LOER, '10:00'), b.id, LOER, '10:00');
        assert.ok(typer(p).includes('dobbeltbooket/fejl'));
    });
});

describe('K7: spærringer, der ikke følger slot-gitteret', () => {
    test('en spærring fra 09:45 rammer slottet 09:30 med 30-min-slots', () => {
        const dag = { dato: LOER, start: '09:00', slut: '18:00', baner: 4, spaerret: [{ fra: '09:45', til: '11:00', baner: 4 }] };
        assert.equal(banerISlot(dag, '09:30', 30), 0);
        assert.equal(banerISlot(dag, '09:00', 30), 4);
        assert.equal(banerISlot(dag, '11:00', 30), 4);
        assert.equal(banerISlot(dag, '09:30'), 4, 'uden slotlængde som før (kun slottets start)');
    });
});

describe('A4: "max dage" slået fra uden dispensation', () => {
    test('en D-række med ingen grænse for dage får et advarselsmærke; tomt felt viser reglementets 1', () => {
        let p = todage([{ id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 4) }] }]);
        assert.doesNotMatch(raekkePanel(p), /én-dags-reglen slået fra/);
        assert.match(raekkePanel(p), /data-standard="1"/);
        assert.match(raekkePanel(opdaterRaekke(p, 'U13 D', { maxDage: null })), /én-dags-reglen slået fra/);
        assert.doesNotMatch(raekkePanel(opdaterRaekke(p, 'U13 D', { maxDage: null, dispensationFlereDage: true })), /én-dags-reglen slået fra/);
    });
});
