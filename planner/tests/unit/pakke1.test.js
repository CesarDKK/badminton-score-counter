// Pakke 1 fra gennemgangen 2026-09-20: beskyt brugerens arbejde, og gør Tjek troværdig.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, flytKamp, laasKamp, genindlaes, validerProjekt, gemLokalt, hentLokalt } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { bygProblem } from '../../src/solver-klient.js';

/** raekker: [{ id, aargang, raekke, kategorier: [{ kat, type, antal, spillere? }] }] — spillere kan genbruges på tværs af kategorier. */
function model(raekker, dage = ['2026-11-21', '2026-11-22']) {
    const spillere = {}, kategorier = [], tilmeldinger = {};
    let nr = 0, ev = 0;
    const ny = () => { nr += 1; const id = `s${nr}`; spillere[id] = { id, fornavn: `N${nr}`, efternavn: 'X', koen: 'H', foedt: null, klub: 'K', memberid: null, niveau: {}, point: {} }; return id; };
    for (const r of raekker) for (const k of r.kategorier) {
        const id = `${r.id} ${k.kat}`;
        ev += 1;
        kategorier.push({ id, eventId: ev, raekke: r.id, aargang: r.aargang, kat: k.kat, type: k.type, mix: false, form: 'ingen lodtrækning', tilmeldte: 0, kampe: 0, runder: 0, halvBane: false });
        tilmeldinger[id] = (k.spillere || Array.from({ length: k.antal }, () => (k.type === 'single' ? [ny()] : [ny(), ny()]))).map((ids, i) => ({ entry: ev * 100 + i, spillere: ids }));
    }
    return {
        version: 1, kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null }, turnering: { navn: 'T', hal: '', dage },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 4, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: raekker.map((r) => ({ id: r.id, aargang: r.aargang, raekke: r.raekke, pauseKlasse: 'ABCD', kategorier: r.kategorier.map((k) => `${r.id} ${k.kat}`) })),
        kategorier, spillere, kampe: [], tilmeldinger, bemaerkninger: [],
    };
}

/** U9: 4 drenge i single (Swiss, 3 runder) — og de samme 4 som to doublepar (én kamp). */
function swissOgDouble() {
    let p = nytProjekt(model([{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 4 }] }], ['2026-11-21']));
    const s = Object.keys(p.spillere);
    p = nytProjekt(model([{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: s.map((x) => [x]) }, { kat: 'HD', type: 'double', spillere: [[s[0], s[1]], [s[2], s[3]]] }] }], ['2026-11-21']));
    p = { ...p, spillere: Object.fromEntries(s.map((id) => [id, { id, fornavn: id, efternavn: 'X', koen: 'H', foedt: null, klub: 'K', memberid: null, niveau: {}, point: {} }])) };
    p = opdaterDag(p, '2026-11-21', { baner: 4, start: '09:00', slut: '18:00' });
    p = saetForm(p, 'U09 D HS', { formValg: 'swiss', swissRunder: 3 });
    p = saetForm(p, 'U09 D HD', { formValg: 'pulje' });
    return p;
}

const laeg = (p, filter, slot) => p.kampe.filter(filter).reduce((q, k) => flytKamp(q, k.id, '2026-11-21', slot), p);

describe('Tjek: Swiss-runde 2+ mod spillernes kampe i andre kategorier', () => {
    const opstil = (doubleSlot) => {
        let p = swissOgDouble();
        p = laeg(p, (k) => k.fase === 'swiss' && k.runde === 1, '09:00');
        p = laeg(p, (k) => k.fase === 'swiss' && k.runde === 2, '10:00');
        p = laeg(p, (k) => k.fase === 'swiss' && k.runde === 3, '11:00');
        return laeg(p, (k) => k.kategori === 'U09 D HD', doubleSlot);
    };
    test('doublekamp i samme slot som runde 2 → fejl: dobbeltbooket (én melding, ikke én pr. spiller)', () => {
        const p = opstil('10:00');
        const dbl = p.kampe.find((k) => k.kategori === 'U09 D HD');
        const fund = tjekPlan(p).problemer.filter((x) => x.type === 'dobbeltbooket');
        assert.equal(fund.length, 1);
        assert.equal(fund[0].alvor, 'fejl');
        assert.match(fund[0].tekst, /U09 D HS runde 2 kl\. 10:00/);
        assert.ok(fund[0].kampe.includes(dbl.id));
        assert.equal(fund[0].kampe.length, 3, 'doublekampen + rundens to kampe i slottet');
    });
    test('doublekamp lige efter en runde → advarsel om pause (parringen kendes ikke endnu)', () => {
        const p = { ...opstil('11:30'), opsaetning: { ...opstil('11:30').opsaetning, kampVarighed: 'slot' } };
        const fund = tjekPlan(p).problemer.filter((x) => x.type === 'pause' && /runde 3/.test(x.tekst));
        assert.equal(fund.length, 1);
        assert.equal(fund[0].alvor, 'advarsel');
    });
    test('doublekamp med god afstand → ingen meldinger om Swiss-runderne', () => {
        const t = tjekPlan(opstil('12:30'));
        assert.deepEqual(t.problemer.filter((x) => ['dobbeltbooket', 'pause'].includes(x.type)), []);
    });
    test('rundens egne kampe og forrige runde giver ikke falske dobbeltbookinger', () => {
        const t = tjekPlan(opstil('12:30'));
        assert.equal(t.antal.fejl, 0, JSON.stringify(t.problemer.filter((x) => x.alvor === 'fejl').map((x) => x.tekst)));
    });
});

describe('løserens problem: max haltid gælder pr. dag og pr. række', () => {
    test('en spillers grænse i én række smitter ikke af på kampe i en anden række', () => {
        // Samme spiller i U09 (max 240 min) og i U11 (ingen grænse)
        let p = nytProjekt(model([{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', antal: 3 }] }], ['2026-11-21', '2026-11-22']));
        const s = Object.keys(p.spillere);
        p = nytProjekt(model([
            { id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: s.map((x) => [x]) }] },
            { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: s.map((x) => [x]) }] },
        ]));
        for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'pulje' });
        p = opdaterRaekke(p, 'U09 D', { maxHaltidMin: 240 });
        p = opdaterRaekke(p, 'U11 D', { maxHaltidMin: null });
        const pr = bygProblem(p);
        const u9 = new Set(pr.kampe.map((k, i) => (k.raekke === 'U09 D' ? i : -1)).filter((i) => i >= 0));
        assert.equal(pr.haltid.length, 3, 'én gruppe pr. spiller');
        for (const h of pr.haltid) {
            assert.equal(h.raekke, 'U09 D');
            assert.equal(h.graense, 240);
            assert.equal(h.kampe.length, 4, 'alle spillerens kampe er med (samme dag tæller de alle)');
            assert.equal(h.udloesere.length, 2);
            assert.ok(h.udloesere.every((i) => u9.has(i)), 'men kun U09-kampene udløser grænsen');
        }
        // Spiller kun i rækker med grænse → ingen særskilt udløserliste (hele gruppen udløser)
        const kunU9 = bygProblem({ ...p, kampe: p.kampe.filter((k) => k.kategori.startsWith('U09')) });
        assert.ok(kunU9.haltid.every((h) => h.udloesere === undefined));
    });
});

describe('projektfil: grundig validering, så en defekt fil ikke kan vælte siden', () => {
    const godt = () => laasKamp(flytKamp(swissOgDouble(), swissOgDouble().kampe[0].id, '2026-11-21', '09:00'), swissOgDouble().kampe[0].id, true);
    test('et rigtigt projekt godkendes — også efter en tur gennem JSON', () => {
        assert.equal(validerProjekt(godt()), null);
        assert.equal(validerProjekt(JSON.parse(JSON.stringify(godt()))), null);
    });
    test('rigtige TP-filer giver gyldige projekter (hvis testfilerne findes lokalt)', async () => {
        const fs = await import('node:fs');
        const mappe = new URL('../../testdata/', import.meta.url);
        if (!fs.existsSync(mappe)) return;
        const { default: MDBReader } = await import('mdb-reader');
        const { laesTP, tabellerFraMDB } = await import('../../src/tp-reader.js');
        for (const fil of fs.readdirSync(mappe).filter((f) => /\.tp$/i.test(f))) {
            const p = nytProjekt(laesTP(tabellerFraMDB(new MDBReader(fs.readFileSync(new URL(fil, mappe)))), { filnavn: fil }));
            assert.equal(validerProjekt(JSON.parse(JSON.stringify(p))), null, fil);
        }
    });
    const medFejl = (aendr) => { const p = JSON.parse(JSON.stringify(godt())); aendr(p); return validerProjekt(p); };
    test('manglende eller forkerte felter afvises med en besked', () => {
        assert.match(medFejl((p) => { delete p.opsaetning.dage; }), /uventet format/);
        assert.match(medFejl((p) => { p.turnering = 'x'; }), /turnering/);
        assert.match(medFejl((p) => { p.kilde = 'x'; }), /kilde/);
        assert.match(medFejl((p) => { p.raekker[0].dage = 'lørdag'; }), /række/);
        assert.match(medFejl((p) => { p.kampe[0].spillere = null; }), /kamp/);
        assert.match(medFejl((p) => { p.opsaetning.slotMin = '30'; }), /slotlængde/);
    });
    test('HTML kan ikke smugles ind, hvor der forventes datoer, klokkeslæt og tal', () => {
        const ondt = '<img src=x onerror=alert(1)>';
        assert.match(medFejl((p) => { p.plan[Object.keys(p.plan)[0]].slot = ondt; }), /plan/);
        assert.match(medFejl((p) => { p.plan[Object.keys(p.plan)[0]].dag = ondt; }), /plan/);
        assert.match(medFejl((p) => { p.opsaetning.dage[0].dato = ondt; }), /spilledage/);
        assert.match(medFejl((p) => { p.opsaetning.dage[0].baner = ondt; }), /spilledage/);
        assert.match(medFejl((p) => { p.raekker[0].pauseKlasse = ondt; }), /pauseklasse/);
        assert.match(medFejl((p) => { p.raekker[0].senest = ondt; }), /tidsrum/);
        assert.match(medFejl((p) => { p.kategorier[0].tilmeldte = ondt; }), /tal for/);
    });
});

describe('gemning i browseren: fejl skal kunne ses', () => {
    const lager = (fuldt) => { const d = new Map(); return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => { if (fuldt) throw new Error('QuotaExceededError'); d.set(k, v); }, removeItem: (k) => d.delete(k) }; };
    test('gemLokalt melder false, når browserens lager er fuldt', () => {
        assert.equal(gemLokalt(swissOgDouble(), lager(true)), false);
        assert.equal(gemLokalt(swissOgDouble(), lager(false)), true);
    });
    test('hentLokaltMedStatus fortæller, hvorfor et gemt projekt ikke kan åbnes', async () => {
        const { hentLokaltMedStatus } = await import('../../src/store.js');
        const l = lager(false);
        assert.deepEqual(hentLokaltMedStatus(l), { projekt: null, fejl: null });
        gemLokalt(swissOgDouble(), l);
        assert.equal(hentLokaltMedStatus(l).fejl, null);
        assert.equal(hentLokalt(l).kampe.length, swissOgDouble().kampe.length);
        const l2 = { getItem: () => '{"version":1,"turnering":"x"}', setItem() {}, removeItem() {} };
        assert.match(hentLokaltMedStatus(l2).fejl, /mangler|uventet/);
        const l3 = { getItem: () => '{ikke json', setItem() {}, removeItem() {} };
        assert.match(hentLokaltMedStatus(l3).fejl, /kunne ikke læses/);
    });
});

describe('genindlæsning af TP-filen: tider og låse beholdes på kampe, der stadig er de samme', () => {
    const raekker = (spillere) => [{ id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere }] }];
    const opret = () => {
        let p = nytProjekt(model(raekker([['a'], ['b'], ['c'], ['d']]), ['2026-11-21']));
        p = opdaterDag(p, '2026-11-21', { baner: 4, start: '09:00', slut: '18:00' });
        return saetForm(p, 'U09 D HS', { formValg: 'pulje' });
    };
    test('kampe, planneren selv har bygget, beholder tid og lås (før blev de smidt væk)', () => {
        let p = opret();
        const [k1, k2] = p.kampe;
        p = laasKamp(flytKamp(flytKamp(p, k1.id, '2026-11-21', '10:00'), k2.id, '2026-11-21', '10:30'), k1.id, true);
        const ny = genindlaes(p, model(raekker([['a'], ['b'], ['c'], ['d']]), ['2026-11-21']), { behold: true });
        assert.equal(ny.kategorier[0].formValg, 'pulje', 'filen har ingen lodtrækning, så plannerens form består');
        assert.deepEqual(ny.plan[k1.id], { dag: '2026-11-21', slot: '10:00' });
        assert.deepEqual(ny.plan[k2.id], { dag: '2026-11-21', slot: '10:30' });
        assert.deepEqual(ny.laast, [k1.id]);
    });
    test('"behold: false" rydder planen', () => {
        let p = opret();
        p = flytKamp(p, p.kampe[0].id, '2026-11-21', '10:00');
        const ny = genindlaes(p, model(raekker([['a'], ['b'], ['c'], ['d']]), ['2026-11-21']), { behold: false });
        assert.deepEqual(ny.plan, {});
    });
    test('har kampen fået andre spillere (ny lodtrækning/afbud), følger tid og lås IKKE med', () => {
        let p = opret();
        const k = p.kampe[0];
        p = laasKamp(flytKamp(p, k.id, '2026-11-21', '10:00'), k.id, true);
        const ny = genindlaes(p, model(raekker([['a'], ['b'], ['c'], ['e']]), ['2026-11-21']), { behold: true }); // d er udskiftet med e
        const samme = ny.kampe.find((x) => x.id === k.id);
        const uaendret = [...samme.spillere].sort().join() === [...k.spillere].sort().join();
        assert.equal(!!ny.plan[k.id], uaendret);
        for (const x of ny.kampe) if (x.spillere.includes('e')) assert.equal(ny.plan[x.id], undefined, 'en kamp med den nye spiller arver ikke en gammel tid');
        assert.ok(ny.laast.every((id) => ny.plan[id]));
    });
});

describe('"Optimér": resultatet må ikke overskrive det, brugeren har lavet imens', () => {
    const start = () => laeg(swissOgDouble(), (k) => k.fase === 'swiss' && k.runde === 1, '09:00');
    test('uændret projekt, og kvitteringer tæller ikke som ændring', async () => {
        const { aendretUnderOptimering } = await import('../../src/solver-klient.js');
        const { kvitter } = await import('../../src/store.js');
        const p = start();
        assert.equal(aendretUnderOptimering(p, p), 'uaendret');
        assert.equal(aendretUnderOptimering(p, kvitter(p, 'x:min-kampe', true)), 'uaendret');
    });
    test('flyttet kamp, ny lås eller rettet opsætning → "aendret" (spørg først)', async () => {
        const { aendretUnderOptimering } = await import('../../src/solver-klient.js');
        const p = start();
        const k = p.kampe[0];
        assert.equal(aendretUnderOptimering(p, flytKamp(p, k.id, '2026-11-21', '15:00')), 'aendret');
        assert.equal(aendretUnderOptimering(p, laasKamp(p, k.id, true)), 'aendret');
        assert.equal(aendretUnderOptimering(p, opdaterRaekke(p, 'U09 D', { maxHaltidMin: 300 })), 'aendret');
    });
    test('andre kampe, en anden fil eller lukket projekt → resultatet hører ikke til her', async () => {
        const { aendretUnderOptimering } = await import('../../src/solver-klient.js');
        const p = start();
        assert.equal(aendretUnderOptimering(p, saetForm(p, 'U09 D HS', { formValg: 'swiss', swissRunder: 2 })), 'andet-projekt');
        assert.equal(aendretUnderOptimering(p, { ...p, kilde: { ...p.kilde, filnavn: 'en-anden.tp' } }), 'andet-projekt');
        assert.equal(aendretUnderOptimering(p, null), 'lukket');
    });
    test('flettetPlan: kampe, der er låst nu, beholder deres tid', async () => {
        const { flettetPlan } = await import('../../src/solver-klient.js');
        let p = start();
        const [a, b] = p.kampe;
        p = laasKamp(flytKamp(p, a.id, '2026-11-21', '16:00'), a.id, true);
        const plan = flettetPlan(p, { [a.id]: { dag: '2026-11-21', slot: '09:00' }, [b.id]: { dag: '2026-11-21', slot: '09:30' } });
        assert.deepEqual(plan[a.id], { dag: '2026-11-21', slot: '16:00' }, 'låst: brugerens tid vinder');
        assert.deepEqual(plan[b.id], { dag: '2026-11-21', slot: '09:30' });
    });
});
