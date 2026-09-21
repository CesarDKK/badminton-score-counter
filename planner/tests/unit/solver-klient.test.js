// Tests af oversættelsen til CP-SAT-løseren (solver-klient.js): problemet må
// kun indeholde tal og kamp-id'er (ingen persondata), og de hårde regler skal
// komme med som tilladte tider, konfliktpar og kapacitet.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bygProblem, planFraSvar } from '../../src/solver-klient.js';
import { nytProjekt, opdaterDag, opdaterRaekke, flytKamp, laasKamp } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';

function model() {
    const sp = (id) => [id, { id, fornavn: `Fornavn-${id}`, efternavn: 'Hemmeligsen', koen: 'H', foedt: '2015-03-04', klub: 'Lyngby', memberid: `M${id}`, niveau: {} }];
    const kamp = (id, kategori, fase, runde, spillere, ekstra = {}) => ({
        id, kategori, fase, gruppe: ekstra.gruppe || 'Pulje 1', runde, navn: ekstra.navn || id, spillere, muligeSpillere: ekstra.mulige || spillere,
        afhaengerAf: ekstra.deps || [], tpRef: { draw: ekstra.draw ?? 1, planning: 0, van1: 0, van2: 0, matchnr: 0 }, tpTid: null, varighed: 0, ...(ekstra.rundeNavn ? { rundeNavn: ekstra.rundeNavn } : {}),
    });
    const pulje = (draw, gruppe, kat, [a, b, c]) => [
        kamp(`${draw}:1`, kat, 'pulje', 1, [a, b], { draw, gruppe }),
        kamp(`${draw}:2`, kat, 'pulje', 2, [a, c], { draw, gruppe, deps: [`${draw}:1`] }),
        kamp(`${draw}:3`, kat, 'pulje', 3, [b, c], { draw, gruppe, deps: [`${draw}:2`] }),
    ];
    return {
        version: 1, kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null },
        turnering: { navn: 'T', hal: '', dage: ['2026-11-21', '2026-11-22'] },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 2, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: [
            { id: 'U09 D', aargang: 'U09', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U09 D HS'] },
            { id: 'U13 M', aargang: 'U13', raekke: 'M', pauseKlasse: 'M', kategorier: ['U13 M HS'] },
        ],
        kategorier: [
            { id: 'U09 D HS', eventId: 1, raekke: 'U09 D', aargang: 'U09', kat: 'HS', type: 'single', mix: false, form: 'pulje', tilmeldte: 3, kampe: 3, runder: 0, halvBane: false },
            { id: 'U13 M HS', eventId: 2, raekke: 'U13 M', aargang: 'U13', kat: 'HS', type: 'single', mix: false, form: 'pulje-cup', tilmeldte: 6, kampe: 7, runder: 0, halvBane: false },
        ],
        spillere: Object.fromEntries('abcghijkl'.split('').map(sp)),
        kampe: [
            ...pulje(1, 'Pulje 1', 'U09 D HS', ['a', 'b', 'c']),
            ...pulje(3, 'Pulje 1', 'U13 M HS', ['g', 'h', 'i']),
            ...pulje(4, 'Pulje 2', 'U13 M HS', ['j', 'k', 'l']),
            kamp('5:f', 'U13 M HS', 'cup', 1, [], { draw: 5, mulige: ['g', 'h', 'i', 'j', 'k', 'l'], deps: ['3:1', '3:2', '3:3', '4:1', '4:2', '4:3'], rundeNavn: 'Finale' }),
        ],
        tilmeldinger: {}, bemaerkninger: [],
    };
}

function projekt() {
    let p = nytProjekt(model());
    p = opdaterDag(p, '2026-11-21', { baner: 2, start: '09:00', slut: '18:00' });
    p = opdaterDag(p, '2026-11-22', { baner: 2, start: '09:00', slut: '18:00' });
    return p;
}

describe('solver-klient: bygProblem', () => {
    test('problemet indeholder ingen persondata — kun id\'er, tal og vægte', () => {
        const tekst = JSON.stringify(bygProblem(projekt()));
        for (const forbudt of ['Hemmeligsen', 'Fornavn-', 'Lyngby', '2015-03-04', 'Ma', 'memberid', 'foedt'])
            assert.ok(!tekst.includes(forbudt), `"${forbudt}" må ikke sendes til løseren`);
    });
    test('alle kampe er med, med tilladte tider inden for dagens slots og rækkens dage', () => {
        let p = projekt();
        p = opdaterRaekke(p, 'U09 D', { dage: ['2026-11-21'], senest: '12:00' });
        const pr = bygProblem(p);
        assert.equal(pr.kampe.length, p.kampe.length);
        assert.equal(pr.slotMin, 30);
        const u9 = pr.kampe.filter((k) => k.raekke === 'U09 D');
        for (const k of u9) {
            assert.ok(k.tilladte.length > 0);
            assert.ok(k.tilladte.every((t) => t >= 9 * 60 && t + 30 <= 12 * 60), 'kun lørdag 09:00–12:00 (dag 0)');
        }
        const m = pr.kampe.find((k) => k.id === '3:1');
        assert.ok(m.tilladte.some((t) => t >= 1440), 'U13 M kan også spille søndag (global tid = dag * 1440 + minut)');
    });
    test('spillere er løbenumre, og kampe med fælles spiller er konfliktpar med varighed + pause som gab', () => {
        const pr = bygProblem(projekt());
        const i = (id) => pr.kampe.findIndex((k) => k.id === id);
        for (const k of pr.kampe) assert.ok(k.spillere.every((s) => Number.isInteger(s)));
        const parret = pr.konflikter.find(([a, b]) => (a === i('1:1') && b === i('1:2')) || (a === i('1:2') && b === i('1:1')));
        assert.ok(parret, '1:1 og 1:2 deler spiller a');
        assert.ok(parret[2] >= 30, 'gab mindst kampens varighed');
        // Finalen kan få alle seks spillere: den er i konflikt med puljekampene via afhængigheden (foer)
        assert.ok(pr.foer.some(([a, b]) => a === i('3:3') && b === i('5:f')));
        assert.equal(pr.kampe[i('5:f')].erFinale, true);
    });
    test('låste kampe har kun deres egen tid som tilladt, og hint følger den grådige plan', () => {
        let p = projekt();
        p = flytKamp(p, '3:1', '2026-11-22', '10:30');
        p = laasKamp(p, '3:1', true);
        const f = lavForslag(p);
        const pr = bygProblem(p, f.plan);
        const l = pr.kampe.find((k) => k.id === '3:1');
        assert.deepEqual(l.tilladte, [1440 + 10 * 60 + 30]);
        assert.equal(l.hint, 1440 + 10 * 60 + 30);
        assert.ok(pr.kampe.every((k) => k.hint !== null), 'alle kampe har hint');
    });
    test('kapacitet: fælles pulje pr. slot, og egen pulje for rækker med reserverede baner', () => {
        let p = projekt();
        p = opdaterRaekke(p, 'U09 D', { dage: ['2026-11-21'], tidligst: '09:00', senest: '11:00', reserveredeBaner: 1 });
        const pr = bygProblem(p);
        assert.ok(pr.kapacitet.faelles.length > 0);
        assert.ok(pr.kapacitet['U09 D'], 'rækken har egen kapacitetspulje');
        assert.ok(pr.kampe.filter((k) => k.raekke === 'U09 D').every((k) => k.pulje === 'U09 D'));
        const kl9 = pr.kapacitet.faelles.find((x) => x.t === 9 * 60);
        assert.equal(kl9.baner, 1, '2 baner minus 1 reserveret');
    });
    test('planFraSvar oversætter global tid til dag og slot', () => {
        const p = projekt();
        const plan = planFraSvar(p, { tider: { '1:1': 9 * 60, '3:1': 1440 + 13 * 60 + 30 } });
        assert.deepEqual(plan['1:1'], { dag: '2026-11-21', slot: '09:00' });
        assert.deepEqual(plan['3:1'], { dag: '2026-11-22', slot: '13:30' });
    });
});

describe('solver-klient: job-id og stop', () => {
    test('nytJobId er 24 hex-tegn og forskelligt hver gang (passer til løserens mønster)', async () => {
        const { nytJobId } = await import('../../src/solver-klient.js');
        const a = nytJobId(), b = nytJobId();
        assert.match(a, /^[0-9a-f]{24}$/);
        assert.notEqual(a, b);
    });
    test('optimer sender job-id med, og stopLoeser rammer /api/solve/stop', async () => {
        const { optimer, stopLoeser } = await import('../../src/solver-klient.js');
        const kald = [];
        const gammel = globalThis.fetch;
        globalThis.fetch = async (url, opt) => { kald.push({ url, body: JSON.parse(opt.body) }); return { ok: true, status: 200, json: async () => ({ status: 'FEASIBLE', stoppet: true, sekunder: 3, tider: { '1:1': 540 } }) }; };
        try {
            const svar = await optimer(projekt(), { sekunder: 240, job: 'abc12345abc12345' });
            assert.equal(kald[0].url, '/api/solve');
            assert.equal(kald[0].body.job, 'abc12345abc12345');
            assert.equal(kald[0].body.sekunder, 240);
            assert.equal(svar.stoppet, true);
            assert.deepEqual(svar.plan['1:1'], { dag: '2026-11-21', slot: '09:00' });
            assert.equal(await stopLoeser('abc12345abc12345'), true);
            assert.deepEqual(kald[1], { url: '/api/solve/stop', body: { job: 'abc12345abc12345' } });
        } finally { globalThis.fetch = gammel; }
    });
});

describe('solver-klient: asynkront job (start → status → svar)', () => {
    const medFetch = async (svarListe, koer) => {
        const kald = [];
        const gammel = globalThis.fetch;
        globalThis.fetch = async (url, opt = {}) => { kald.push({ url, body: opt.body ? JSON.parse(opt.body) : null }); const s = svarListe.shift(); if (s instanceof Error) throw s; return { ok: s.kode < 400, status: s.kode, json: async () => s.data }; };
        try { return { resultat: await koer(), kald }; } finally { globalThis.fetch = gammel; }
    };
    test('starter jobbet asynkront og spørger til status, til det er færdigt', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        const { resultat, kald } = await medFetch([
            { kode: 202, data: { status: 'REGNER', job: 'jobjobjob123' } },
            { kode: 200, data: { status: 'REGNER', sekunder: 3 } },
            { kode: 502, data: {} }, // forbigående fejl (fx genstart af proxy) tåles
            { kode: 200, data: { status: 'FEASIBLE', sekunder: 9, stoppet: false, tider: { '1:1': 540 } } },
        ], () => optimer(projekt(), { sekunder: 240, job: 'jobjobjob123', pollMs: 1 }));
        assert.equal(kald[0].body.asynkron, true);
        assert.deepEqual(kald.slice(1).map((k) => k.url), Array(3).fill('/api/solve/status?job=jobjobjob123'));
        assert.equal(resultat.status, 'FEASIBLE');
        assert.deepEqual(resultat.plan['1:1'], { dag: '2026-11-21', slot: '09:00' });
    });
    test('ukendt job (løseren genstartet) og ugyldigt problem giver en klar fejl', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        await assert.rejects(medFetch([{ kode: 202, data: { status: 'REGNER', job: 'jobjobjob123' } }, { kode: 404, data: { fejl: 'ukendt job' } }], () => optimer(projekt(), { pollMs: 1 })), /kender ikke længere jobbet/);
        await assert.rejects(medFetch([{ kode: 202, data: { status: 'REGNER', job: 'jobjobjob123' } }, { kode: 400, data: { fejl: 'ugyldigt problem: KeyError' } }], () => optimer(projekt(), { pollMs: 1 })), /ugyldigt problem/);
        await assert.rejects(medFetch([{ kode: 429, data: {} }], () => optimer(projekt(), { pollMs: 1, ventMaxSekunder: -1 })), /optaget/);
    });
    test('pakke 4: er løseren optaget, venter klienten i kø og starter af sig selv', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        const set = [];
        const { resultat, kald } = await medFetch([
            { kode: 429, data: { fejl: 'løseren er optaget', optaget: true, ledigOmSekunder: 120 } },
            { kode: 429, data: { fejl: 'løseren er optaget', optaget: true, ledigOmSekunder: 110 } },
            { kode: 202, data: { status: 'REGNER', job: 'jobjobjob123' } },
            { kode: 200, data: { status: 'OPTIMAL', sekunder: 2, tider: {} } },
        ], () => optimer(projekt(), { job: 'jobjobjob123', pollMs: 1, ventMs: 1, vedStatus: (x) => set.push(x) }));
        assert.equal(resultat.status, 'OPTIMAL');
        assert.deepEqual(kald.map((k) => k.url), ['/api/solve', '/api/solve', '/api/solve', '/api/solve/status?job=jobjobjob123']);
        assert.deepEqual(set.map((x) => [x.status, x.ledigOmSekunder]), [['VENTER', 120], ['VENTER', 110]]);
    });
    test('pakke 4: ventetiden i køen kan afbrydes ("Stop")', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        const afbryd = new AbortController();
        const koer = medFetch([{ kode: 429, data: { optaget: true, ledigOmSekunder: 300 } }], () => optimer(projekt(), { pollMs: 1, ventMs: 60000, signal: afbryd.signal, vedStatus: () => afbryd.abort() }));
        await assert.rejects(koer, /Afbrudt/);
    });
    test('pakke 4: brugt kvote og rate-grænse giver hver sin klare besked', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        await assert.rejects(medFetch([{ kode: 429, data: { kvote: true, ledigOmSekunder: 1500 } }], () => optimer(projekt(), { pollMs: 1 })), /regnetid for denne time — der er plads igen om ca. 25 min/);
        await assert.rejects(medFetch([{ kode: 429, data: { graense: true } }], () => optimer(projekt(), { pollMs: 1, ventMaxSekunder: -1 })), /For mange kald/);
        await assert.rejects(medFetch([{ kode: 403, data: {} }], () => optimer(projekt(), { pollMs: 1 })), /afviste kaldet/);
    });
    test('pakke 4: rammer statuskaldene rate-grænsen, sættes tempoet ned — jobbet opgives ikke', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        const graense = { kode: 429, data: { graense: true } };
        const { resultat, kald } = await medFetch([
            { kode: 202, data: { status: 'REGNER', job: 'jobjobjob123' } },
            graense, graense, graense, graense, graense, graense, graense, // flere end de 5 fejl i træk, der før fik klienten til at give op
            { kode: 200, data: { status: 'FEASIBLE', sekunder: 9, tider: {} } },
        ], () => optimer(projekt(), { job: 'jobjobjob123', pollMs: 0 }));
        assert.equal(resultat.status, 'FEASIBLE');
        assert.equal(kald.length, 9);
    });
    test('pakke 4: forbigående fejl tåles en tid (ikke et antal), derefter opgives der med fejlen', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        const nede = { kode: 502, data: {} };
        await assert.rejects(medFetch([{ kode: 202, data: { status: 'REGNER', job: 'jobjobjob123' } }, nede, nede, nede], () => optimer(projekt(), { job: 'jobjobjob123', pollMs: 5, taalFejlSekunder: 0 })), /svarede 502/);
    });
    test('en ældre løser, der svarer med det samme, virker stadig', async () => {
        const { optimer } = await import('../../src/solver-klient.js');
        const { resultat, kald } = await medFetch([{ kode: 200, data: { status: 'OPTIMAL', sekunder: 1, tider: {} } }], () => optimer(projekt(), { pollMs: 1 }));
        assert.equal(kald.length, 1);
        assert.equal(resultat.status, 'OPTIMAL');
    });
});

describe('solver-klient: diagnose når der ingen lovlig plan findes', () => {
    test('haltid-grupper bærer rækkens id, så diagnosen kan pege på den', async () => {
        const { opdaterRaekke } = await import('../../src/store.js');
        const pr = bygProblem(opdaterRaekke(projekt(), 'U09 D', { maxHaltidMin: 240 }));
        assert.ok(pr.haltid.length > 0);
        assert.ok(pr.haltid.every((h) => h.raekke === 'U09 D' && h.graense === 240));
    });
    test('diagnoseTekst: tekst og handlinger pr. regel', async () => {
        const { diagnoseTekst } = await import('../../src/solver-klient.js');
        const d = diagnoseTekst([{ regel: 'haltid', raekke: 'U09 D', graense: 240, forslag: 300 }, { regel: 'maxDage', raekke: 'U11 D' }]);
        assert.match(d.tekst, /U09 D: max haltid på 240 min kan ikke overholdes — med 300 min/);
        assert.match(d.tekst, /U11 D: kampene kan ikke være på én dag/);
        assert.deepEqual(d.handlinger.map((h) => [h.raekke, h.aendring]), [['U09 D', { maxHaltidMin: 300 }], ['U11 D', { dispensationFlereDage: true }]]);
        assert.deepEqual(diagnoseTekst([{ regel: 'haltid', raekke: 'U09 D', graense: 240, forslag: null }]).handlinger[0].aendring, { maxHaltidMin: null });
        assert.match(diagnoseTekst([{ regel: 'plads' }]).tekst, /ikke plads/);
        assert.deepEqual(diagnoseTekst([{ regel: 'plads' }]).handlinger, []);
        assert.match(diagnoseTekst([]).tekst, /kunne ikke pege/);
        assert.match(diagnoseTekst(undefined).tekst, /kunne ikke pege/);
    });
});
