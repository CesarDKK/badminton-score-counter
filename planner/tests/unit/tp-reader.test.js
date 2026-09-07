// Unit-tests af TP-læseren.
//
// Del 1 kører altid på en lille syntetisk turnering (pulje + cup + Swiss Ladder).
// Del 2 kører mod Jespers to rigtige Lyngby-filer, hvis de ligger i
// planner/testdata/ (gitignored — filerne indeholder persondata) eller i
// mappen PLANNER_TESTDATA. Mangler de, springes testene over.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { laesTP, planFraTP, tolkEventNavn, pauseKlasse, datoStr, klokkeStr } from '../../src/tp-reader.js';

const her = path.dirname(fileURLToPath(import.meta.url));

// ── Syntetisk turnering ───────────────────────────────────────

const d = (iso) => new Date(iso); // mdb-reader leverer UTC-Date med vægurets tid
const TOM = d('1899-12-30T00:00:00.000Z');

function syntetisk() {
    const Player = [
        { id: 1, firstname: 'Anna', name: 'A', club: 1, gender: 2, dob: d('2015-02-01T00:00:00Z'), memberid: '150201-01' },
        { id: 2, firstname: 'Bo', name: 'B', club: 1, gender: 1, dob: d('2015-03-01T00:00:00Z'), memberid: null },
        { id: 3, firstname: 'Cai', name: 'C', club: 2, gender: 1, dob: TOM, memberid: null },
        { id: 4, firstname: 'Dan', name: 'D', club: 2, gender: 1, dob: d('2014-03-01T00:00:00Z'), memberid: null },
        { id: 5, firstname: 'Eva', name: 'E', club: 2, gender: 2, dob: d('2014-03-01T00:00:00Z'), memberid: null },
        { id: 6, firstname: 'Finn', name: 'F', club: 1, gender: 1, dob: d('2014-03-01T00:00:00Z'), memberid: null },
    ];
    const Entry = [
        { id: 11, event: 1, player1: 1, player2: null, exclude: false },
        { id: 12, event: 1, player1: 2, player2: null, exclude: false },
        { id: 13, event: 1, player1: 3, player2: null, exclude: false },
        { id: 14, event: 1, player1: 4, player2: null, exclude: false },
        { id: 15, event: 1, player1: 5, player2: null, exclude: false },
        { id: 16, event: 1, player1: 6, player2: null, exclude: false },
        { id: 21, event: 2, player1: 1, player2: null, exclude: false },
        { id: 22, event: 2, player1: 2, player2: null, exclude: false },
        { id: 23, event: 2, player1: 3, player2: null, exclude: false },
        { id: 31, event: 3, player1: 4, player2: 5, exclude: false },
    ];
    // Event 1: U11 D HS = to puljer á 3 + cup med 4 (pulje 1 #1, pulje 2 #2 / pulje 2 #1, bye)
    // Event 2: U09 D HS = Swiss Ladder, 3 spillere, 4 runder
    // Event 3: U09 D D = ingen lodtrækning
    const Event = [
        { id: 1, name: 'U11 D HS', gender: 1, eventtype: 1, level: 6, min_age: 9, max_age: 10 },
        { id: 2, name: 'U09 D HS', gender: 1, eventtype: 1, level: 6, min_age: 0, max_age: 8 },
        { id: 3, name: 'U09 D D', gender: 6, eventtype: 2, level: 6, min_age: 0, max_age: 8 },
    ];
    const Draw = [
        { id: 101, name: 'Pulje 1', event: 1, drawtype: 2, drawsize: 3, drawrounds: 0 },
        { id: 102, name: 'Pulje 2', event: 1, drawtype: 2, drawsize: 3, drawrounds: 0 },
        { id: 103, name: 'U11 D HS', event: 1, drawtype: 1, drawsize: 4, drawrounds: 0 },
        { id: 104, name: 'U09 D HS', event: 2, drawtype: 17, drawsize: 3, drawrounds: 4 },
    ];
    const Link = [
        { id: 201, src_draw: 101, src_pos: 1, name: 'Pulje 1 #1' },
        { id: 202, src_draw: 102, src_pos: 2, name: 'Pulje 2 #2' },
        { id: 203, src_draw: 102, src_pos: 1, name: 'Pulje 2 #1' },
    ];
    const pos = (draw, p, entry) => ({ draw, planning: p * 1000, entry, van1: 0, van2: 0, roundnr: 0, plandate: TOM, link: null, matchnr: 0, duration: 0 });
    const pk = (draw, a, b, runde, plandate, matchnr) => [
        { draw, planning: a * 1000 + b, entry: null, van1: a * 1000, van2: b * 1000, roundnr: runde, plandate, link: null, matchnr, duration: 0 },
        { draw, planning: b * 1000 + a, entry: null, van1: b * 1000, van2: a * 1000, roundnr: runde, plandate, link: null, matchnr, duration: 0 },
    ];
    const l = d('2025-11-22T09:00:00.000Z'), l2 = d('2025-11-22T10:00:00.000Z'), l3 = d('2025-11-22T11:00:00.000Z');
    const PlayerMatch = [
        pos(101, 1, 11), pos(101, 2, 12), pos(101, 3, 13),
        ...pk(101, 1, 2, 1, l, 1), ...pk(101, 1, 3, 2, l2, 2), ...pk(101, 2, 3, 3, l3, 3),
        pos(102, 1, 14), pos(102, 2, 15), pos(102, 3, 16),
        ...pk(102, 1, 2, 1, l, 4), ...pk(102, 1, 3, 2, TOM, 5), ...pk(102, 2, 3, 3, TOM, 6),
        // cup: 1001 finale, 2001/2002 semifinaler, 3001-3004 blade. 2002 er bye (3004 tom).
        { draw: 103, planning: 1001, entry: null, van1: 2001, van2: 2002, wn: 0, roundnr: 2, plandate: d('2025-11-22T15:00:00.000Z'), link: null, matchnr: 3, duration: 0 },
        { draw: 103, planning: 2001, entry: null, van1: 3001, van2: 3002, wn: 1001, roundnr: 1, plandate: d('2025-11-22T14:00:00.000Z'), link: null, matchnr: 1, duration: 0 },
        { draw: 103, planning: 2002, entry: null, van1: 3003, van2: 3004, wn: 1001, roundnr: 1, plandate: TOM, link: null, matchnr: 2, duration: 0 },
        { draw: 103, planning: 3001, entry: null, van1: 0, van2: 0, wn: 2001, roundnr: 0, plandate: TOM, link: 201, matchnr: 0, duration: 0 },
        { draw: 103, planning: 3002, entry: null, van1: 0, van2: 0, wn: 2001, roundnr: 0, plandate: TOM, link: 202, matchnr: 0, duration: 0 },
        { draw: 103, planning: 3003, entry: null, van1: 0, van2: 0, wn: 2002, roundnr: 0, plandate: TOM, link: 203, matchnr: 0, duration: 0 },
        { draw: 103, planning: 3004, entry: null, van1: 0, van2: 0, wn: 2002, roundnr: 0, plandate: TOM, link: null, matchnr: 0, duration: 0 },
        // swiss: 3 spillere, runde 1 = #1–#2 (spejlet), #3 oversidder; runde 2-4 pladsholdere
        pos(104, 1, 21), pos(104, 2, 22), pos(104, 3, 23),
        { draw: 104, planning: 1001, entry: null, van1: 1000, van2: 2000, roundnr: 1, plandate: d('2025-11-23T12:00:00.000Z'), link: null, matchnr: 0, duration: 0 },
        { draw: 104, planning: 2001, entry: null, van1: 2000, van2: 1000, roundnr: 1, plandate: d('2025-11-23T12:00:00.000Z'), link: null, matchnr: 0, duration: 0 },
        ...[2, 3, 4].flatMap((r) => [1, 2, 3].map((p) => ({ draw: 104, planning: p * 1000 + r, entry: null, van1: 0, van2: 0, roundnr: r, plandate: r === 2 ? d('2025-11-23T13:00:00.000Z') : TOM, link: null, matchnr: 0, duration: 0 }))),
    ];
    const TournamentDay = [{ tournamentday: d('2025-11-22T00:00:00Z') }, { tournamentday: d('2025-11-23T00:00:00Z') }];
    const TournamentTime = [];
    for (let m = 9 * 60; m <= 18 * 60 + 30; m += 30) {
        TournamentTime.push({ tournamentday: d('2025-11-22T00:00:00Z'), tournamenttime: d(`1899-12-30T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00.000Z`), courts: m >= 12 * 60 && m < 14 * 60 ? 15 : 10 });
    }
    TournamentTime.push({ tournamentday: d('2025-11-22T00:00:00Z'), tournamenttime: d('1899-12-30T00:00:00.000Z'), courts: 10 });
    const tabeller = {
        Settings: [{ name: 'Tournament', value: 'Testby' }, { name: 'Location', value: 'Testhallen' }, { name: 'Version', value: '202501' }],
        Club: [{ id: 1, name: 'Lyngby' }, { id: 2, name: 'Gentofte' }],
        PlayerlevelEntry: [{ playerid: 1, level1: 6, level2: 5, level3: 6 }],
        Player, Entry, Event, Draw, Link, PlayerMatch, TournamentDay, TournamentTime,
        Court: [{ name: '01-B' }, { name: '02-B' }, { name: '01-B½' }, { name: '02-B½' }],
        MatchWarning: [],
    };
    return { har: (n) => n in tabeller, hent: (n) => tabeller[n] || [] };
}

describe('tp-reader: hjælpere', () => {
    test('tolkEventNavn læser årgang, række og kategori fra navnet', () => {
        assert.deepEqual(tolkEventNavn('U11 B HS'), { aargang: 'U11', raekke: 'B', katNavn: 'HS' });
        assert.deepEqual(tolkEventNavn('U09 D D'), { aargang: 'U09', raekke: 'D', katNavn: 'D' });
        assert.deepEqual(tolkEventNavn('SEN M MD'), { aargang: 'SEN', raekke: 'M', katNavn: 'MD' });
    });
    test('tolkEventNavn falder tilbage på alder og niveau', () => {
        assert.deepEqual(tolkEventNavn('Herresingle', { maxAlder: 10, niveau: 5 }), { aargang: 'U11', raekke: 'C', katNavn: 'Herresingle' });
        assert.equal(tolkEventNavn('HS', { maxAlder: 0, niveau: 2 }).aargang, 'SEN');
    });
    test('pauseKlasse følger reglementet', () => {
        assert.equal(pauseKlasse('E'), 'E');
        assert.equal(pauseKlasse('M'), 'M');
        for (const r of ['A', 'B', 'C', 'D']) assert.equal(pauseKlasse(r), 'ABCD');
    });
    test('datoer læses som vægur (UTC), ikke lokal tid', () => {
        const x = d('2025-11-22T09:30:00.000Z');
        assert.equal(datoStr(x), '2025-11-22');
        assert.equal(klokkeStr(x), '09:30');
    });
});

describe('tp-reader: syntetisk turnering', () => {
    const model = laesTP(syntetisk(), { filnavn: 'test.tp', nu: d('2026-09-07T12:00:00Z') });

    test('turnering, kilde og bemærkninger', () => {
        assert.equal(model.turnering.navn, 'Testby');
        assert.equal(model.turnering.hal, 'Testhallen');
        assert.deepEqual(model.turnering.dage, ['2025-11-22', '2025-11-23']);
        assert.equal(model.kilde.filnavn, 'test.tp');
        assert.deepEqual(model.bemaerkninger, []);
    });

    test('spillere med klub, køn, fødselsdato og niveau', () => {
        assert.equal(Object.keys(model.spillere).length, 6);
        assert.deepEqual(model.spillere.p1, {
            id: 'p1', fornavn: 'Anna', efternavn: 'A', koen: 'D', foedt: '2015-02-01', klub: 'Lyngby', memberid: '150201-01',
            niveau: { single: 6, double: 5, mix: 6 },
        });
        assert.equal(model.spillere.p3.foedt, null, 'tom Jet-dato bliver null');
        assert.deepEqual(model.spillere.p3.niveau, { single: null, double: null, mix: null });
    });

    test('kategorier og rækker', () => {
        assert.deepEqual(model.kategorier.map((k) => [k.id, k.raekke, k.kat, k.type, k.form, k.tilmeldte, k.kampe, k.halvBane]), [
            ['U11 D HS', 'U11 D', 'HS', 'single', 'pulje-cup', 6, 8, false],
            ['U09 D HS', 'U09 D', 'HS', 'single', 'swiss', 3, 4, true],
            ['U09 D D', 'U09 D', 'D', 'double', 'ingen lodtrækning', 1, 0, false],
        ]);
        assert.deepEqual(model.raekker.map((r) => [r.id, r.pauseKlasse, r.kategorier]), [
            ['U09 D', 'ABCD', ['U09 D HS', 'U09 D D']],
            ['U11 D', 'ABCD', ['U11 D HS']],
        ]);
        assert.equal(model.kategorier[1].runder, 4);
    });

    test('puljekampe: spejlede rækker slås sammen, spillere og runder er kendte', () => {
        const pulje1 = model.kampe.filter((k) => k.gruppe === 'Pulje 1');
        assert.equal(pulje1.length, 3);
        const k12 = pulje1.find((k) => k.id === 'd101:1002');
        assert.equal(k12.fase, 'pulje');
        assert.equal(k12.navn, 'Pulje 1 #1 – #2');
        assert.deepEqual(k12.spillere, ['p1', 'p2']);
        assert.deepEqual(k12.muligeSpillere, ['p1', 'p2']);
        assert.equal(k12.runde, 1);
        assert.deepEqual(k12.afhaengerAf, []);
        assert.deepEqual(k12.tpTid, { dag: '2025-11-22', slot: '09:00' });
        assert.deepEqual(k12.tpRef, { draw: 101, planning: 1002, van1: 1000, van2: 2000, matchnr: 1 });
        const k23 = pulje1.find((k) => k.id === 'd101:2003');
        assert.equal(k23.runde, 3);
        assert.deepEqual(k23.afhaengerAf, ['d101:1003'], 'runde 3 afhænger af runde 2');
        assert.equal(model.kampe.find((k) => k.id === 'd102:1003').tpTid, null, 'kamp uden tid i TP');
    });

    test('cup: bye-kampe udelades, mulige spillere og afhængigheder kommer fra Link', () => {
        const cup = model.kampe.filter((k) => k.fase === 'cup');
        assert.deepEqual(cup.map((k) => k.id), ['d103:2001', 'd103:1001'], 'kamp 2002 er en bye');
        const semi = cup[0];
        assert.equal(semi.rundeNavn, 'Semifinale');
        assert.equal(semi.navn, 'Semifinale: Pulje 1 #1 – Pulje 2 #2');
        assert.deepEqual(semi.spillere, []);
        assert.deepEqual([...semi.muligeSpillere].sort(), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
        assert.deepEqual([...semi.afhaengerAf].sort(), ['d101:1002', 'd101:1003', 'd101:2003', 'd102:1002', 'd102:1003', 'd102:2003']);
        const finale = cup[1];
        assert.equal(finale.rundeNavn, 'Finale');
        assert.equal(finale.navn, 'Finale: Vinder kamp 1 – Pulje 2 #1', 'bye-siden viser den spiller der går videre');
        assert.deepEqual([...finale.afhaengerAf].sort(), ['d102:1002', 'd102:1003', 'd102:2003', 'd103:2001'],
            'finalen afhænger af semifinalen og — via byen — af pulje 2');
        assert.deepEqual(finale.tpTid, { dag: '2025-11-22', slot: '15:00' });
    });

    test('Swiss Ladder: runde 1 med parringer, runde 2–n som pladsholdere', () => {
        const swiss = model.kampe.filter((k) => k.fase === 'swiss');
        assert.deepEqual(swiss.map((k) => [k.id, k.runde]), [['d104:1001', 1], ['d104:r2:1', 2], ['d104:r3:1', 3], ['d104:r4:1', 4]]);
        assert.deepEqual(swiss[0].spillere, ['p1', 'p2']);
        assert.deepEqual(swiss[1].spillere, []);
        assert.deepEqual(swiss[1].muligeSpillere, ['p1', 'p2', 'p3']);
        assert.deepEqual(swiss[1].afhaengerAf, ['d104:1001']);
        assert.deepEqual(swiss[2].afhaengerAf, ['d104:r2:1']);
        assert.deepEqual(swiss[0].tpTid, { dag: '2025-11-23', slot: '12:00' });
        assert.deepEqual(swiss[1].tpTid, { dag: '2025-11-23', slot: '13:00' }, 'rundens tid læses fra pladsholderne');
        assert.equal(swiss[2].tpTid, null);
    });

    test('TP-gitter: slotlængde, dage, baner og halve baner', () => {
        assert.equal(model.tpGitter.slotMin, 30);
        assert.deepEqual(model.tpGitter.dage, [
            { dato: '2025-11-22', start: '09:00', slut: '19:00', baner: 10 },
            { dato: '2025-11-23', start: null, slut: null, baner: null },
        ]);
        assert.deepEqual(model.tpGitter.baner, { hele: 2, halve: 2, navne: ['01-B', '02-B', '01-B½', '02-B½'] });
        assert.equal(model.tpGitter.harTider, true);
        assert.equal(model.tpGitter.advarsler, 0);
    });

    test('planFraTP giver kun kampe med tid', () => {
        const plan = planFraTP(model);
        assert.equal(Object.keys(plan).length, 3 + 1 + 2 + 2, "pulje 1, pulje 2, cup, swiss");
        assert.deepEqual(plan['d101:1002'], { dag: '2025-11-22', slot: '09:00' });
        assert.equal(plan['d102:1003'], undefined);
    });

    test('læsning er deterministisk', () => {
        const igen = laesTP(syntetisk(), { filnavn: 'test.tp', nu: d('2026-09-07T12:00:00Z') });
        assert.deepEqual(igen, model);
    });
});

// ── Rigtige filer (springes over hvis de mangler) ─────────────

function findTestfiler() {
    const mapper = [process.env.PLANNER_TESTDATA, path.join(her, '..', '..', 'testdata')].filter(Boolean);
    const filer = [];
    for (const mappe of mapper) {
        if (!fs.existsSync(mappe)) continue;
        for (const f of fs.readdirSync(mappe)) if (/\.tp$/i.test(f)) filer.push(path.join(mappe, f));
    }
    return filer;
}

async function laesFil(sti) {
    const { default: MDBReader } = await import('mdb-reader');
    const { tabellerFraMDB } = await import('../../src/tp-reader.js');
    const reader = new MDBReader(fs.readFileSync(sti));
    return laesTP(tabellerFraMDB(reader), { filnavn: path.basename(sti) });
}

const testfiler = findTestfiler();
const u13 = testfiler.find((f) => /U13/i.test(path.basename(f)));
const u9 = testfiler.find((f) => /U9/i.test(path.basename(f)));

describe('tp-reader: Lyngby U13/U15 CD 2026 (lokal fil)', { skip: !u13 && 'testfil mangler i planner/testdata' }, () => {
    let model;
    test('læses', async () => {
        model = await laesFil(u13);
        assert.equal(model.turnering.navn, 'Lyngby');
        assert.equal(model.turnering.hal, 'Engelsborg Hallen');
        assert.deepEqual(model.turnering.dage, ['2026-02-28', '2026-03-01']);
        assert.deepEqual(model.bemaerkninger, []);
    });
    test('225 rigtige kampe (230 rækker minus 5 bye-kampe), alle med tid', () => {
        assert.equal(model.kampe.length, 225);
        assert.deepEqual(Object.fromEntries(["pulje", "cup"].map((f) => [f, model.kampe.filter((k) => k.fase === f).length])), { pulje: 195, cup: 30 });
        assert.equal(model.kampe.filter((k) => k.tpTid).length, 225);
        assert.equal(model.tpGitter.harTider, true);
    });
    test('gitter: 10 baner, 30-min slots', () => {
        assert.equal(model.tpGitter.slotMin, 30);
        assert.deepEqual(model.tpGitter.baner.hele, 10);
        assert.deepEqual(model.tpGitter.baner.halve, 0);
        assert.equal(model.tpGitter.dage[0].baner, 10);
        assert.equal(model.tpGitter.dage[0].start, '09:00');
    });
    test('alle puljekampe har to/fire kendte spillere, cupkampe har mulige spillere og afhængigheder', () => {
        const kendteIds = new Set(model.kampe.map((k) => k.id));
        for (const k of model.kampe) {
            const kat = model.kategorier.find((x) => x.id === k.kategori);
            const n = kat.type === 'double' ? 4 : 2;
            if (k.fase === 'pulje') assert.equal(k.spillere.length, n, `${k.id} ${k.navn}`);
            if (k.fase === 'cup') {
                assert.ok(k.muligeSpillere.length >= n, `${k.id} ${k.navn}`);
                if (k.runde > 1 || /Pulje/.test(k.navn)) assert.ok(k.afhaengerAf.length > 0, `${k.id} har afhængigheder`);
            }
            for (const dep of k.afhaengerAf) assert.ok(kendteIds.has(dep), `${k.id} afhænger af ukendt ${dep}`);
            for (const s of k.muligeSpillere) assert.ok(model.spillere[s], `${k.id} ukendt spiller ${s}`);
        }
    });
    test('ingen kamp afhænger af en kamp med senere TP-tid (Jespers plan er i rigtig rækkefølge)', () => {
        const prId = new Map(model.kampe.map((k) => [k.id, k]));
        const t = (k) => `${k.tpTid.dag}T${k.tpTid.slot}`;
        let brud = 0;
        for (const k of model.kampe) for (const dep of k.afhaengerAf) if (t(prId.get(dep)) >= t(k)) brud += 1;
        assert.equal(brud, 0);
    });
    test('realistiske kampvarigheder er læst med', () => {
        const single = model.kampe.filter((k) => k.varighed > 0 && model.kategorier.find((x) => x.id === k.kategori).type === 'single');
        assert.ok(single.length > 100);
        const gns = single.reduce((s, k) => s + k.varighed, 0) / single.length;
        assert.ok(gns > 25 && gns < 32, `gns single ${gns}`);
    });
});

describe('tp-reader: Lyngby U9/U11 BCD 2025 (lokal fil)', { skip: !u9 && 'testfil mangler i planner/testdata' }, () => {
    let model;
    test('læses', async () => {
        model = await laesFil(u9);
        assert.equal(model.turnering.navn, 'Lyngby');
        assert.deepEqual(model.bemaerkninger, []);
    });
    test('306 kampe: 213 pulje (dobbelt pulje tæller begge møder), 54 Swiss inkl. pladsholdere, 39 cup uden byes', () => {
        assert.equal(model.kampe.length, 306);
        assert.deepEqual(Object.fromEntries(["pulje", "swiss", "cup"].map((f) => [f, model.kampe.filter((k) => k.fase === f).length])), { pulje: 213, swiss: 54, cup: 39 });
        assert.equal(model.kampe.filter((k) => !k.tpTid).length, 45, "kun Swiss-pladsholderne runde 2–6 mangler tid");
    });
    test('U09 D HS er Swiss Ladder med 6 runder á 9 kampe', () => {
        const kat = model.kategorier.find((k) => k.id === 'U09 D HS');
        assert.equal(kat.form, 'swiss');
        assert.equal(kat.runder, 6);
        assert.equal(kat.halvBane, true);
        const kampe = model.kampe.filter((k) => k.kategori === 'U09 D HS');
        assert.equal(kampe.length, 54);
        assert.equal(kampe.filter((k) => k.runde === 1 && k.spillere.length === 2).length, 9);
        assert.equal(kampe.filter((k) => k.runde === 2).length, 9);
        assert.equal(kampe.find((k) => k.runde === 2).muligeSpillere.length, 19);
    });
    test('U09 D DS er dobbelt pulje', () => {
        const kat = model.kategorier.find((k) => k.id === 'U09 D DS');
        assert.equal(kat.form, 'dobbelt-pulje');
        const kampe = model.kampe.filter((k) => k.kategori === 'U09 D DS');
        assert.equal(kampe.length, 6, '3 spillere der møder hinanden to gange');
        assert.equal(new Set(kampe.map((k) => k.id)).size, 6);
    });
    test('halve baner og U9-vinduet i gitteret', () => {
        assert.equal(model.tpGitter.baner.hele, 10);
        assert.equal(model.tpGitter.baner.halve, 5);
        assert.equal(model.tpGitter.dage[0].baner, 10, 'hyppigste antal baner; U9-vinduet med 15 tæller ikke');
        assert.equal(model.tpGitter.dage[0].start, '09:00');
    });
    test('cup: bye-kampe er udeladt og afhængigheder peger på eksisterende kampe', () => {
        const ids = new Set(model.kampe.map((k) => k.id));
        const cup = model.kampe.filter((k) => k.fase === 'cup');
        assert.ok(cup.length > 0);
        for (const k of cup) {
            assert.ok(k.muligeSpillere.length >= 2, `${k.id} ${k.navn}`);
            for (const dep of k.afhaengerAf) assert.ok(ids.has(dep), `${k.id} → ${dep}`);
        }
        const u11dhs = cup.filter((k) => k.kategori === 'U11 D HS');
        assert.equal(u11dhs.length, 9, '16-cup med 6 byes: 2 første-runde-kampe + 4 + 2 + 1');
        assert.equal(u11dhs.filter((k) => k.rundeNavn === 'Finale').length, 1);
    });
});
