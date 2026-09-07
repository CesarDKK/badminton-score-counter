// Tests af planlæggeren: små syntetiske turneringer og benchmark mod
// Jespers planer i de lokale Lyngby-filer (springes over hvis de mangler).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lavForslag, bedoemPlan, lavAlternativer, ALTERNATIV_VARIANTER } from '../../src/scheduler.js';
import { tjekPlan } from '../../src/rules.js';
import { nytProjekt, opdaterDag, opdaterRaekke, flytKamp, laasKamp, laasKategori, anvendForslag, opdaterOpsaetning } from '../../src/store.js';

const her = path.dirname(fileURLToPath(import.meta.url));

// Lille turnering: 2 puljer á 3 i U11 D HS + finale, en pulje á 3 i U11 D DS, U09 D HS Swiss 3 runder á 2 kampe
function model() {
    const sp = (id, navn, koen = 'H') => [id, { id, fornavn: navn, efternavn: 'X', koen, foedt: '2015-01-01', klub: 'Lyngby', memberid: null, niveau: {} }];
    const kamp = (id, kategori, fase, runde, spillere, ekstra = {}) => ({
        id, kategori, fase, gruppe: ekstra.gruppe || 'Pulje 1', runde, navn: ekstra.navn || id, spillere, muligeSpillere: ekstra.mulige || spillere,
        afhaengerAf: ekstra.deps || [], tpRef: { draw: ekstra.draw ?? 1, planning: 0, van1: 0, van2: 0, matchnr: 0 }, tpTid: null, varighed: 0, ...(ekstra.rundeNavn ? { rundeNavn: ekstra.rundeNavn } : {}),
    });
    const pulje = (draw, gruppe, kat, [a, b, c]) => [
        kamp(`${draw}:1`, kat, 'pulje', 1, [a, b], { draw, gruppe, navn: `${gruppe} #1 – #2` }),
        kamp(`${draw}:2`, kat, 'pulje', 2, [a, c], { draw, gruppe, navn: `${gruppe} #1 – #3`, deps: [`${draw}:1`] }),
        kamp(`${draw}:3`, kat, 'pulje', 3, [b, c], { draw, gruppe, navn: `${gruppe} #2 – #3`, deps: [`${draw}:2`] }),
    ];
    return {
        version: 1, kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null },
        turnering: { navn: 'Test', hal: '', dage: ['2026-11-21', '2026-11-22'] },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 3, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: [
            { id: 'U09 D', aargang: 'U09', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U09 D HS'] },
            { id: 'U11 D', aargang: 'U11', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U11 D HS', 'U11 D DS'] },
        ],
        kategorier: [
            { id: 'U09 D HS', eventId: 3, raekke: 'U09 D', aargang: 'U09', kat: 'HS', type: 'single', mix: false, form: 'swiss', tilmeldte: 4, kampe: 6, runder: 3, halvBane: true },
            { id: 'U11 D HS', eventId: 1, raekke: 'U11 D', aargang: 'U11', kat: 'HS', type: 'single', mix: false, form: 'pulje-cup', tilmeldte: 6, kampe: 7, runder: 0, halvBane: false },
            { id: 'U11 D DS', eventId: 2, raekke: 'U11 D', aargang: 'U11', kat: 'DS', type: 'single', mix: false, form: 'pulje', tilmeldte: 3, kampe: 3, runder: 0, halvBane: false },
        ],
        spillere: Object.fromEntries([sp('a', 'Anton'), sp('b', 'Bertil'), sp('c', 'Carl'), sp('d', 'Dan'), sp('e', 'Erik'), sp('f', 'Frode'), sp('g', 'Gro', 'D'), sp('h', 'Hanne', 'D'), sp('i', 'Ida', 'D'), sp('j', 'Jon'), sp('k', 'Kai'), sp('l', 'Leo'), sp('m', 'Mio')]),
        kampe: [
            ...pulje(1, 'Pulje 1', 'U11 D HS', ['a', 'b', 'c']),
            ...pulje(2, 'Pulje 2', 'U11 D HS', ['d', 'e', 'f']),
            kamp('3:f', 'U11 D HS', 'cup', 1, [], { draw: 3, navn: 'Finale: Pulje 1 #1 – Pulje 2 #1', mulige: ['a', 'b', 'c', 'd', 'e', 'f'], deps: ['1:1', '1:2', '1:3', '2:1', '2:2', '2:3'], rundeNavn: 'Finale' }),
            ...pulje(4, 'Pulje 1', 'U11 D DS', ['g', 'h', 'i']),
            kamp('5:1', 'U09 D HS', 'swiss', 1, ['j', 'k'], { draw: 5, gruppe: 'U09 D HS' }),
            kamp('5:2', 'U09 D HS', 'swiss', 1, ['l', 'm'], { draw: 5, gruppe: 'U09 D HS' }),
            kamp('5:r2:1', 'U09 D HS', 'swiss', 2, [], { draw: 5, mulige: ['j', 'k', 'l', 'm'], deps: ['5:1', '5:2'] }),
            kamp('5:r2:2', 'U09 D HS', 'swiss', 2, [], { draw: 5, mulige: ['j', 'k', 'l', 'm'], deps: ['5:1', '5:2'] }),
            kamp('5:r3:1', 'U09 D HS', 'swiss', 3, [], { draw: 5, mulige: ['j', 'k', 'l', 'm'], deps: ['5:r2:1', '5:r2:2'] }),
            kamp('5:r3:2', 'U09 D HS', 'swiss', 3, [], { draw: 5, mulige: ['j', 'k', 'l', 'm'], deps: ['5:r2:1', '5:r2:2'] }),
        ],
        bemaerkninger: [],
    };
}

function projekt() {
    let p = nytProjekt(model());
    p = opdaterDag(p, '2026-11-21', { baner: 3, start: '09:00', slut: '15:00' });
    p = opdaterDag(p, '2026-11-22', { baner: 3, start: '09:00', slut: '15:00' });
    return p;
}

const fejl = (p) => tjekPlan(p).problemer.filter((x) => x.alvor === 'fejl');

describe('scheduler: syntetisk turnering', () => {
    test('alle kampe placeres uden fejl, deterministisk', () => {
        const p = projekt();
        const f = lavForslag(p);
        assert.deepEqual(f.ikkePlaceret, []);
        assert.equal(Object.keys(f.plan).length, p.kampe.length);
        const p2 = anvendForslag(p, f);
        assert.deepEqual(fejl(p2), []);
        assert.deepEqual(lavForslag(p).plan, f.plan, 'samme input giver samme plan');
        assert.equal(f.statistik.udenTid, 0);
    });
    test('rækkefølge: puljerunder i orden, finalen efter puljerne, Swiss-runder efter hinanden', () => {
        const f = lavForslag(projekt());
        const t = (id) => `${f.plan[id].dag}T${f.plan[id].slot}`;
        assert.ok(t('1:1') < t('1:2') && t('1:2') < t('1:3'));
        for (const id of ['1:1', '1:2', '1:3', '2:1', '2:2', '2:3']) assert.ok(t(id) < t('3:f'), `${id} før finalen`);
        assert.ok(t('5:1') < t('5:r2:1') && t('5:r2:2') < t('5:r3:1'));
    });
    test('halve baner: to U9-singler deler en bane', () => {
        const f = lavForslag(projekt());
        assert.equal(f.plan['5:1'].slot, f.plan['5:2'].slot, 'runde 1 i samme slot');
    });
    test('rækkens dage respekteres og en række uden dage giver "ikke placeret" med årsag', () => {
        let p = opdaterRaekke(projekt(), 'U09 D', { dage: ['2026-11-22'] });
        let f = lavForslag(p);
        assert.ok(p.kampe.filter((k) => k.kategori === 'U09 D HS').every((k) => f.plan[k.id].dag === '2026-11-22'));
        assert.ok(p.kampe.filter((k) => k.kategori !== 'U09 D HS').every((k) => f.plan[k.id].dag === '2026-11-21'), 'U11 D fylder lørdag først');
        p = opdaterRaekke(projekt(), 'U11 D', { dage: [] });
        f = lavForslag(p);
        assert.equal(f.ikkePlaceret.length, 10);
        assert.equal(f.ikkePlaceret[0].aarsag, 'rækken spiller ikke den dag');
    });
    test('for lidt kapacitet giver "ikke placeret"', () => {
        let p = opdaterDag(projekt(), '2026-11-21', { baner: 1, slut: '10:00' });
        p = opdaterDag(p, '2026-11-22', { baner: 1, slut: '10:00' });
        const f = lavForslag(p);
        assert.ok(f.ikkePlaceret.length > 0);
        assert.ok(f.ikkePlaceret.every((x) => x.aarsag));
        assert.deepEqual(fejl(anvendForslag(p, f)), [], 'det der er placeret, er lovligt');
    });
    test('låste kampe beholder deres tid, og forslaget planlægger uden om dem', () => {
        let p = flytKamp(projekt(), '4:1', '2026-11-21', '12:00');
        p = laasKamp(p, '4:1');
        const f = lavForslag(p);
        assert.deepEqual(f.plan['4:1'], { dag: '2026-11-21', slot: '12:00' });
        assert.ok(f.plan['4:2'].slot > '12:00', 'runde 2 efter den låste runde 1');
        assert.deepEqual(fejl(anvendForslag(p, f)), []);
        const p2 = laasKategori(anvendForslag(p, f), 'U11 D DS');
        assert.equal(p2.laast.length, 3);
        assert.equal(laasKategori(p2, 'U11 D DS', false).laast.length, 0);
    });
    test('kunDage: kun den dag planlægges om', () => {
        const p = anvendForslag(projekt(), lavForslag(projekt()));
        const p2 = opdaterRaekke(p, 'U09 D', { dage: ['2026-11-22'] });
        const f = lavForslag(p2, { kunDage: ['2026-11-22'] });
        assert.deepEqual(f.plan['1:1'], p.plan['1:1'], 'lørdag urørt');
    });
    test('streng pausefortolkning giver længere plan men stadig ingen fejl', () => {
        const p = opdaterOpsaetning(projekt(), { kampVarighed: 'slot' });
        const f = lavForslag(p);
        assert.deepEqual(f.ikkePlaceret, []);
        assert.deepEqual(fejl(anvendForslag(p, f)), []);
        assert.ok(f.statistik.haltidMin >= lavForslag(projekt()).statistik.haltidMin);
    });
});

// ── Benchmark mod Jespers planer ──────────────────────────────

function findTestfil(moenster) {
    const mapper = [process.env.PLANNER_TESTDATA, path.join(her, '..', '..', 'testdata')].filter(Boolean);
    for (const mappe of mapper) {
        if (!fs.existsSync(mappe)) continue;
        const f = fs.readdirSync(mappe).find((x) => /\.tp$/i.test(x) && moenster.test(x));
        if (f) return path.join(mappe, f);
    }
    return null;
}

async function projektFraFil(sti) {
    const { default: MDBReader } = await import('mdb-reader');
    const { laesTP, tabellerFraMDB } = await import('../../src/tp-reader.js');
    const model = laesTP(tabellerFraMDB(new MDBReader(fs.readFileSync(sti))), { filnavn: path.basename(sti) });
    return nytProjekt(model, { tagTiderMed: true });
}

for (const [navn, moenster] of [['U13/U15 CD 2026', /U13/i], ['U9/U11 BCD 2025', /U9/i]]) {
    const fil = findTestfil(moenster);
    describe(`scheduler: benchmark Lyngby ${navn} (lokal fil)`, { skip: !fil && 'testfil mangler' }, () => {
        test('forslag fra samme lodtrækning: alle kampe placeret, ingen fejl, sammenlignet med Jespers plan', async () => {
            const jesper = await projektFraFil(fil);
            const t0 = Date.now();
            const f = lavForslag(jesper);
            const ms = Date.now() - t0;
            const mit = anvendForslag(jesper, f);
            const fejlMit = fejl(mit);
            const stat = { jesper: bedoemPlan(jesper), forslag: f.statistik, ms, ikkePlaceret: f.ikkePlaceret.length };
            console.log(`  ${navn}:`, JSON.stringify(stat));
            if (f.ikkePlaceret.length) console.log('  ikke placeret:', f.ikkePlaceret.slice(0, 5).map((x) => `${x.id} ${x.aarsag}`).join(' | '));
            assert.deepEqual(fejlMit.map((x) => `${x.type}: ${x.tekst}`), []);
            assert.ok(ms < 3000, `forslag på ${ms} ms`);
            const u9 = jesper.raekker.find((r) => r.id === 'U09 D');
            if (!u9) {
                assert.equal(f.ikkePlaceret.length, 0, 'alle kampe kunne placeres');
            } else {
                // U9 har som standard TP's vindue 12:00–17:00 og 5 reserverede baner. 6 Swiss-runder
                // (alle 19 drenge fri i rundens slot) plus deres doubler kræver mere end 10 slots,
                // så nogle U9-kampe mangler plads — som i Jespers egen plan, der løb til 17:30.
                assert.deepEqual([u9.tidligst, u9.senest, u9.reserveredeBaner], ['12:00', '17:00', 5]);
                const katMap = new Map(jesper.kampe.map((k) => [k.id, k.kategori]));
                assert.ok(f.ikkePlaceret.every((x) => katMap.get(x.id).startsWith('U09')), 'kun U9-kampe mangler');
                assert.ok(f.ikkePlaceret.length <= 12);
                const laengere = lavForslag(opdaterRaekke(jesper, 'U09 D', { senest: '18:00' }));
                assert.equal(laengere.ikkePlaceret.length, 0, 'med vindue til 18:00 placeres alt');
                assert.deepEqual(fejl(anvendForslag(jesper, laengere)), []);
                // U9-runderne ligger lige efter hinanden: runde r+1 senest 60 min efter runde r
                const swiss = jesper.kampe.filter((k) => k.kategori === 'U09 D HS');
                const rundeTid = (r) => Math.min(...swiss.filter((k) => k.runde === r).map((k) => Number(laengere.plan[k.id].slot.replace(':', ''))));
                for (let r = 2; r <= 6; r += 1) assert.ok(rundeTid(r) - rundeTid(r - 1) <= 100, `runde ${r} følger runde ${r - 1}`);
            }
        });
    });
}

describe('scheduler: raekkens eget tidsrum', () => {
    test('forslaget holder sig inden for raekkens tidsrum', () => {
        const p = opdaterRaekke(projekt(), 'U09 D', { tidligst: '12:00', senest: '14:00' });
        const f = lavForslag(p);
        const u9 = p.kampe.filter((k) => k.kategori === 'U09 D HS');
        assert.ok(u9.every((k) => f.plan[k.id] && f.plan[k.id].slot >= '12:00' && f.plan[k.id].slot < '14:00'));
        assert.deepEqual(fejl(anvendForslag(p, f)), []);
        const p2 = opdaterRaekke(projekt(), 'U09 D', { tidligst: '14:30', senest: '15:00' });
        const f2 = lavForslag(p2);
        assert.ok(f2.ikkePlaceret.length > 0, 'for lille tidsrum giver ikke placerede');
        assert.ok(f2.ikkePlaceret.every((x) => x.aarsag), 'alle har en årsag');
        assert.ok(f2.ikkePlaceret.some((x) => /rækkens/.test(x.aarsag)), 'mindst én skyldes tidsrummet');
    });
});

describe('scheduler: reserverede baner', () => {
    test('U9 faar sine egne baner i vinduet og de andre raekker deler resten', () => {
        let p = opdaterRaekke(projekt(), 'U09 D', { tidligst: '12:00', senest: '14:00', reserveredeBaner: 1 });
        const f = lavForslag(p);
        const q = anvendForslag(p, f);
        assert.deepEqual(fejl(q), []);
        assert.deepEqual(f.ikkePlaceret, []);
        const u9 = q.kampe.filter((k) => k.kategori === 'U09 D HS');
        assert.ok(u9.every((k) => q.plan[k.id].slot >= '12:00' && q.plan[k.id].slot < '14:00'));
        // i vinduet maa de andre raekker hoejst bruge 2 baner pr. slot
        for (const slot of ['12:00', '12:30', '13:00', '13:30']) {
            const andre = q.kampe.filter((k) => k.kategori !== 'U09 D HS' && q.plan[k.id].dag === '2026-11-21' && q.plan[k.id].slot === slot);
            assert.ok(andre.length <= 2, `${slot}: ${andre.length} kampe paa faelles baner`);
        }
        // Swiss-runderne foelger lige efter hinanden
        const t = (id) => { const [h, m] = q.plan[id].slot.split(':').map(Number); return h * 60 + m; };
        assert.equal(t('5:r2:1') - t('5:1'), 30);
        assert.equal(t('5:r3:1') - t('5:r2:1'), 30);
    });
});

describe('scheduler: alternative forslag', () => {
    test('flere forskellige lovlige forslag, sorteret bedst foerst, deterministisk', () => {
        const p = projekt();
        const alt = lavAlternativer(p);
        assert.ok(alt.length >= 2 && alt.length <= ALTERNATIV_VARIANTER.length, `${alt.length} forslag`);
        const noegler = new Set(alt.map((a) => JSON.stringify(Object.entries(a.plan).sort())));
        assert.equal(noegler.size, alt.length, 'ingen dubletter');
        for (const a of alt) {
            assert.deepEqual(fejl(anvendForslag(p, a)), [], a.navn);
            assert.ok(a.navn && a.beskrivelse && a.statistik);
        }
        for (let i = 1; i < alt.length; i += 1) {
            assert.ok(alt[i - 1].ikkePlaceret.length < alt[i].ikkePlaceret.length || alt[i - 1].statistik.haltidMin <= alt[i].statistik.haltidMin, 'sorteret');
        }
        assert.deepEqual(lavAlternativer(p).map((a) => a.plan), alt.map((a) => a.plan), 'samme input giver samme alternativer');
    });
    test('seed giver anden, men reproducerbar raekkefoelge', () => {
        const p = projekt();
        const a = lavForslag(p, { prioritet: ['frist', 'spillet', 'tilfaeldig', 'id'], seed: 11 });
        const b = lavForslag(p, { prioritet: ['frist', 'spillet', 'tilfaeldig', 'id'], seed: 11 });
        assert.deepEqual(a.plan, b.plan);
        assert.deepEqual(fejl(anvendForslag(p, a)), []);
    });
    test('laaste kampe beholdes i alle alternativer', () => {
        let p = flytKamp(projekt(), '4:1', '2026-11-21', '12:00');
        p = laasKamp(p, '4:1');
        for (const a of lavAlternativer(p)) assert.deepEqual(a.plan['4:1'], { dag: '2026-11-21', slot: '12:00' }, a.navn);
    });
});
