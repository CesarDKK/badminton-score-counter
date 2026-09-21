// Pakke 3: tider og låse følger KAMPEN, ikke id'et. Kamp-id'erne følger positionen i lodtrækningen, så når
// kampene bygges om (ny puljeinddeling, ændret cupTop, et afbud), kan samme id dække en helt anden kamp.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, genberegnKampe, genberegnEfterOpsaetning, flytKamp, laasKamp, overfoerPlan, kampSignatur, anvendForslag } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { model } from '../hjaelp/model.js';

const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const DAG = '2026-11-21';
const KAT = 'U13 C HS';

function projekt(n = 8, form = { formValg: 'pulje' }) {
    let p = nytProjekt(model([{ id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', n) }] }]));
    p = opdaterDag(p, DAG, { baner: 4, start: '09:00', slut: '20:00' });
    return saetForm(p, KAT, form);
}
const medPlan = (p) => anvendForslag(p, lavForslag(p));
/** Hvem spiller på hvilken tid: "dag slot" → sorterede spillere (kun kampe med kendte spillere). */
const hvemHvornaar = (p) => new Map(p.kampe.filter((k) => p.plan[k.id] && k.spillere.length).map((k) => [[...k.spillere].sort().join('+'), `${p.plan[k.id].dag} ${p.plan[k.id].slot}`]));

describe('overfoerPlan: tiden følger kampen', () => {
    test('samme kamp under nyt id beholder tid og lås; et gammelt id, der nu dækker en anden kamp, mister tiden', () => {
        const kamp = (id, spillere) => ({ id, kategori: KAT, fase: 'pulje', runde: 1, gruppe: 'Pulje 1', spillere, genereret: true, navn: id });
        const gamle = [kamp('x:1', ['a', 'b']), kamp('x:2', ['c', 'd'])];
        const nye = [kamp('x:1', ['c', 'd']), kamp('x:9', ['a', 'b']), kamp('x:3', ['e', 'f'])];
        const ud = overfoerPlan(gamle, nye, { 'x:1': { dag: DAG, slot: '09:00' }, 'x:2': { dag: DAG, slot: '10:00' } }, ['x:2']);
        assert.deepEqual(ud.plan, { 'x:1': { dag: DAG, slot: '10:00' }, 'x:9': { dag: DAG, slot: '09:00' } });
        assert.deepEqual(ud.laast, ['x:1']);
        assert.equal(ud.mistet, 0);
    });
    test('kampe uden kendte spillere kendes på deres plads i forløbet — to Swiss-kampe i samme runde forveksles ikke', () => {
        const p = projekt(8, { formValg: 'swiss', swissRunder: 3 });
        const runde2 = p.kampe.filter((k) => k.runde === 2);
        assert.equal(new Set(runde2.map(kampSignatur)).size, runde2.length);
    });
});

describe('genberegnKampe: planen overlever, at kampene bygges om', () => {
    test('pulje → pulje + cup: puljekampene er de samme og beholder deres tider; cupkampene er nye', () => {
        const foer = medPlan(projekt(8));
        const efter = saetForm(foer, KAT, { formValg: 'pulje-cup' });
        assert.deepEqual(hvemHvornaar(efter), hvemHvornaar(foer));
        assert.ok(efter.kampe.filter((k) => k.fase === 'cup').every((k) => !efter.plan[k.id]));
    });
    test('cupTop 1 → 2: id\'et cup:1001 var finalen og er nu en semifinale — den arver IKKE finalens tid', () => {
        let p = medPlan(projekt(8, { formValg: 'pulje-cup', cupTop: 1 }));
        const finale = p.kampe.find((k) => k.rundeNavn === 'Finale');
        p = laasKamp(p, finale.id, true);
        const efter = saetForm(p, KAT, { cupTop: 2 });
        const samme = efter.kampe.find((k) => k.id === finale.id);
        assert.equal(samme.rundeNavn, 'Semifinale', 'samme id, anden kamp');
        assert.equal(efter.plan[samme.id], undefined);
        assert.equal(efter.laast.includes(samme.id), false);
        assert.deepEqual(hvemHvornaar(efter), hvemHvornaar(p), 'puljekampene er uændrede');
    });
    test('et afbud flytter seedningen: ingen kamp arver en tid fra en kamp med andre spillere', () => {
        const foer = medPlan(projekt(9));
        const gamle = hvemHvornaar(foer);
        const tilmeldinger = { ...foer.tilmeldinger, [KAT]: foer.tilmeldinger[KAT].filter((t) => t.spillere[0] !== 'a2') };
        const efter = genberegnKampe({ ...foer, tilmeldinger });
        const nye = hvemHvornaar(efter);
        assert.ok(nye.size > 0, 'nogle kampe er stadig de samme og beholder deres tid');
        for (const [par, tid] of nye) assert.equal(gamle.get(par), tid, `${par} har fået en tid, der ikke var dens`);
        assert.ok([...nye.keys()].every((par) => !par.split('+').includes('a2')));
    });
    test('låsen følger kampen', () => {
        let p = projekt(8);
        const k = p.kampe[3];
        p = laasKamp(flytKamp(p, k.id, DAG, '12:00'), k.id, true);
        const efter = saetForm(p, KAT, { formValg: 'pulje-cup' });
        const samme = efter.kampe.find((x) => kampSignatur(x) === kampSignatur(k));
        assert.deepEqual(efter.plan[samme.id], { dag: DAG, slot: '12:00' });
        assert.deepEqual(efter.laast, [samme.id]);
    });
    test('Swiss Ladder 4 → 3 runder: runde 1–3 beholder deres tider', () => {
        const foer = medPlan(projekt(8, { formValg: 'swiss', swissRunder: 4 }));
        const efter = saetForm(foer, KAT, { swissRunder: 3 });
        assert.equal(efter.kampe.length, 12);
        for (const k of efter.kampe) assert.deepEqual(efter.plan[k.id], foer.plan[k.id]);
    });
});

describe('ændret opsætning bygger kampene på ny (det automatiske formvalg afhænger af pladsen)', () => {
    const auto = (baner) => {
        let p = nytProjekt(model([{ id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 12) }] }]));
        p = opdaterDag(p, DAG, { baner, start: '09:00', slut: '18:00' });
        p = { ...p, opsaetning: { ...p.opsaetning, formKriterie: 'flest' } };
        return saetForm(p, KAT, { formValg: 'auto' });
    };
    test('færre baner → en mindre form, og brugeren får at vide, hvad der skete', () => {
        const foer = medPlan(auto(6));
        const r = genberegnEfterOpsaetning(foer, opdaterDag(foer, DAG, { baner: 1 }));
        assert.ok(r.projekt.kampe.length < foer.kampe.length, `${foer.kampe.length} → ${r.projekt.kampe.length} kampe`);
        assert.deepEqual(r.aendringer.map((a) => a.kategori), [KAT]);
        assert.equal(r.mistedeTider, Object.keys(foer.plan).length - Object.keys(r.projekt.plan).length);
        assert.ok(Object.keys(r.projekt.plan).every((id) => r.projekt.kampe.some((k) => k.id === id)));
    });
    test('en ændring uden betydning for formen rører hverken kampe eller plan', () => {
        const foer = medPlan(auto(6));
        const r = genberegnEfterOpsaetning(foer, opdaterDag(foer, DAG, { slut: '19:00' }));
        assert.deepEqual(r.aendringer, []);
        assert.equal(r.mistedeTider, 0);
        assert.deepEqual(r.projekt.plan, foer.plan);
        assert.deepEqual(r.projekt.kampe.map((k) => k.id), foer.kampe.map((k) => k.id));
    });
    test('kategorier fra TP berøres ikke', () => {
        const p = nytProjekt(model([{ id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 6) }] }]));
        const r = genberegnEfterOpsaetning(p, opdaterDag(p, DAG, { baner: 1 }));
        assert.deepEqual(r.aendringer, []);
        assert.deepEqual(r.projekt.kampe, p.kampe);
    });
});
