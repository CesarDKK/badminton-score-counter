// Pakke 3: én kapacitetsberegning. Formvalget ser samme hal som planlæggeren — rækkens dage efter
// dagfordelingen, årgangens tidsvindue og rækkens tidsrum — og resultatet afhænger ikke af, hvilken
// rækkefølge kategorierne står i.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, genberegnKampe, kapacitetTilKategori, lavKapacitetsmodel } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { lavRegelmodel } from '../../src/regelmodel.js';
import { pladsPaaDag, fordelRaekkerPaaDage, FYLDNINGSGRAD } from '../../src/kapacitet.js';
import { model } from '../hjaelp/model.js';

const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const LOER = '2026-11-21', SOEN = '2026-11-22';
const kat = (p, id) => p.kategorier.find((k) => k.id === id);

function toRaekker({ baner = 2, slut = '13:00', spillere = 8 } = {}) {
    let p = nytProjekt(model([
        { id: 'U11 C', aargang: 'U11', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('c', spillere) }] },
        { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', spillere) }] },
    ], [LOER, SOEN]));
    for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner, start: '09:00', slut, foerSkoledag: false });
    return p;
}

describe('pladsPaaDag: den ene pladsberegning', () => {
    test('kun slots i årgangens tidsvindue og rækkens eget tidsrum tæller', () => {
        let p = toRaekker({ slut: '21:00' });
        const M = lavRegelmodel(p);
        const dag = p.opsaetning.dage[0];
        // U11 må spille 09–19 = 20 slots á 2 baner, selv om hallen er åben til 21
        assert.equal(pladsPaaDag(M, p.raekker[0], dag, p.raekker).faelles, 40);
        p = opdaterRaekke(p, 'U11 C', { tidligst: '12:00', senest: '15:00' });
        assert.equal(pladsPaaDag(lavRegelmodel(p), p.raekker[0], dag, p.raekker).faelles, 12);
    });
    test('reserverede baner: rækkens egne tælles for sig, og de fælles er resten', () => {
        const p = opdaterRaekke(toRaekker({ baner: 4 }), 'U11 C', { reserveredeBaner: 1 });
        const M = lavRegelmodel(p);
        const dag = p.opsaetning.dage[0];
        assert.deepEqual(pladsPaaDag(M, p.raekker[0], dag, p.raekker), { faelles: 24, egne: 8 });
        assert.deepEqual(pladsPaaDag(M, p.raekker[1], dag, p.raekker), { faelles: 24, egne: 0 });
    });
});

describe('kapacitet til formvalget', () => {
    test('en række med max 1 dag og to mulige dage får ÉN dags plads — ikke begge lagt sammen', () => {
        const p = toRaekker();
        const enDag = FYLDNINGSGRAD * 16; // 8 slots á 2 baner
        assert.equal(kapacitetTilKategori(p, kat(p, 'U11 C HS')), enDag);
        const medDispensation = opdaterRaekke(p, 'U11 C', { dispensationFlereDage: true });
        assert.equal(kapacitetTilKategori(medDispensation, kat(medDispensation, 'U11 C HS')), 2 * enDag);
    });
    test('årgangens tidsvindue tæller med: U11 får ikke plads efter kl. 19', () => {
        const p = opdaterRaekke(toRaekker({ slut: '21:00' }), 'U11 C', { dispensationFlereDage: true });
        assert.equal(kapacitetTilKategori(p, kat(p, 'U11 C HS')), FYLDNINGSGRAD * 80);
    });
    test('dagfordelingen er planlæggerens egen: formvalget og forslaget lægger rækkerne på samme dage', () => {
        let p = toRaekker();
        for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'pulje' });
        const last = new Map(p.raekker.map((r) => [r.id, p.kampe.filter((k) => k.kategori.startsWith(r.id)).length]));
        const valg = fordelRaekkerPaaDage(lavRegelmodel(p), p, { last });
        const f = lavForslag(p);
        for (const r of p.raekker) assert.deepEqual([...valg.get(r.id)], f.dagValg[r.id]);
    });
    test('en anden række belaster kun den dag, den selv ligger på', () => {
        let p = toRaekker();
        for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'pulje' });
        const kap = lavKapacitetsmodel(p);
        const c = kat(p, 'U11 C HS'), d = kat(p, 'U11 D HS');
        // De to rækker er fordelt på hver sin dag, så D's 12 kampe tager ikke plads fra C
        assert.equal(kap.ledig(c, new Map([[d.id, 12]])), kap.ledig(c));
        // Spiller de samme dag, trækkes de fra
        const samme = opdaterRaekke(opdaterRaekke(p, 'U11 C', { dage: [LOER] }), 'U11 D', { dage: [LOER] });
        const kap2 = lavKapacitetsmodel(samme);
        assert.equal(kap2.ledig(c, new Map([[d.id, 12]])), kap2.ledig(c) - 12);
    });
    test('en række med senere tidsrum belaster kun med den del, der overlapper', () => {
        let p = toRaekker({ slut: '17:00' });
        p = opdaterRaekke(opdaterRaekke(p, 'U11 C', { dage: [LOER], senest: '13:00' }), 'U11 D', { dage: [LOER] });
        const kap = lavKapacitetsmodel(p);
        const c = kat(p, 'U11 C HS'), d = kat(p, 'U11 D HS');
        // D har 09–17 (16 slots), C kun 09–13 (8 slots): halvdelen af D's last falder i C's tidsrum
        assert.equal(kap.ledig(c, new Map([[d.id, 10]])), kap.ledig(c) - 5);
    });
});

describe('formvalget afhænger ikke af kategoriernes rækkefølge', () => {
    const byg = (vend) => {
        let p = nytProjekt(model([{ id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [
            { kat: 'HS', type: 'single', spillere: enkelt('h', 12) },
            { kat: 'DS', type: 'single', spillere: enkelt('d', 12) },
            { kat: 'HD', type: 'double', spillere: Array.from({ length: 6 }, (_, i) => [`h${2 * i + 1}`, `h${2 * i + 2}`]) },
            { kat: 'DD', type: 'double', spillere: Array.from({ length: 6 }, (_, i) => [`d${2 * i + 1}`, `d${2 * i + 2}`]) },
        ] }]));
        p = opdaterDag(p, LOER, { baner: 5, start: '09:00', slut: '18:00' }); // knebent: den gamle beregning gav HS 4 runder og DS 6 — eller omvendt, alt efter rækkefølgen
        p = { ...p, opsaetning: { ...p.opsaetning, formKriterie: 'flest' } };
        if (vend) p = { ...p, kategorier: [...p.kategorier].reverse() };
        for (const k of p.kategorier) p = { ...p, kategorier: p.kategorier.map((x) => (x.id === k.id ? { ...x, formValg: 'auto' } : x)) };
        p = genberegnKampe(p);
        return Object.fromEntries(p.kategorier.map((k) => [k.id, `${k.formForslag.form} ${k.formForslag.runder || ''} ${k.formForslag.kampe} ${!!k.formForslag.passerIkke}`]).sort());
    };
    test('samme former, uanset om kategorierne står forfra eller bagfra', () => {
        assert.deepEqual(byg(true), byg(false));
    });
    test('to ens kategorier får samme form (ingen "den første betaler")', () => {
        const f = byg(false);
        assert.equal(f['U13 C HS'], f['U13 C DS']);
        assert.equal(f['U13 C HD'], f['U13 C DD']);
    });
});

describe('kriteriet "flest kampe": en stor række kan ikke klemme en lille ud', () => {
    const byg = (kriterie) => {
        let p = nytProjekt(model([
            { id: 'U11 B', aargang: 'U11', raekke: 'B', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('b', 16) }] },
            { id: 'U11 C', aargang: 'U11', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('c', 8) }] },
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 24) }] },
        ], [LOER, SOEN]));
        p = opdaterDag(p, LOER, { baner: 1, start: '09:00', slut: '13:00', foerSkoledag: false }); // lørdag: næsten ingen plads
        p = opdaterDag(p, SOEN, { baner: 8, start: '09:00', slut: '17:00', foerSkoledag: false }); // søndag: 128 bane-slots
        p = { ...p, opsaetning: { ...p.opsaetning, formKriterie: kriterie }, kategorier: p.kategorier.map((k) => ({ ...k, formValg: 'auto' })) };
        return genberegnKampe(p);
    };
    test('dagene fordeles efter det, rækkerne MINDST skal have — alle tre får plads søndag', () => {
        for (const kriterie of ['faerrest', 'flest']) {
            const p = byg(kriterie);
            assert.deepEqual(p.kategorier.filter((k) => k.formForslag.passerIkke).map((k) => k.id), [], kriterie);
            assert.ok(p.kampe.length <= FYLDNINGSGRAD * 136, `${kriterie}: ${p.kampe.length} kampe`);
            const f = lavForslag(p);
            assert.equal(f.brud.length + f.ikkePlaceret.length, 0, `${kriterie}: planlæggeren kan lægge det hele`);
        }
    });
    test('"flest kampe" giver flere kampe end "færrest", og det, der er til overs, deles — den største tager ikke det hele', () => {
        const faerrest = byg('faerrest'), flest = byg('flest');
        assert.ok(flest.kampe.length > faerrest.kampe.length);
        const runder = Object.fromEntries(flest.kategorier.map((k) => [k.id, k.formForslag.minKampe]));
        assert.ok(Math.max(...Object.values(runder)) - Math.min(...Object.values(runder)) <= 2, JSON.stringify(runder));
    });
});
