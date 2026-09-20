// Tests af de bløde kriterier med vægte (kriterier.js) og de hårde rækkeregler
// som data (max haltid, max dage) i rules.js og scheduler.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KRITERIER, VAEGT_SKABELONER, scorePlan, vaegteFor } from '../../src/kriterier.js';
import { nytProjekt, opdaterDag, opdaterRaekke, flytKamp, anvendForslag, opdaterVaegt, saetVaegtSkabelon } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag, lavAlternativer } from '../../src/scheduler.js';

function model() {
    const sp = (id) => [id, { id, fornavn: id, efternavn: 'X', koen: 'H', foedt: null, klub: 'K', memberid: null, niveau: {} }];
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
            { id: 'U09 D HS', eventId: 1, raekke: 'U09 D', aargang: 'U09', kat: 'HS', type: 'single', mix: false, form: 'pulje', tilmeldte: 6, kampe: 6, runder: 0, halvBane: false },
            { id: 'U13 M HS', eventId: 2, raekke: 'U13 M', aargang: 'U13', kat: 'HS', type: 'single', mix: false, form: 'pulje-cup', tilmeldte: 6, kampe: 7, runder: 0, halvBane: false },
        ],
        spillere: Object.fromEntries('abcdefghijkl'.split('').map(sp)),
        kampe: [
            ...pulje(1, 'Pulje 1', 'U09 D HS', ['a', 'b', 'c']),
            ...pulje(2, 'Pulje 2', 'U09 D HS', ['d', 'e', 'f']),
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

describe('kriterier: score og vægte', () => {
    test('nyt projekt har standardvægtene, og alle kriterier har en vægt', () => {
        const p = projekt();
        assert.deepEqual(p.opsaetning.vaegte, VAEGT_SKABELONER.standard.vaegte);
        assert.equal(p.opsaetning.vaegtSkabelon, 'standard');
        for (const k of KRITERIER) assert.ok(k.id in vaegteFor(p), k.id);
        assert.deepEqual(vaegteFor({ opsaetning: {} }), VAEGT_SKABELONER.standard.vaegte, 'ældre projekter uden vægte');
    });
    test('tom plan scorer 0; ventetid, lange huller og sluttid tæller rigtigt', () => {
        let p = projekt();
        assert.equal(scorePlan(p).total, 0);
        p = flytKamp(p, '1:1', '2026-11-21', '09:00'); // a, b
        p = flytKamp(p, '1:2', '2026-11-21', '12:00'); // a, c — a venter 150 min
        const s = scorePlan(p);
        const del = Object.fromEntries(s.dele.map((d) => [d.id, d]));
        assert.equal(del.ventetid.vaerdi, 2.5, 'a: 09:00→12:30 = 210 min i hallen minus 2 kampe á 30 = 150 min = 2,5 t');
        assert.equal(del.langeHuller.vaerdi, 1);
        assert.equal(del.sluttid.vaerdi, 3.5, '09:00 → 12:30');
        assert.equal(del.tommeBaner.vaerdi, 12, '7 slots x 2 baner = 14, minus 2 kampe');
        assert.equal(s.total, Math.round((2.5 * 1 + 1 * 2 + 3.5 * 2 + 12 * 0.1) * 10) / 10);
    });
    test('puljerunder ude af takt og finaler spredt', () => {
        let p = projekt();
        p = flytKamp(p, '1:1', '2026-11-21', '09:00');
        p = flytKamp(p, '1:2', '2026-11-21', '09:30'); // runde 2 i pulje 1 …
        p = flytKamp(p, '2:1', '2026-11-21', '10:00'); // … før runde 1 i pulje 2 er spillet
        const del = Object.fromEntries(scorePlan(p).dele.map((d) => [d.id, d]));
        assert.equal(del.puljerunderSpredt.vaerdi, 1);
        assert.equal(del.finalerSpredt.vaerdi, 0);
    });
    test('vægte og skabeloner ændrer scoren, ikke kriteriernes værdier', () => {
        let p = projekt();
        p = flytKamp(p, '1:1', '2026-11-21', '09:00');
        p = flytKamp(p, '1:2', '2026-11-21', '12:00');
        const std = scorePlan(p);
        const tidlig = scorePlan(saetVaegtSkabelon(p, 'tidligSlut'));
        assert.deepEqual(std.dele.map((d) => d.vaerdi), tidlig.dele.map((d) => d.vaerdi));
        assert.ok(tidlig.total > std.total, 'sluttid vejer 8 i stedet for 2');
        const egen = opdaterVaegt(p, 'ventetid', 0);
        assert.equal(egen.opsaetning.vaegtSkabelon, 'egen');
        assert.equal(scorePlan(egen).total, Math.round((std.total - 2.5) * 10) / 10);
        assert.equal(saetVaegtSkabelon(p, 'findes-ikke'), p);
    });
    test('alternativer har score og er sorteret efter færrest brud, dernæst lavest score', () => {
        const alt = lavAlternativer(projekt());
        assert.ok(alt.every((a) => typeof a.score === 'number'));
        for (let i = 1; i < alt.length; i += 1) {
            const a = alt[i - 1], b = alt[i];
            const ba = a.brud.length + a.ikkePlaceret.length, bb = b.brud.length + b.ikkePlaceret.length;
            assert.ok(ba < bb || (ba === bb && a.score <= b.score), `${a.navn} før ${b.navn}`);
        }
    });
});

describe('hårde rækkeregler som data: max haltid og max dage', () => {
    test('standarder: U9 max 240 min; D-rækker max 1 dag; M-rækker ingen grænse', () => {
        const p = projekt();
        assert.deepEqual(p.raekker.map((r) => [r.id, r.maxHaltidMin, r.maxDage]), [['U09 D', 240, 1], ['U13 M', null, null]]);
    });
    test('Tjek: afviklingen af rækkens singlekampe over grænsen er en fejl', () => {
        let p = projekt();
        p = flytKamp(p, '1:1', '2026-11-21', '09:00');
        p = flytKamp(p, '1:2', '2026-11-21', '13:00'); // U09 D's singler: 09:00–13:30 = 270 min > 240
        const f = tjekPlan(p).problemer.filter((x) => x.type === 'max-haltid');
        assert.equal(f.length, 1);
        assert.equal(f[0].alvor, 'fejl');
        assert.match(f[0].tekst, /U09 D: singlekampene strækker sig over 270 min .* højst vare 240 min/);
        assert.deepEqual(f[0].kampe, ['1:2'], 'kampen, der ligger for sent, er den, der peges på');
        assert.equal(tjekPlan(flytKamp(p, '1:2', '2026-11-21', '12:30')).problemer.filter((x) => x.type === 'max-haltid').length, 0, '240 min er ok');
        assert.equal(tjekPlan(opdaterRaekke(p, 'U09 D', { maxHaltidMin: null })).problemer.filter((x) => x.type === 'max-haltid').length, 0, 'ingen grænse');
    });
    test('forslaget overholder max haltid og max dage', () => {
        // fælles pause 12 min (M + ABCD) giver kamp hver anden slot: en 3-pulje kræver 150 min fra første til sidste kamp
        const p = opdaterRaekke(projekt(), 'U09 D', { maxHaltidMin: 150 });
        const f = lavForslag(p);
        const q = anvendForslag(p, f);
        assert.deepEqual(tjekPlan(q).problemer.filter((x) => x.alvor === 'fejl'), []);
        assert.equal(f.brud.length, 0);
        const u9Dage = new Set(q.kampe.filter((k) => k.kategori === 'U09 D HS').map((k) => q.plan[k.id].dag));
        assert.equal(u9Dage.size, 1, 'U09 D må kun spille én dag');
    });
    test('kan max haltid ikke overholdes, placeres kampen alligevel med regelbrud "max-haltid"', () => {
        // én bane og max 60 min: a's to kampe kan ikke ligge inden for 60 min, når runde 2 kræver pause
        let p = opdaterRaekke(projekt(), 'U09 D', { maxHaltidMin: 30 });
        p = opdaterDag(p, '2026-11-21', { baner: 1 });
        const f = lavForslag(p);
        assert.equal(f.ikkePlaceret.length, 0);
        assert.ok(f.brud.some((x) => x.brud === 'max-haltid'), JSON.stringify(f.brud.map((x) => x.brud)));
        assert.ok(tjekPlan(anvendForslag(p, f)).problemer.some((x) => x.type === 'max-haltid'));
    });
    test('max dage: række over flere dage end tilladt giver advarsel, dispensation fjerner den', () => {
        let p = opdaterRaekke(projekt(), 'U13 M', { maxDage: 1 });
        p = flytKamp(p, '3:1', '2026-11-21', '09:00');
        p = flytKamp(p, '3:2', '2026-11-22', '09:00');
        assert.equal(tjekPlan(p).problemer.filter((x) => x.type === 'flere-dage').length, 1);
        assert.equal(tjekPlan(opdaterRaekke(p, 'U13 M', { dispensationFlereDage: true })).problemer.filter((x) => x.type === 'flere-dage').length, 0);
        assert.equal(tjekPlan(opdaterRaekke(p, 'U13 M', { maxDage: 2 })).problemer.filter((x) => x.type === 'flere-dage').length, 0);
    });
});
