// Jesper 2026-10-12: U9-spillere var i hallen fra kl. 9 til efter 15. U9-U11-vejledningen (28-07-2026): "Turneringen må
// max. tager 4 timer i single i U9 – og gerne lidt kortere tid i double … I U11 max. 6 timer i single og det halve i
// double". Jesper: doublerne U9 240 og U11 180 min hårdt, hele U9-rækken højst 300 min hårdt (hans eget valg) — og en blød
// målsætning for U9/U11-spillernes tid i hallen, der også tæller Swiss-runder, hvor spillerne ikke kendes endnu.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, opdaterOpsaetning, flytKamp, anvendForslag, opgraderProjekt, validerProjekt, PROJEKT_VERSION } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem, diagnoseTekst, brudTekster } from '../../src/solver-klient.js';
import { scorePlan, VAEGT_SKABELONER } from '../../src/kriterier.js';
import { kandidater } from '../../src/kampprogram.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

/** a–d i single (Swiss, 3 runder á 2 kampe) og a–h som fire doublepar (pulje, 3 runder á 2 kampe). */
function raekke(aargang = 'U09') {
    const id = `${aargang} D`;
    let p = nytProjekt(model([{ id, aargang, raekke: 'D', kategorier: [
        { kat: 'HS', type: 'single', spillere: [['a'], ['b'], ['c'], ['d']] },
        { kat: 'HD', type: 'double', spillere: [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']] },
    ] }]));
    p = opdaterDag(p, LOER, { baner: 4, start: '09:00', slut: '20:00' });
    p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
    return saetForm(saetForm(p, `${id} HS`, { formValg: 'swiss', swissRunder: 3 }), `${id} HD`, { formValg: 'pulje' });
}
/** Lægger kategoriens runder i de givne slots (runde 1 i første slot osv.). */
const runder = (p, kategori, slots) => slots.reduce((q, slot, i) => p.kampe.filter((k) => k.kategori === kategori && k.runde === i + 1).reduce((r, k) => flytKamp(r, k.id, LOER, slot), q), p);
const varighedsFejl = (p) => tjekPlan(p).problemer.filter((x) => x.type === 'max-haltid').map((x) => x.art).sort();
const halTid = (p) => scorePlan(p).dele.find((d) => d.id === 'halTid').vaerdi;

describe('standardgrænserne og gemte projekter', () => {
    test('U9: doubler 240 og hele rækken 300 min; U11: doubler 180; ældre årgange ingen', () => {
        const p = nytProjekt(model(['U09', 'U11', 'U13'].map((a, i) => ({ id: `${a} D`, aargang: a, raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt(`s${i}`, 2) }] }))));
        assert.deepEqual(p.raekker.map((r) => [r.maxHaltidMin, r.maxDoubleMin, r.maxRaekkeMin]), [[240, 240, 300], [360, 180, null], [null, null, null]]);
    });
    test('et gemt version 2-projekt får grænserne én gang — et senere fravalg bevares', () => {
        const ny = raekke();
        const gammelt = { ...ny, version: 2, raekker: ny.raekker.map(({ maxDoubleMin, maxRaekkeMin, ...r }) => r) };
        const op = opgraderProjekt(gammelt);
        assert.equal(op.version, PROJEKT_VERSION);
        assert.deepEqual(op.raekker.map((r) => [r.maxDoubleMin, r.maxRaekkeMin]), [[240, 300]]);
        const fravalgt = opdaterRaekke(op, 'U09 D', { maxRaekkeMin: null });
        assert.equal(opgraderProjekt(fravalgt).raekker[0].maxRaekkeMin, null);
        assert.equal(validerProjekt(op), null);
        assert.match(validerProjekt({ ...op, raekker: [{ ...op.raekker[0], maxDoubleMin: 'x' }] }), /tal for U09 D/);
    });
});

describe('Tjek: doublerne og hele rækken', () => {
    test('U9: singler 09:00–10:30 og doubler 11:00–12:30 er inden for alle grænser', () => {
        const p = runder(runder(raekke(), 'U09 D HS', ['09:00', '09:30', '10:00']), 'U09 D HD', ['11:00', '11:30', '12:00']);
        assert.deepEqual(varighedsFejl(p), []);
    });
    test('U9: doublerne over 4 timer giver en fejl for doublerne (og for hele rækken)', () => {
        const p = runder(runder(raekke(), 'U09 D HS', ['09:00', '09:30', '10:00']), 'U09 D HD', ['10:30', '12:00', '14:30']);
        assert.deepEqual(varighedsFejl(p), ['double', 'raekke'], 'doubler 10:30–15:00 = 270 min; rækken 09:00–15:00 = 360 min');
        assert.match(tjekPlan(p).problemer.find((x) => x.art === 'double').tekst, /U09 D: doublekampene strækker sig over 270 min.*højst vare 240 min/);
    });
    test('U9: hele rækken over 5 timer, selv om singler og doubler hver for sig er korte', () => {
        const p = runder(runder(raekke(), 'U09 D HS', ['09:00', '09:30', '10:00']), 'U09 D HD', ['13:00', '13:30', '14:00']);
        assert.deepEqual(varighedsFejl(p), ['raekke'], '09:00–14:30 = 330 min');
        const f = tjekPlan(p).problemer.find((x) => x.art === 'raekke');
        assert.match(f.tekst, /U09 D: alle rækkens kampe strækker sig over 330 min/);
        assert.equal(f.kampe.length, 2, 'kampene efter 14:00 (09:00 + 300 min) skal flyttes');
    });
    test('U11: doublerne højst 3 timer ("det halve i double")', () => {
        const p = runder(runder(raekke('U11'), 'U11 D HS', ['09:00', '09:30', '10:00']), 'U11 D HD', ['11:00', '12:00', '14:00']);
        assert.deepEqual(varighedsFejl(p), ['double'], 'doubler 11:00–14:30 = 210 min');
        const ok = runder(runder(raekke('U11'), 'U11 D HS', ['09:00', '09:30', '10:00']), 'U11 D HD', ['11:00', '12:00', '13:30']);
        assert.deepEqual(varighedsFejl(ok), [], '11:00–14:00 = 180 min er netop lovligt');
    });
});

describe('planlægger og løser holder grænserne', () => {
    test('forslaget lægger U9-rækken inden for 5 timer uden fejl', () => {
        const p = raekke();
        const f = lavForslag(p);
        assert.equal(f.ikkePlaceret.length, 0);
        assert.deepEqual(varighedsFejl(anvendForslag(p, f)), []);
    });
    test('forslaget bryder hellere andet end at gå over grænsen: grænsen 90 min kan ikke holdes → brud registreres', () => {
        const p = opdaterRaekke(raekke(), 'U09 D', { maxRaekkeMin: 90 });
        const f = lavForslag(p);
        assert.ok(f.brud.length > 0);
        assert.deepEqual(varighedsFejl(anvendForslag(p, f)), ['raekke']);
    });
    test('løserens problem: én gruppe pr. række og art — doublerne kun doublerne, rækken alle kampene', () => {
        const p = raekke();
        const pr = bygProblem(p);
        const art = (a) => pr.haltid.find((h) => h.art === a);
        assert.deepEqual(pr.haltid.map((h) => [h.art, h.graense]).sort(), [['double', 240], ['raekke', 300], ['single', 240]]);
        const kategorier = (h) => [...new Set(h.kampe.map((i) => p.kampe.find((k) => k.id === pr.kampe[i].id).kategori))].sort();
        assert.deepEqual(kategorier(art('double')), ['U09 D HD']);
        assert.deepEqual(kategorier(art('raekke')), ['U09 D HD', 'U09 D HS']);
        assert.equal(art('raekke').kampe.length, p.kampe.length);
    });
});

describe('blød målsætning: tid i hallen for U9/U11 — også Swiss-runder', () => {
    test('Swiss-runderne tæller for alle i lodtrækningen, selv om spillerne ikke kendes efter runde 1', () => {
        const p = runder(raekke(), 'U09 D HS', ['09:00', '10:00', '11:00']);
        assert.ok(p.kampe.some((k) => k.kategori === 'U09 D HS' && k.runde === 3 && !k.spillere.length), 'runde 3 har ingen kendte spillere');
        assert.equal(halTid(p), 4 * 2.5, 'a–d: 09:00–11:30');
        assert.equal(scorePlan(p).dele.find((d) => d.id === 'ventetid').vaerdi, 0, 'ventetiden ser kun runde 1');
    });
    test('doublerne lige efter singlerne giver kortere tid i hallen end doublerne om eftermiddagen', () => {
        const singler = runder(raekke(), 'U09 D HS', ['09:00', '09:30', '10:00']);
        const tidligt = runder(singler, 'U09 D HD', ['10:30', '11:00', '11:30']);
        const sent = runder(singler, 'U09 D HD', ['13:30', '14:00', '14:30']);
        assert.equal(halTid(sent) - halTid(tidligt), 4 * 3, 'a–d venter 3 timer længere; e–h spiller kun double');
        assert.equal(VAEGT_SKABELONER.standard.vaegte.halTid, 0.5);
    });
    test('løseren får en gruppe pr. spiller med Swiss-runderne — ens grupper samlet med vægt', () => {
        const p = raekke();
        const pr = bygProblem(p);
        // Runde 2 og 3 (ingen kendte spillere) skal være med i hver singlespillers gruppe
        const senere = p.kampe.filter((k) => k.kategori === 'U09 D HS' && k.runde > 1).map((k) => pr.kampe.findIndex((x) => x.id === k.id));
        assert.equal(pr.halTid.reduce((s, g) => s + g.vaegt, 0), 8, 'a–h');
        assert.equal(pr.halTid.length, 6, 'a, b, c og d har hver deres runde 1-kamp; e+f og g+h spiller ens (kun HD-puljen) og er slået sammen');
        assert.equal(pr.halTid.filter((g) => senere.every((i) => g.kampe.includes(i))).length, 4, 'singlespillernes grupper har Swiss-runderne');
        assert.deepEqual(pr.halTid.map((g) => g.vaegt).sort(), [1, 1, 1, 1, 2, 2]);
        assert.equal(bygProblem(nytProjekt(model([{ id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('x', 4) }] }]))).halTid.length, 0, 'kun U9/U11');
    });
});

describe('kort, diagnose og tekster peger på den rigtige grænse', () => {
    test('kortet for doublerne foreslår at hæve doublernes grænse', () => {
        const p = raekke();
        const g = { noegle: 'haltid|U09 D', familie: 'haltid', raekke: 'U09 D', arter: ['double'], kampe: [], aarsager: new Set(['max-haltid']) };
        const k = kandidater(p, g).find((x) => x.gruppe === 'haltid-double');
        assert.ok(k);
        assert.deepEqual(k.trin.map((t) => t.aendring), [{ maxDoubleMin: 270 }, { maxDoubleMin: 300 }, { maxDoubleMin: 330 }]);
        assert.equal(kandidater(p, g).some((x) => x.gruppe === 'haltid-single'), false);
    });
    test('løserens diagnose og brud pr. art', () => {
        const d = diagnoseTekst([{ regel: 'haltid', raekke: 'U09 D', art: 'raekke', graense: 300, forslag: 360 }]);
        assert.match(d.tekst, /U09 D: max 300 min for alle rækkens kampe kan ikke overholdes — med 360 min/);
        assert.deepEqual(d.handlinger[0].aendring, { maxRaekkeMin: 360 });
        assert.deepEqual(diagnoseTekst([{ regel: 'haltid', raekke: 'U11 D', art: 'double', graense: 180, forslag: null }]).handlinger[0].aendring, { maxDoubleMin: null });
        assert.deepEqual(brudTekster([{ regel: 'haltid', raekke: 'U11 D', art: 'double', graense: 180, maengde: 30 }], { raekker: [] }), ['U11 D: doublekampene varer 30 min længere end grænsen på 180 min']);
    });
});
