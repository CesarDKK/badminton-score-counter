// Swiss Ladder i grupper (Jesper 2026-10-12): en stor Swiss deles i grupper efter seedning, hver sin lodtrækning i TP.
// En spiller får stadig én kamp pr. runde, men en gruppes runde kan lodtrækkes, så snart gruppens egne kampe er
// færdige — så kan grupperne spilles hver for sig, og den enkelte er kortere tid i hallen.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { swissGruppeFordeling, maxSwissGrupper, formMuligheder, swissOversiddere } from '../../src/form.js';
import { nytProjekt, saetForm, opdaterDag, anvendForslag, validerProjekt } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { tjekPlan } from '../../src/rules.js';
import { bygProblem } from '../../src/solver-klient.js';
import { byggListe } from '../../src/ui/liste.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

function projekt(n = 20, grupper = 2) {
    let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('s', n) }] }]));
    p = opdaterDag(p, LOER, { baner: 6, start: '09:00', slut: '19:00' });
    return saetForm(p, 'U11 D HS', { formValg: 'swiss', swissRunder: 4, swissGrupper: grupper });
}

describe('fordelingen', () => {
    test('lige store grupper med lige antal — højst én gruppe med ulige antal (én oversidder)', () => {
        assert.deepEqual(swissGruppeFordeling(39, 2), [20, 19]);
        assert.deepEqual(swissGruppeFordeling(39, 3), [14, 12, 13]);
        assert.deepEqual(swissGruppeFordeling(32, 2), [16, 16]);
        assert.deepEqual(swissGruppeFordeling(20, 1), [20]);
        assert.equal(maxSwissGrupper(39), 9, 'mindst 4 i hver gruppe');
        assert.equal(maxSwissGrupper(7), 1);
    });
    test('formen: samme antal kampe pr. spiller (én pr. runde) og samme antal kampe i alt som uden grupper', () => {
        const [uden] = formMuligheder(39, { swissRunder: 5 }).filter((x) => x.form === 'swiss');
        const [med] = formMuligheder(39, { swissRunder: 5, swissGrupper: 2 }).filter((x) => x.form === 'swiss');
        assert.deepEqual(med.grupper, [20, 19]);
        assert.equal(med.kampe, uden.kampe);
        assert.deepEqual([med.minKampe, med.maxKampe], [4, 5], 'gruppen á 19 har en oversidder pr. runde');
        assert.match(med.tekst, /i 2 grupper \(A: 20, B: 19\), 5 runder á 19 kampe \(én oversidder pr. runde\)/);
        // Tre ulige grupper ville give tre oversiddere — fordelingen undgår det
        const [tre] = formMuligheder(39, { swissRunder: 5, swissGrupper: 3 }).filter((x) => x.form === 'swiss');
        assert.match(tre.tekst, /én oversidder/);
        assert.equal(formMuligheder(39, { swissRunder: 5, swissGrupper: 1 }).find((x) => x.form === 'swiss').grupper, undefined);
    });
    test('for mange grupper begrænses, så hver gruppe har mindst 4', () => {
        const [f] = formMuligheder(10, { swissRunder: 3, swissGrupper: 6 }).filter((x) => x.form === 'swiss');
        assert.deepEqual(f.grupper, [6, 4]);
    });
});

describe('kampene', () => {
    test('én Swiss Ladder pr. gruppe: egen lodtrækning, gruppe A = de bedst seedede, runderne bygger kun på gruppens egne', () => {
        const p = projekt(20, 2);
        const kampe = p.kampe.filter((k) => k.kategori === 'U11 D HS');
        const draws = [...new Set(kampe.map((k) => k.tpRef.draw))];
        assert.equal(draws.length, 2);
        assert.equal(kampe.length, 2 * 4 * 5, '2 grupper á 10: 5 kampe pr. runde, 4 runder');
        const A = kampe.filter((k) => k.gruppe === 'U11 D HS gruppe A');
        const B = kampe.filter((k) => k.gruppe === 'U11 D HS gruppe B');
        const spillereA = new Set(A.flatMap((k) => k.muligeSpillere));
        const spillereB = new Set(B.flatMap((k) => k.muligeSpillere));
        assert.equal(spillereA.size, 10);
        assert.equal([...spillereA].filter((s) => spillereB.has(s)).length, 0, 'ingen spiller i begge grupper');
        const idsA = new Set(A.map((k) => k.id));
        assert.ok(A.every((k) => k.afhaengerAf.every((d) => idsA.has(d))), 'gruppe A venter kun på sine egne runder');
        assert.equal(A.find((k) => k.runde === 1).navn, 'U11 D HS gruppe A runde 1: #1 – #6');
    });
    test('uden grupper er kampene som før (samme id\'er og lodtrækning)', () => {
        const p = projekt(20, 1);
        assert.deepEqual([...new Set(p.kampe.map((k) => k.tpRef.draw))], ['g:U11 D HS:swiss']);
        assert.ok(p.kampe.some((k) => k.id === 'g:U11 D HS:r2:1'));
    });
    test('oversiddere tælles pr. gruppe', () => {
        const p = projekt(21, 2);
        assert.equal(swissOversiddere(p.kategorier[0]), 4, 'én gruppe á 11: én oversidder i hver af de 4 runder');
        assert.equal(validerProjekt(p), null);
        assert.match(validerProjekt({ ...p, kategorier: [{ ...p.kategorier[0], swissGrupper: 'to' }] }), /tal for U11 D HS/);
    });
});

describe('planlægning', () => {
    test('grupperne kan spille samtidig og hver for sig — forslaget har ingen fejl i Tjek', () => {
        const p = projekt(20, 2);
        const f = lavForslag(p);
        assert.equal(f.ikkePlaceret.length, 0);
        assert.deepEqual(tjekPlan(anvendForslag(p, f)).problemer.filter((x) => x.alvor === 'fejl').map((x) => x.tekst), []);
    });
    test('løseren får en Swiss-gruppe pr. lodtrækning — kun gruppens egne spillere', () => {
        const pr = bygProblem(projekt(20, 2));
        const swissVent = pr.spillerGrupper.filter((g) => g.vaegt === 10);
        assert.equal(swissVent.length, 2, 'én ventetidsgruppe pr. Swiss-gruppe á 10 spillere');
    });
    test('"Til TP" holder gruppernes runder adskilt, når TP-filen har en lodtrækning pr. gruppe', () => {
        // Som TP-filen ser ud, når lodtrækningen er lavet i TP: kampene er TP's (formValg "fra TP")
        const p = projekt(20, 2);
        const tp = { ...p, kategorier: p.kategorier.map((k) => ({ ...k, formValg: 'tp' })) };
        const liste = byggListe(anvendForslag(tp, lavForslag(tp)));
        const navne = liste.find((x) => x.kategori === 'U11 D HS').grupper.map((g) => g.navn);
        assert.deepEqual(navne.slice(0, 5), ['U11 D HS gruppe A — runde 1', 'U11 D HS gruppe A — runde 2', 'U11 D HS gruppe A — runde 3', 'U11 D HS gruppe A — runde 4', 'U11 D HS gruppe B — runde 1']);
    });
});

describe('kortene foreslår grupper, når en stor Swiss ikke går op (Jesper 2026-10-12)', async () => {
    const { kandidater, anvendAendring, PRIS } = await import('../../src/kampprogram.js');
    const kort = (raekke) => ({ noegle: `plads|${raekke}`, familie: 'plads', raekke, kampe: [], aarsager: new Set(['ingen ledig bane']) });
    test('"grupper" står før "færre runder" i prisrækkefølgen — ingen mister kampe', () => {
        const ids = PRIS.map((x) => x.id);
        assert.ok(ids.indexOf('grupper') < ids.indexOf('runder'));
    });
    test('en Swiss fra TP\'s lodtrækning (én stor) foreslås delt — samme antal runder, ny lodtrækning i TP', () => {
        const p0 = projekt(20, 1);
        // Som fra TP-filen: kategorien følger TP, og TP's form er én Swiss Ladder med 4 runder
        const p = { ...p0, kategorier: p0.kategorier.map((k) => ({ ...k, formValg: 'tp', form: 'swiss', runder: 4, tilmelde: 20 })) };
        const k = kandidater(p, kort('U11 D')).find((x) => x.gruppe === 'grupper');
        assert.ok(k, 'forslaget findes');
        assert.match(k.trin[0].tekst, /Del Swiss Ladder i grupper: U11 D HS \(10 \+ 10\) — ny lodtrækning i TP/);
        assert.deepEqual(k.trin[0].aendringer, [{ kategori: 'U11 D HS', aendring: { formValg: 'swiss', swissGrupper: 2, swissRunder: 4 } }]);
        assert.equal(k.trin[0].pris, 'grupper');
    });
    test('ændringen bygger grupperne, og en allerede delt Swiss foreslås ikke igen', () => {
        const p = projekt(20, 1);
        const k = kandidater(p, kort('U11 D')).find((x) => x.gruppe === 'grupper');
        const q = anvendAendring(p, k.trin[0]);
        assert.equal(new Set(q.kampe.map((x) => x.tpRef.draw)).size, 2);
        assert.equal(kandidater(q, kort('U11 D')).some((x) => x.gruppe === 'grupper'), false);
    });
    test('grupperne skal kunne spille alle runderne mod nye modstandere — ellers færre grupper', () => {
        // 10 spillere med 5 runder: 2 grupper á 5 kan kun spille 4 runder → intet forslag
        const p = saetForm(projekt(10, 1), 'U11 D HS', { swissRunder: 5 });
        assert.equal(kandidater(p, kort('U11 D')).some((x) => x.gruppe === 'grupper'), false);
    });
});
