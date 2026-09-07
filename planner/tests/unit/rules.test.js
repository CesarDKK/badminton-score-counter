// Unit-tests af reglerne (design § 5) på små håndlavede planer, samt
// benchmark mod Jespers egne planer i de lokale Lyngby-filer.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tjekPlan, alvorForKamp, minKampMin, pauseForRaekke, foerSkoledag, tidsvindue } from '../../src/rules.js';
import { nytProjekt, flytKamp, fjernFraPlan, rydDag, kvitter, opdaterRaekke, opdaterPause, saetSlotMin, opdaterDag, opdaterOpsaetning, opdaterRegler, nulstilRegler, reglerFor, STANDARD_REGLER } from '../../src/store.js';

const her = path.dirname(fileURLToPath(import.meta.url));

// ── Lille turnering: U11 D HS (pulje 3 + cup), U11 D DS (pulje 3), U09 D HS (Swiss 2 runder) ──

function model() {
    const sp = (id, navn, koen = 'H') => [id, { id, fornavn: navn, efternavn: 'X', koen, foedt: '2015-01-01', klub: 'Lyngby', memberid: null, niveau: {} }];
    const kamp = (id, kategori, fase, runde, spillere, ekstra = {}) => ({
        id, kategori, fase, gruppe: 'Pulje 1', runde, navn: ekstra.navn || id, spillere, muligeSpillere: ekstra.mulige || spillere,
        afhaengerAf: ekstra.deps || [], tpRef: { draw: ekstra.draw ?? 1, planning: 0, van1: 0, van2: 0, matchnr: 0 }, tpTid: null, varighed: 0, ...(ekstra.rundeNavn ? { rundeNavn: ekstra.rundeNavn } : {}),
    });
    return {
        version: 1,
        kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null },
        turnering: { navn: 'Test', hal: '', dage: ['2026-11-21', '2026-11-22'] },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 2, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: [
            { id: 'U11 D', aargang: 'U11', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U11 D HS', 'U11 D DS'] },
            { id: 'U09 D', aargang: 'U09', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U09 D HS'] },
        ],
        kategorier: [
            { id: 'U11 D HS', eventId: 1, raekke: 'U11 D', aargang: 'U11', kat: 'HS', type: 'single', mix: false, form: 'pulje-cup', tilmeldte: 3, kampe: 4, runder: 0, halvBane: false },
            { id: 'U11 D DS', eventId: 2, raekke: 'U11 D', aargang: 'U11', kat: 'DS', type: 'single', mix: false, form: 'pulje', tilmeldte: 3, kampe: 3, runder: 0, halvBane: false },
            { id: 'U09 D HS', eventId: 3, raekke: 'U09 D', aargang: 'U09', kat: 'HS', type: 'single', mix: false, form: 'swiss', tilmeldte: 4, kampe: 4, runder: 2, halvBane: true },
        ],
        spillere: Object.fromEntries([sp('a', 'Anton'), sp('b', 'Bertil'), sp('c', 'Carl'), sp('d', 'Dorte', 'D'), sp('e', 'Emma', 'D'), sp('f', 'Freja', 'D'), sp('g', 'Gustav'), sp('h', 'Hans'), sp('i', 'Ib'), sp('j', 'Jon')]),
        kampe: [
            kamp('p1', 'U11 D HS', 'pulje', 1, ['a', 'b'], { navn: 'Pulje 1 #1 – #2' }),
            kamp('p2', 'U11 D HS', 'pulje', 2, ['a', 'c'], { navn: 'Pulje 1 #1 – #3', deps: ['p1'] }),
            kamp('p3', 'U11 D HS', 'pulje', 3, ['b', 'c'], { navn: 'Pulje 1 #2 – #3', deps: ['p2'] }),
            kamp('f1', 'U11 D HS', 'cup', 1, [], { navn: 'Finale: Pulje 1 #1 – Pulje 1 #2', mulige: ['a', 'b', 'c'], deps: ['p1', 'p2', 'p3'], draw: 2, rundeNavn: 'Finale' }),
            kamp('q1', 'U11 D DS', 'pulje', 1, ['d', 'e'], { draw: 3 }),
            kamp('q2', 'U11 D DS', 'pulje', 2, ['d', 'f'], { draw: 3, deps: ['q1'] }),
            kamp('q3', 'U11 D DS', 'pulje', 3, ['e', 'f'], { draw: 3, deps: ['q2'] }),
            kamp('s1', 'U09 D HS', 'swiss', 1, ['g', 'h'], { draw: 4 }),
            kamp('s2', 'U09 D HS', 'swiss', 1, ['i', 'j'], { draw: 4 }),
            kamp('s3', 'U09 D HS', 'swiss', 2, [], { draw: 4, mulige: ['g', 'h', 'i', 'j'], deps: ['s1', 's2'] }),
            kamp('s4', 'U09 D HS', 'swiss', 2, [], { draw: 4, mulige: ['g', 'h', 'i', 'j'], deps: ['s1', 's2'] }),
        ],
        bemaerkninger: [],
    };
}

function projekt() {
    let p = nytProjekt(model());
    p = opdaterDag(p, '2026-11-21', { baner: 2, start: '09:00', slut: '19:00' });
    p = opdaterDag(p, '2026-11-22', { baner: 2, start: '09:00', slut: '19:00' });
    p = opdaterOpsaetning(p, { kampVarighed: 'slot' }); // streng: kampen regnes til et helt slot
    return p;
}

const typer = (t) => t.problemer.map((p) => p.type);

describe('rules: hjælpere', () => {
    test('minimum kamptid og pauser', () => {
        assert.equal(minKampMin('U11', 'D'), 20);
        assert.equal(minKampMin('U13', 'M'), 25);
        assert.equal(minKampMin('SEN', 'A'), 25);
        assert.equal(minKampMin('SEN', 'E'), 30);
        assert.equal(pauseForRaekke({ ABCD: 10, M: 15, E: 20, faelles: null }, 'M'), 15);
        assert.equal(pauseForRaekke({ ABCD: 10, M: 15, E: 20, faelles: 12 }, 'M'), 12);
        assert.equal(pauseForRaekke({ ABCD: 10, M: 15, E: 20, faelles: 12 }, 'E'), 20);
    });
    test('dag før skoledag og tidsvindue', () => {
        assert.equal(foerSkoledag({ dato: '2026-11-21' }), false, 'lørdag');
        assert.equal(foerSkoledag({ dato: '2026-11-22' }), true, 'søndag');
        assert.equal(foerSkoledag({ dato: '2026-11-22', foerSkoledag: false }), false, 'overstyret');
        assert.deepEqual(tidsvindue('U11', { dato: '2026-11-21' }), { fra: 540, til: 1140 });
        assert.deepEqual(tidsvindue('U11', { dato: '2026-11-22' }), { fra: 540, til: 1020 });
        assert.deepEqual(tidsvindue('U17', { dato: '2026-11-21' }), { fra: 540, til: 1260 });
    });
});

describe('rules: en lovlig plan', () => {
    let p = projekt();
    p = flytKamp(p, 'p1', '2026-11-21', '09:00');
    p = flytKamp(p, 'q1', '2026-11-21', '09:00');
    p = flytKamp(p, 'p2', '2026-11-21', '10:00');
    p = flytKamp(p, 'q2', '2026-11-21', '10:00');
    p = flytKamp(p, 'p3', '2026-11-21', '11:00');
    p = flytKamp(p, 'q3', '2026-11-21', '11:00');
    p = flytKamp(p, 'f1', '2026-11-21', '12:00');
    p = flytKamp(p, 's1', '2026-11-21', '13:00');
    p = flytKamp(p, 's2', '2026-11-21', '13:00');
    p = flytKamp(p, 's3', '2026-11-21', '14:00');
    p = flytKamp(p, 's4', '2026-11-21', '14:00');
    const t = tjekPlan(p);
    test('giver kun turneringsform-advarsler', () => {
        assert.deepEqual(t.problemer.filter((x) => x.alvor === 'fejl'), []);
        assert.deepEqual(typer(t), ['form', 'form', 'form', 'form'], 'U11 D HS/DS: 2 puljekampe < 4; Swiss 2 runder < 4 og 2 kampe < 4');
        assert.equal(t.antal.fejl, 0);
        assert.equal(alvorForKamp(t, 'p1'), null);
    });
    test('to halve U9-baner deler én hel bane', () => {
        // 2 baner: s1+s2 (halve) = 1 bane + plads til én hel
        const p2 = flytKamp(p, 'f1', '2026-11-21', '13:00');
        assert.ok(!typer(tjekPlan(p2)).includes('kapacitet'));
        const p3 = flytKamp(p2, 'p3', '2026-11-21', '13:00');
        assert.ok(typer(tjekPlan(p3)).includes('kapacitet'));
    });
    test('kvitterede advarsler forsvinder', () => {
        const p2 = kvitter(kvitter(kvitter(kvitter(p, 'U11 D HS:min-kampe'), 'U11 D DS:min-kampe'), 'U09 D HS:swiss-runder'), 'U09 D HS:min-kampe');
        assert.deepEqual(tjekPlan(p2).problemer, []);
        assert.equal(tjekPlan(kvitter(p2, 'U09 D HS:swiss-runder', false)).problemer.length, 1);
    });
});

describe('rules: regelbrud', () => {
    const grund = () => {
        let p = projekt();
        p = flytKamp(p, 'p1', '2026-11-21', '09:00');
        p = flytKamp(p, 'p2', '2026-11-21', '10:00');
        p = flytKamp(p, 'p3', '2026-11-21', '11:00');
        p = flytKamp(p, 'f1', '2026-11-21', '12:00');
        return p;
    };
    const fejl = (p, type) => tjekPlan(p).problemer.filter((x) => x.type === type);

    test('kapacitet: tre kampe på to baner', () => {
        let p = grund();
        p = flytKamp(p, 'q1', '2026-11-21', '09:00');
        p = flytKamp(p, 's1', '2026-11-21', '09:00');
        p = flytKamp(p, 's2', '2026-11-21', '09:00');
        const f = fejl(p, 'kapacitet');
        assert.equal(f.length, 1);
        assert.equal(f[0].alvor, 'fejl');
        assert.match(f[0].tekst, /4 kampe \(2 på halv bane\) kræver 3 baner, men der er 2/);
        assert.deepEqual(tjekPlan(p).prSlot.get('2026-11-21|09:00').map((x) => x.type), ['kapacitet']);
    });
    test('dobbeltbooket: samme spiller i to kampe samme slot', () => {
        const p = flytKamp(grund(), 'p2', '2026-11-21', '09:00');
        const f = fejl(p, 'dobbeltbooket');
        assert.equal(f.length, 1);
        assert.match(f[0].tekst, /Anton X er i to kampe kl\. 09:00/);
        assert.equal(alvorForKamp(tjekPlan(p), 'p1'), 'fejl');
    });
    test('pause: 30-min slots og 10 min pause kræver 60 min mellem starttider', () => {
        const p = flytKamp(grund(), 'p2', '2026-11-21', '09:30');
        const f = fejl(p, 'pause');
        assert.equal(f.length, 1);
        assert.match(f[0].tekst, /kun 0 min pause/);
        assert.equal(fejl(flytKamp(grund(), 'p2', '2026-11-21', '10:00'), 'pause').length, 0);
        // fælles pause 12 → 42 min → stadig 60 min ved 30-min slots; slot 25 + pause 12 = 37 → 09:50 ikke ok, 10:15 ok
        let p2 = saetSlotMin(grund(), 25);
        p2 = opdaterPause(p2, 'faelles', 12);
        p2 = flytKamp(p2, 'p2', '2026-11-21', '09:25');
        assert.equal(fejl(p2, 'pause').length, 1);
        assert.equal(fejl(flytKamp(p2, 'p2', '2026-11-21', '09:50'), 'pause').length, 0);
    });
    test('kampVarighed "minimum": U11 D (20 min + 10 pause) kan ligge i naboslots ved 30-min slots', () => {
        const p = opdaterOpsaetning(flytKamp(grund(), 'p2', '2026-11-21', '09:30'), { kampVarighed: 'minimum' });
        assert.equal(fejl(p, 'pause').length, 0);
        // M-række: 25 + 15 = 40 > 30 → naboslot er for tidligt
        const p2 = opdaterRaekke(p, 'U11 D', { raekke: 'M', pauseKlasse: 'M' });
        assert.equal(fejl(p2, 'pause').length, 1);
        assert.match(fejl(p2, 'pause')[0].tekst, /kun 5 min pause .* \(krav 15 min\)/);
    });

    test('mulige spillere (cup) giver advarsel, ikke fejl', () => {
        const p = flytKamp(grund(), 'f1', '2026-11-21', '11:30');
        const t = tjekPlan(p);
        const pause = t.problemer.filter((x) => x.type === 'pause');
        assert.ok(pause.length >= 1);
        assert.ok(pause.every((x) => x.alvor === 'advarsel'));
        assert.match(pause[0].tekst, /kan have/);
    });
    test('rækkefølge: finalen før puljen er slut', () => {
        const p = flytKamp(grund(), 'f1', '2026-11-21', '11:00');
        const f = fejl(p, 'raekkefoelge');
        assert.equal(f.length, 1);
        assert.match(f[0].tekst, /ligger ikke efter/);
        assert.equal(fejl(fjernFraPlan(p, 'p3'), 'afhaengighed-uden-tid').length, 1);
    });
    test('tidsvindue: U11 slutter 19:00 lørdag og 17:00 søndag (før skoledag)', () => {
        assert.equal(fejl(flytKamp(grund(), 'f1', '2026-11-21', '18:30'), 'tidsvindue').length, 0);
        assert.equal(fejl(flytKamp(grund(), 'f1', '2026-11-22', '18:30'), 'tidsvindue').length, 1);
        assert.equal(fejl(flytKamp(grund(), 'f1', '2026-11-22', '16:30'), 'tidsvindue').length, 0);
        assert.equal(fejl(flytKamp(grund(), 'f1', '2026-11-21', '08:30'), 'tidsvindue').length, 1);
        assert.equal(fejl(flytKamp(grund(), 'f1', '2026-11-21', '08:30'), 'uden-for-dagen').length, 1);
    });
    test('max kampe pr. dag', () => {
        let p = projekt();
        // Anton får 11 kampe: brug kunstige kampe
        for (let i = 0; i < 11; i += 1) {
            p.kampe.push({ id: `x${i}`, kategori: 'U11 D HS', fase: 'pulje', runde: 1, navn: `x${i}`, spillere: ['a', `z${i}`], muligeSpillere: ['a', `z${i}`], afhaengerAf: [], tpRef: { draw: 10 + i }, tpTid: null, varighed: 0 });
            p = flytKamp(p, `x${i}`, '2026-11-21', `${String(9 + Math.floor(i / 1)).padStart(2, '0')}:00`);
        }
        p = opdaterDag(p, '2026-11-21', { slut: '21:00' });
        const f = fejl(p, 'max-kampe');
        assert.equal(f.length, 1);
        assert.match(f[0].tekst, /11 kampe .* \(max 10\)/);
    });
    test('flere dage i en D-række er en advarsel, der kan kvitteres eller dispenseres', () => {
        const p = flytKamp(grund(), 'f1', '2026-11-22', '12:00');
        const f = fejl(p, 'flere-dage');
        assert.equal(f.length, 1);
        assert.equal(f[0].noegle, 'U11 D:flere-dage');
        assert.equal(fejl(kvitter(p, 'U11 D:flere-dage'), 'flere-dage').length, 0);
        assert.equal(fejl(opdaterRaekke(p, 'U11 D', { dispensationFlereDage: true }), 'flere-dage').length, 0);
        assert.equal(fejl(opdaterRaekke(p, 'U11 D', { dage: ['2026-11-21'] }), 'uden-for-raekkens-dage').length, 1);
    });
    test('Swiss: runde 2 for tidligt efter runde 1', () => {
        let p = grund();
        p = flytKamp(p, 's1', '2026-11-21', '13:00');
        p = flytKamp(p, 's2', '2026-11-21', '13:30');
        p = flytKamp(p, 's3', '2026-11-21', '14:00');
        p = flytKamp(p, 's4', '2026-11-21', '14:00');
        const f = fejl(p, 'swiss-runde');
        assert.equal(f.length, 1, 'ét problem pr. runde, ikke ét pr. pladsholder');
        assert.match(f[0].tekst, /runde 2 begynder kl\. 14:00, men runde 1 slutter først kl\. 14:00/);
        assert.equal(fejl(flytKamp(flytKamp(p, 's3', '2026-11-21', '14:30'), 's4', '2026-11-21', '14:30'), 'swiss-runde').length, 0);
        assert.equal(fejl(p, 'raekkefoelge').length, 0, 'pladsholdere tjekkes ikke enkeltvis');
    });
    test('slotlængde under reglementets minimum', () => {
        assert.equal(fejl(saetSlotMin(grund(), 15), 'slot-for-kort').length, 2);
    });
    test('rydDag og kampe uden tid', () => {
        const p = rydDag(grund(), '2026-11-21');
        assert.deepEqual(p.plan, {});
        const info = fejl(p, 'uden-tid');
        assert.equal(info.length, 1);
        assert.equal(info[0].alvor, 'info');
        assert.equal(info[0].kampe.length, 11);
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

const u13 = findTestfil(/U13/i);
const u9 = findTestfil(/U9/i);

describe('rules: benchmark Lyngby U13/U15 CD 2026 (lokal fil)', { skip: !u13 && 'testfil mangler' }, () => {
    test('Jespers plan har ingen hårde fejl med kampVarighed "minimum"', async () => {
        const p = await projektFraFil(u13);
        const t = tjekPlan(p);
        assert.deepEqual(t.problemer.filter((x) => x.alvor === 'fejl').map((x) => `${x.type}: ${x.tekst}`), []);
        assert.ok(t.problemer.some((x) => x.type === 'form'), 'turneringsform-advarsler findes');
    });
    test('med kampVarighed "slot" ligger 99 kampe i naboslots for samme spiller', async () => {
        const p = opdaterOpsaetning(await projektFraFil(u13), { kampVarighed: 'slot' });
        const t = tjekPlan(p);
        const pause = t.problemer.filter((x) => x.type === 'pause' && x.alvor === 'fejl');
        assert.equal(pause.length, 99);
        assert.deepEqual([...new Set(t.problemer.filter((x) => x.alvor === 'fejl').map((x) => x.type))], ['pause']);
    });
});

describe('rules: benchmark Lyngby U9/U11 BCD 2025 (lokal fil)', { skip: !u9 && 'testfil mangler' }, () => {
    test('Jespers plan har kun to tidsvindue-fejl (finaler kl. 19:00 og kl. 17:00 søndag)', async () => {
        const p = await projektFraFil(u9);
        const t = tjekPlan(p);
        const fejl = t.problemer.filter((x) => x.alvor === 'fejl');
        assert.deepEqual(fejl.map((x) => x.type), ['tidsvindue', 'tidsvindue']);
        assert.equal(t.problemer.filter((x) => x.type === 'uden-tid')[0].kampe.length, 45, 'Swiss-pladsholdere runde 2–6');
        assert.equal(t.problemer.filter((x) => x.type === 'swiss-runde').length, 0);
    });
});

// ── Reglementets grænser som parametre ────────────────────────

describe('rules: grænser kan ændres og nulstilles', () => {
    const grund = () => {
        let p = projekt();
        p = flytKamp(p, 'p1', '2026-11-21', '09:00');
        p = flytKamp(p, 'p2', '2026-11-21', '09:30');
        return p;
    };
    const fejl = (p, type) => tjekPlan(p).problemer.filter((x) => x.type === type);

    test('pause 0 minutter er tilladt: naboslots giver ingen fejl', () => {
        const p = opdaterPause(grund(), 'ABCD', 0);
        assert.equal(p.opsaetning.pauseMin.ABCD, 0);
        assert.equal(fejl(p, 'pause').length, 0, 'slot 30 + pause 0 = 30');
        assert.equal(fejl(grund(), 'pause').length, 1, 'med reglementets 10 min er det for tæt');
    });
    test('nyt projekt har reglementets grænser', () => {
        assert.deepEqual(projekt().opsaetning.regler, STANDARD_REGLER);
        assert.deepEqual(reglerFor({ opsaetning: {} }), STANDARD_REGLER, 'ældre projekter uden regler falder tilbage på standard');
    });
    test('tidsvindue og skoledag-forskydning kan ændres', () => {
        let p = flytKamp(grund(), 'f1', '2026-11-22', '18:30');
        assert.equal(fejl(p, 'tidsvindue').length, 1);
        p = opdaterRegler(p, 'foerSkoledagTimer', 0);
        assert.equal(fejl(p, 'tidsvindue').length, 0);
        p = opdaterRegler(p, 'tidsvindue.U11.1', '18:00');
        assert.equal(fejl(p, 'tidsvindue').length, 1);
        assert.deepEqual(p.opsaetning.regler.tidsvindue.U13, ['09:00', '20:00'], 'andre årgange er urørte');
    });
    test('minimumstid og max kampe kan ændres', () => {
        let p = opdaterOpsaetning(grund(), { kampVarighed: 'minimum' });
        assert.equal(fejl(p, 'pause').length, 0, '20 + 10 = 30');
        p = opdaterRegler(p, 'minKampMin.ungdomABCD', 25);
        assert.equal(fejl(p, 'pause').length, 1, '25 + 10 = 35 > 30');
        p = opdaterRegler(p, 'maxKampePrDag', 1);
        assert.equal(fejl(p, 'max-kampe').length, 1, 'Anton har 2 kampe');
    });
    test('min. antal kampe og Swiss-runder kan ændres', () => {
        let p = projekt();
        assert.equal(fejl(p, 'form').length, 4);
        p = opdaterRegler(p, 'minKampe.U9U11Single', 2);
        p = opdaterRegler(p, 'minKampe.swissRunder', 2);
        assert.equal(fejl(p, 'form').length, 3, 'B–D single kræver stadig 3 (også for U09 D HS med 2 runder)');
        p = opdaterRegler(p, 'minKampe.BCDSingle', 2);
        assert.equal(fejl(p, 'form').length, 0);
    });
    test('nulstil sætter grænser og pauser tilbage', () => {
        let p = opdaterRegler(opdaterPause(grund(), 'ABCD', 0), 'maxKampePrDag', 3);
        p = nulstilRegler(p);
        assert.deepEqual(p.opsaetning.regler, STANDARD_REGLER);
        assert.equal(p.opsaetning.pauseMin.ABCD, 10);
    });
});

describe('rules: raekkens eget tidsrum (valgfrit)', () => {
    test('kampe uden for raekkens tidsrum giver en kvitterbar advarsel', () => {
        let p = projekt();
        p = flytKamp(p, 'p1', '2026-11-21', '09:00');
        p = flytKamp(p, 'p2', '2026-11-21', '12:00');
        assert.equal(tjekPlan(p).problemer.filter((x) => x.type === 'raekke-tidsrum').length, 0);
        p = opdaterRaekke(p, 'U11 D', { tidligst: '10:00', senest: '12:30' });
        const adv = tjekPlan(p).problemer.filter((x) => x.type === 'raekke-tidsrum');
        assert.equal(adv.length, 1);
        assert.equal(adv[0].alvor, 'advarsel');
        assert.deepEqual(adv[0].kampe, ['p1']);
        assert.match(adv[0].tekst, /10:00.12:30/);
        assert.equal(tjekPlan(kvitter(p, adv[0].noegle)).problemer.filter((x) => x.type === 'raekke-tidsrum').length, 0);
    });
});

describe('rules: kapacitet pr. pulje med reserverede baner', () => {
    test('raekken bruger kun sine reserverede baner, de andre deler resten', () => {
        // 2 baner; U09 D reserverer 1 bane kl. 13–15
        let p = opdaterRaekke(projekt(), 'U09 D', { tidligst: '13:00', senest: '15:00', reserveredeBaner: 1 });
        p = flytKamp(p, 's1', '2026-11-21', '13:00');
        p = flytKamp(p, 's2', '2026-11-21', '13:00'); // 2 halve = 1 reserveret bane: ok
        p = flytKamp(p, 'p1', '2026-11-21', '13:00'); // 1 faelles bane: ok
        assert.equal(tjekPlan(p).problemer.filter((x) => x.type === 'kapacitet').length, 0);
        const p2 = flytKamp(p, 'q1', '2026-11-21', '13:00'); // 2 kampe paa 1 faelles bane
        const f = tjekPlan(p2).problemer.filter((x) => x.type === 'kapacitet');
        assert.equal(f.length, 1);
        assert.match(f[0].tekst, /paa de faelles baner|på de fælles baner/);
        assert.deepEqual(f[0].kampe.sort(), ['p1', 'q1']);
        const p3 = flytKamp(p, 's3', '2026-11-21', '13:00'); // 3 halve = 2 baner > 1 reserveret
        const f3 = tjekPlan(p3).problemer.filter((x) => x.type === 'kapacitet');
        assert.equal(f3.length, 1);
        assert.match(f3[0].tekst, /reserverede baner/);
    });
    test('uden for tidsrummet deler alle banerne', () => {
        let p = opdaterRaekke(projekt(), 'U09 D', { tidligst: '13:00', senest: '15:00', reserveredeBaner: 1 });
        p = flytKamp(p, 'p1', '2026-11-21', '10:00');
        p = flytKamp(p, 'q1', '2026-11-21', '10:00');
        assert.equal(tjekPlan(p).problemer.filter((x) => x.type === 'kapacitet').length, 0);
    });
});
