// Tests af turneringsform (form.js) og genberegning af kampe (store.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formMuligheder, foreslaaForm, byggKampe, puljeRunder, puljeFordeling, fordelIPuljer, seedOrden, seedTilmeldinger, minKampeKrav } from '../../src/form.js';
import { STANDARD_REGLER, nytProjekt, saetForm, opdaterFormKriterie, genindlaes, anvendForslag } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag } from '../../src/scheduler.js';

const regler = STANDARD_REGLER;
const u11dHS = { id: 'U11 D HS', kat: 'HS', type: 'single', halvBane: false };
const u11dHD = { id: 'U11 D HD', kat: 'HD', type: 'double', halvBane: false };
const u9HS = { id: 'U09 D HS', kat: 'HS', type: 'single', halvBane: true };
const u11d = { id: 'U11 D', aargang: 'U11', raekke: 'D' };
const u9d = { id: 'U09 D', aargang: 'U09', raekke: 'D' };
const u13m = { id: 'U13 M', aargang: 'U13', raekke: 'M' };

describe('form: hjælpere', () => {
    test('puljefordeling og rundeplan', () => {
        assert.deepEqual(puljeFordeling(11, 4), [4, 4, 3]);
        assert.deepEqual(puljeFordeling(39, 3), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
        assert.deepEqual(puljeFordeling(5, 5), [5]);
        const r4 = puljeRunder(4);
        assert.equal(r4.length, 3);
        assert.equal(r4.flat().length, 6, 'alle 6 kampe i en 4-pulje');
        const r3 = puljeRunder(3);
        assert.equal(r3.length, 3);
        assert.deepEqual(r3.map((x) => x.length), [1, 1, 1]);
        assert.equal(new Set(r3.flat().map((p) => p.join('-'))).size, 3);
    });
    test('slangeseedning og cup-seedning', () => {
        const d = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n }));
        const p = fordelIPuljer(d, [3, 2, 2]);
        assert.deepEqual(p.map((x) => x.map((y) => y.n)), [[1, 6, 7], [2, 5], [3, 4]]);
        assert.deepEqual(seedOrden(8), [1, 8, 4, 5, 2, 7, 3, 6]);
        const spillere = { a: { point: { HS: 900 } }, b: { point: { HS: 1200 } }, c: {} };
        assert.deepEqual(seedTilmeldinger([{ spillere: ['a'] }, { spillere: ['b'] }, { spillere: ['c'] }], spillere, 'HS').map((t) => t.spillere[0]), ['b', 'a', 'c']);
    });
    test('minimum kampe pr. kategori', () => {
        assert.equal(minKampeKrav(u11dHS, u11d, regler), 4);
        assert.equal(minKampeKrav(u11dHD, u11d, regler), 2);
        assert.equal(minKampeKrav(u11dHS, u13m, regler), 2);
    });
});

describe('form: valg af turneringsform', () => {
    test('muligheder for 39 spillere indeholder puljer, pulje+cup og Swiss', () => {
        const m = formMuligheder(39, { cupTop: 1 });
        const former = new Set(m.map((x) => x.form));
        assert.deepEqual([...former].sort(), ['pulje', 'pulje-cup', 'swiss']);
        const pc3 = m.find((x) => x.form === 'pulje-cup' && x.stoerrelse === 3);
        assert.equal(pc3.puljer.length, 13);
        assert.equal(pc3.kampe, 39 + 12, '39 puljekampe + cup for 13 vindere');
        assert.equal(pc3.minKampe, 2);
        const sw4 = m.find((x) => x.form === 'swiss' && x.runder === 4);
        assert.equal(sw4.kampe, 19 * 4);
        assert.equal(sw4.minKampe, 3, 'ulige felt: én oversidder pr. runde');
    });
    test('automatisk: U11 D HS med 39 kræver 4 kampe → færrest bane-slots der opfylder', () => {
        const f = foreslaaForm(39, u11dHS, u11d, regler, { form: 'auto', kriterie: 'faerrest' });
        assert.ok(f.opfylderKrav, f.tekst);
        assert.ok(f.minKampe >= 4);
        const alle = formMuligheder(39).filter((x) => x.minKampe >= 4);
        assert.equal(f.baneSlots, Math.min(...alle.map((x) => x.baneSlots)));
    });
    test('automatisk: U9-single med 19 → Swiss Ladder på halve baner, U11 D HD med 9 par → puljer', () => {
        const f9 = foreslaaForm(19, u9HS, u9d, regler, { form: 'auto' });
        assert.ok(f9.opfylderKrav);
        assert.equal(f9.form, 'swiss');
        assert.equal(f9.baneSlots, f9.kampe / 2, 'halve baner');
        const fhd = foreslaaForm(9, u11dHD, u11d, regler, { form: 'auto' });
        assert.ok(fhd.opfylderKrav);
        assert.ok(fhd.form === 'pulje-cup' || fhd.form === 'pulje');
    });
    test('ønsket form respekteres, og "flest" giver flere kampe end "færrest"', () => {
        const sw = foreslaaForm(20, u11dHS, u11d, regler, { form: 'swiss' });
        assert.equal(sw.form, 'swiss');
        const faerrest = foreslaaForm(20, u11dHS, u11d, regler, { form: 'auto', kriterie: 'faerrest' });
        const flest = foreslaaForm(20, u11dHS, u11d, regler, { form: 'auto', kriterie: 'flest' });
        assert.ok(flest.minKampe >= faerrest.minKampe);
        assert.ok(flest.baneSlots >= faerrest.baneSlots);
    });
    test('kan kravet ikke opfyldes, vælges flest kampe til de færreste', () => {
        const f = foreslaaForm(3, u11dHS, u11d, regler, { form: 'auto' });
        assert.equal(f.opfylderKrav, false);
        assert.equal(f.minKampe, 2, 'én pulje á 3');
        assert.equal(foreslaaForm(1, u11dHS, u11d, regler), null);
    });
});

describe('form: bygning af kampe', () => {
    const tilm = (n, praefiks = 's') => Array.from({ length: n }, (_, i) => ({ spillere: [`${praefiks}${i + 1}`] }));
    test('pulje + cup: puljekampe med kendte spillere, cup med mulige spillere og afhængigheder', () => {
        const form = foreslaaForm(7, u11dHS, u11d, regler, { form: 'pulje-cup', cupTop: 1 });
        const kampe = byggKampe(u11dHS, tilm(7), form);
        const pulje = kampe.filter((k) => k.fase === 'pulje');
        const cup = kampe.filter((k) => k.fase === 'cup');
        assert.equal(pulje.length, form.puljer.reduce((s, p) => s + (p * (p - 1)) / 2, 0));
        assert.ok(pulje.every((k) => k.spillere.length === 2 && k.genereret));
        assert.equal(cup.length, form.puljer.length - 1);
        assert.ok(cup.every((k) => k.spillere.length === 0 && k.muligeSpillere.length >= 2 && k.afhaengerAf.length > 0));
        assert.ok(cup.some((k) => k.rundeNavn === 'Finale'));
        const ids = new Set(kampe.map((k) => k.id));
        assert.equal(ids.size, kampe.length, 'unikke id');
        for (const k of kampe) for (const d of k.afhaengerAf) assert.ok(ids.has(d));
        // puljerunde 2 afhænger af runde 1
        const r2 = pulje.find((k) => k.runde === 2 && k.gruppe === 'Pulje 1');
        assert.ok(r2.afhaengerAf.length >= 1);
    });
    test('cup for de to bedste', () => {
        const form = foreslaaForm(8, u11dHS, u11d, regler, { form: 'pulje-cup', cupTop: 2 });
        const kampe = byggKampe(u11dHS, tilm(8), form);
        const cup = kampe.filter((k) => k.fase === 'cup');
        assert.equal(form.cupDeltagere, Math.min(form.puljer.length * 2, 8));
        assert.equal(cup.length, form.cupDeltagere - 1);
    });
    test('Swiss Ladder: runde 1 parret, runde 2+ pladsholdere med alle som mulige', () => {
        const form = foreslaaForm(19, u9HS, u9d, regler, { form: 'swiss' });
        const kampe = byggKampe(u9HS, tilm(19), form);
        assert.equal(kampe.length, 9 * form.runder);
        assert.equal(kampe.filter((k) => k.runde === 1 && k.spillere.length === 2).length, 9);
        const r2 = kampe.filter((k) => k.runde === 2);
        assert.equal(r2.length, 9);
        assert.equal(r2[0].muligeSpillere.length, 19);
        assert.equal(r2[0].afhaengerAf.length, 9);
    });
    test('doubler: to spillere pr. tilmelding', () => {
        const par = Array.from({ length: 6 }, (_, i) => ({ spillere: [`a${i}`, `b${i}`] }));
        const form = foreslaaForm(6, u11dHD, u11d, regler, { form: 'pulje' });
        const kampe = byggKampe(u11dHD, par, form);
        assert.ok(kampe.every((k) => k.spillere.length === 4));
    });
});

describe('form: i projektet', () => {
    function model() {
        const sp = (id) => [id, { id, fornavn: id, efternavn: 'X', koen: 'H', foedt: null, klub: 'K', memberid: null, niveau: {}, point: { HS: 1000 + Number(id.slice(1)) } }];
        const spillere = Object.fromEntries(Array.from({ length: 12 }, (_, i) => sp(`p${i + 1}`)));
        return {
            version: 1, kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null },
            turnering: { navn: 'T', hal: '', dage: ['2026-11-21', '2026-11-22'] },
            tpGitter: { slotMin: 30, dage: [], baner: { hele: 4, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
            raekker: [{ id: 'U11 D', aargang: 'U11', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U11 D HS'] }],
            kategorier: [{ id: 'U11 D HS', eventId: 1, raekke: 'U11 D', aargang: 'U11', kat: 'HS', type: 'single', mix: false, form: 'pulje', tilmeldte: 12, kampe: 1, runder: 0, halvBane: false }],
            spillere,
            // TP har kun én "kamp" for kategorien (ufuldstændig lodtrækning)
            kampe: [{ id: 'd1:1002', kategori: 'U11 D HS', fase: 'pulje', gruppe: 'Pulje 1', runde: 1, navn: 'Pulje 1 #1 – #2', spillere: ['p1', 'p2'], muligeSpillere: ['p1', 'p2'], afhaengerAf: [], tpRef: { draw: 1, planning: 1002, van1: 1000, van2: 2000, matchnr: 1 }, tpTid: null, varighed: 0 }],
            tilmeldinger: { 'U11 D HS': Object.keys(spillere).map((id, i) => ({ entry: i + 1, spillere: [id] })) },
            bemaerkninger: [],
        };
    }
    test('fra TP → automatisk → tilbage til TP', () => {
        const p = nytProjekt(model());
        assert.equal(p.kampe.length, 1);
        const p2 = saetForm(p, 'U11 D HS', { formValg: 'auto' });
        const form = p2.kategorier[0].formForslag;
        assert.ok(form && form.opfylderKrav, 'automatisk opfylder kravet på 4 kampe');
        assert.equal(p2.kampe.length, form.kampe);
        assert.ok(p2.kampe.every((k) => k.genereret));
        // 12 spillere med krav om 4 kampe: puljer á 3–5 giver højst 3, så automatisk vælger Swiss Ladder
        assert.equal(form.form, 'swiss');
        // seedning: p12 (flest point) er seedet 1 og spiller runde 1's første kamp
        assert.ok(p2.kampe.find((k) => k.id.endsWith(':r1:1')).spillere.includes('p12'));
        // med pulje + cup ligger p12 i pulje 1
        const pp = saetForm(p, 'U11 D HS', { formValg: 'pulje-cup' });
        assert.ok(pp.kampe.some((k) => k.gruppe === 'Pulje 1' && k.spillere.includes('p12')));
        const p3 = saetForm(p2, 'U11 D HS', { formValg: 'tp' });
        assert.equal(p3.kampe.length, 1);
        assert.equal(p3.kampe[0].id, 'd1:1002');
    });
    test('forslag kan planlægges uden fejl, og kriterie/cupTop ændrer kampene', () => {
        let p = saetForm(nytProjekt(model()), 'U11 D HS', { formValg: 'pulje-cup', cupTop: 1 });
        const f = lavForslag(p);
        assert.equal(f.brud.length + f.ikkePlaceret.length, 0);
        assert.deepEqual(tjekPlan(anvendForslag(p, f)).problemer.filter((x) => x.alvor === 'fejl'), []);
        const n1 = p.kampe.length;
        p = saetForm(p, 'U11 D HS', { cupTop: 2 });
        assert.ok(p.kampe.length > n1, 'cup for de to bedste giver flere kampe');
        const pf = opdaterFormKriterie(saetForm(p, 'U11 D HS', { formValg: 'auto' }), 'flest');
        assert.equal(pf.opsaetning.formKriterie, 'flest');
        assert.ok(pf.kategorier[0].formForslag.minKampe >= 4);
    });
    test('genindlæsning: TP-lodtrækning for kategorien sætter den tilbage til "fra TP"', () => {
        const p = saetForm(nytProjekt(model()), 'U11 D HS', { formValg: 'swiss' });
        assert.ok(p.kampe.every((k) => k.fase === 'swiss'));
        const p2 = genindlaes(p, model(), { behold: true });
        assert.equal(p2.kategorier[0].formValg, 'tp');
        assert.equal(p2.kampe.length, 1);
        const m = model(); m.kampe = [];
        const p3 = genindlaes(p, m, { behold: true });
        assert.equal(p3.kategorier[0].formValg, 'swiss', 'ingen lodtrækning i filen → valget bevares');
        assert.ok(p3.kampe.length > 1);
    });
});
