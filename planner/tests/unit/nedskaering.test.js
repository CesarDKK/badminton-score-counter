// Tests af nedskæringsforslagene (nedskaering.js), dagfordelingen af én-dags-rækker
// (scheduler.js) og at den automatiske form aldrig vælger den STØRSTE form, når der mangler plads.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { tjekPlan } from '../../src/rules.js';
import { nedskaeringsForslag, alleNedskaeringer, anvendNedskaering, kapacitetsRegnskab, underKrav, swissKandidater, MIN_RUNDER } from '../../src/nedskaering.js';

/** raekker: [{ id, aargang, raekke, kategorier: [{ kat, type, antal }] }] */
function model(raekker, dage = ['2026-11-21', '2026-11-22']) {
    const spillere = {}, kategorier = [], tilmeldinger = {};
    let nr = 0, ev = 0;
    for (const r of raekker) for (const k of r.kategorier) {
        const id = `${r.id} ${k.kat}`;
        ev += 1;
        kategorier.push({ id, eventId: ev, raekke: r.id, aargang: r.aargang, kat: k.kat, type: k.type, mix: false, form: 'ingen lodtrækning', tilmeldte: 0, kampe: 0, runder: 0, halvBane: false });
        tilmeldinger[id] = [];
        for (let i = 0; i < k.antal; i += 1) {
            const ids = [];
            for (let j = 0; j < (k.type === 'single' ? 1 : 2); j += 1) { nr += 1; const sid = `s${nr}`; spillere[sid] = { id: sid, fornavn: sid, efternavn: 'X', koen: 'H', foedt: null, klub: 'K', memberid: null, niveau: {}, point: {} }; ids.push(sid); }
            tilmeldinger[id].push({ entry: nr, spillere: ids });
        }
    }
    return {
        version: 1, kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null }, turnering: { navn: 'T', hal: '', dage },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 2, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: raekker.map((r) => ({ id: r.id, aargang: r.aargang, raekke: r.raekke, pauseKlasse: 'ABCD', kategorier: r.kategorier.map((k) => `${r.id} ${k.kat}`) })),
        kategorier, spillere, kampe: [], tilmeldinger, bemaerkninger: [],
    };
}

function projekt(raekker, { baner = 2, start = '09:00', slut = '12:00', dage, form = 'swiss' } = {}) {
    let p = nytProjekt(model(raekker, dage));
    for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner, start, slut });
    for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: form });
    return p;
}

const fejl = (p) => tjekPlan(p).problemer.filter((x) => x.alvor === 'fejl');

describe('automatisk form: aldrig den største, når pladsen mangler', () => {
    test('for lidt plads → mindste form der opfylder kravet, markeret "passer ikke"', () => {
        const p = projekt([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 16 }, { kat: 'DS', type: 'single', antal: 16 }] }], { dage: ['2026-11-21'] });
        for (const k of p.kategorier) {
            assert.equal(k.formForslag.form, 'swiss');
            assert.equal(k.formForslag.runder, 4, `${k.id}: 4 runder (kravet), ikke 8`);
            assert.equal(k.formForslag.passerIkke, true);
        }
        assert.equal(p.kampe.length, 2 * 4 * 8);
    });
});

describe('nedskæring: forslag der får kabalen til at gå op', () => {
    // 8 spillere, 4 runder = 16 kampe; 2 baner × 6 slots = 12 bane-slots på den ene dag
    const lille = () => projekt([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 8 }] }], { dage: ['2026-11-21'] });

    test('uden regelbrud er der intet at foreslå', () => {
        const p = projekt([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 8 }] }], { dage: ['2026-11-21'], slut: '18:00' });
        assert.equal(lavForslag(p).brud.length, 0);
        assert.equal(nedskaeringsForslag(p), null);
        assert.deepEqual(alleNedskaeringer(p), []);
    });
    test('skærer runder, til planlæggeren kan lægge alt lovligt — og viser konsekvensen', () => {
        const p = lille();
        assert.ok(lavForslag(p).brud.length > 0, 'udgangspunktet har regelbrud');
        const f = nedskaeringsForslag(p, { strategi: 'jaevnt' });
        assert.equal(f.loest, true);
        assert.equal(f.brudEfter, 0);
        assert.ok(f.kampeEfter < f.kampeFoer);
        const a = f.aendringer.find((x) => x.kategori === 'U11 D HS');
        assert.equal(a.fra, 4);
        assert.ok(a.til < 4 && a.til >= MIN_RUNDER);
        assert.equal(a.krav, 4);
        assert.equal(a.faerrestEfter, a.til, 'lige antal: alle spiller hver runde');
        assert.equal(a.underKravEfter, 8, 'alle 8 kommer under kravet — det skal stå sort på hvidt');
        assert.equal(f.spillereUnderKravFoer, 0);
        assert.equal(f.spillereUnderKravEfter, 8);
    });
    test('"Brug dette": rundetallet bliver kategoriens eget valg, og planen har ingen fejl', () => {
        const p = lille();
        const f = nedskaeringsForslag(p);
        const { projekt: efter, forslag } = anvendNedskaering(p, f);
        assert.equal(forslag.brud.length, 0);
        assert.equal(efter.kategorier[0].swissRunder, f.runder['U11 D HS']);
        assert.equal(Object.keys(efter.plan).length, efter.kampe.length);
        assert.deepEqual(fejl(efter), []);
        assert.ok(tjekPlan(efter).problemer.some((x) => (x.noegle || '').endsWith(':min-kampe')), 'Tjek advarer om spillere under minimum');
    });
    test('"Skån singlerne" skærer double før single', () => {
        const p = projekt([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 8 }, { kat: 'HD', type: 'double', antal: 6 }] }], { dage: ['2026-11-21'], slut: '15:00' });
        assert.ok(lavForslag(p).brud.length > 0);
        const f = nedskaeringsForslag(p, { strategi: 'skaanSingle' });
        const hd = f.aendringer.find((x) => x.kategori === 'U11 D HD');
        assert.ok(hd && hd.til < hd.fra, 'doublen er skåret');
        const hs = f.aendringer.find((x) => x.kategori === 'U11 D HS');
        if (hs) assert.equal(hd.til, MIN_RUNDER, 'singlen røres først, når doublen er i bund');
    });
    test('"To dage": rækken får dispensation i stedet for færre kampe, når det er nok', () => {
        const p = lille0();
        function lille0() { return projekt([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 8 }, { kat: 'DS', type: 'single', antal: 8 }] }], { slut: '13:30' }); }
        assert.equal(p.raekker[0].maxDage, 1);
        assert.ok(lavForslag(p).brud.length > 0, 'to kategorier á 16 kampe kan ikke være på én dag');
        const f = nedskaeringsForslag(p, { strategi: 'toDage' });
        assert.deepEqual(f.raekkerToDage, ['U11 D']);
        assert.equal(f.loest, true);
        assert.deepEqual(f.aendringer, [], 'ingen runder skæres');
        const { projekt: efter } = anvendNedskaering(p, f);
        assert.equal(efter.raekker[0].dispensationFlereDage, true);
        assert.deepEqual(fejl(efter), []);
        const alle = alleNedskaeringer(p);
        assert.equal(alle[0].strategi, 'toDage', 'færrest spillere under kravet står først');
    });
    test('kampe fra TP kan planneren ikke skære i', () => {
        let p = lille();
        p = saetForm(p, 'U11 D HS', { formValg: 'pulje' });
        assert.deepEqual(swissKandidater(p), []);
    });
    test('underKrav tæller som Tjek', () => {
        const u = underKrav(lille());
        assert.deepEqual(u.get('U11 D HS'), { krav: 4, faerrest: 4, spillere: [] });
    });
});

describe('kapacitetsregnskab', () => {
    test('behov og plads på fælles og reserverede baner', () => {
        let p = projekt([
            { id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 4 }] },
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 8 }] },
        ], { dage: ['2026-11-21'] });
        p = opdaterRaekke(p, 'U09 D', { tidligst: '10:00', senest: '12:00', reserveredeBaner: 1 });
        const r = kapacitetsRegnskab(p);
        assert.equal(r.faelles.behov, 16, 'U11: 4 runder á 4 kampe');
        assert.equal(r.faelles.plads, 2 * 2 + 4 * 1, '09–10 to baner, 10–12 én bane');
        assert.deepEqual(r.reserveret, [{ raekke: 'U09 D', behov: 6, plads: 4, ubrugt: 0 }]);
    });
});

describe('scheduler: dagfordeling af én-dags-rækker', () => {
    const toRaekker = () => projekt([
        { id: 'U11 C', aargang: 'U11', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', antal: 8 }] },
        { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 8 }] },
    ], { slut: '13:30', form: 'pulje' });
    test('to rækker, der ikke kan være på samme dag, får hver sin dag — uden regelbrud', () => {
        const p = toRaekker();
        const f = lavForslag(p);
        assert.equal(f.brud.length, 0, JSON.stringify(f.brud.slice(0, 3)));
        const dagFor = (rid) => new Set(p.kampe.filter((k) => k.kategori.startsWith(rid)).map((k) => f.plan[k.id].dag));
        assert.equal(dagFor('U11 C').size, 1);
        assert.equal(dagFor('U11 D').size, 1);
        assert.notDeepEqual([...dagFor('U11 C')], [...dagFor('U11 D')]);
    });
    test('er der plads til det hele på første dag, bliver alt liggende dér', () => {
        const p = projekt([
            { id: 'U11 C', aargang: 'U11', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', antal: 4 }] },
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 4 }] },
        ], { slut: '18:00', form: 'pulje' });
        const f = lavForslag(p);
        assert.deepEqual([...new Set(Object.values(f.plan).map((x) => x.dag))], ['2026-11-21']);
    });
    test('en låst kamp bestemmer rækkens dag', async () => {
        const { flytKamp, laasKamp } = await import('../../src/store.js');
        let p = toRaekker();
        const k = p.kampe.find((x) => x.kategori === 'U11 C HS');
        p = laasKamp(flytKamp(p, k.id, '2026-11-22', '09:00'), k.id, true);
        const f = lavForslag(p);
        assert.deepEqual([...new Set(p.kampe.filter((x) => x.kategori === 'U11 C HS').map((x) => f.plan[x.id].dag))], ['2026-11-22']);
    });
});
