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
