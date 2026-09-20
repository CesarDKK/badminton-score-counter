// Pakke 2: løserens diagnose kan også pege på rækkens tidsrum og rækkens dage (som løseren holder hårdt,
// mens Tjek kun advarer) — i stedet for misvisende at sige "ikke plads".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke } from '../../src/store.js';
import { bygProblem, diagnoseTekst } from '../../src/solver-klient.js';
import { model } from '../hjaelp/model.js';

const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
function projekt() {
    let p = nytProjekt(model([
        { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 4) }] },
        { id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 4) }] },
    ], ['2026-11-21', '2026-11-22']));
    for (const d of p.opsaetning.dage) p = opdaterDag(p, d.dato, { baner: 2, start: '09:00', slut: '18:00' });
    for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'pulje' });
    return p;
}

describe('løserens problem: bredere tilladte tider til diagnosen', () => {
    test('en række med eget tidsrum får alternativet "tidsrum" med flere tider end de tilladte', () => {
        const p = opdaterRaekke(projekt(), 'U11 D', { tidligst: '12:00', senest: '14:00' });
        const pr = bygProblem(p);
        const alt = pr.alternativer.find((a) => a.regel === 'tidsrum' && a.raekke === 'U11 D');
        assert.ok(alt);
        const egne = pr.kampe.map((k, i) => (k.raekke === 'U11 D' ? i : -1)).filter((i) => i >= 0);
        assert.deepEqual(alt.kampe, egne);
        assert.ok(alt.tilladte.length > pr.kampe[egne[0]].tilladte.length);
        assert.ok(pr.kampe[egne[0]].tilladte.every((t) => alt.tilladte.includes(t)), 'de tilladte tider er en delmængde');
        assert.equal(pr.alternativer.some((a) => a.regel === 'tidsrum' && a.raekke === 'U09 D'), false, 'U09 D har intet tidsrum');
    });
    test('en række, der kun må spille nogle af dagene, får alternativet "dage"', () => {
        const pr = bygProblem(opdaterRaekke(projekt(), 'U11 D', { dage: ['2026-11-21'] }));
        const alt = pr.alternativer.find((a) => a.regel === 'dage' && a.raekke === 'U11 D');
        assert.ok(alt.tilladte.some((t) => t >= 1440), 'også søndagens tider');
        assert.equal(pr.alternativer.some((a) => a.regel === 'dage' && a.raekke === 'U09 D'), false, 'U09 D må allerede spille alle dage');
    });
    test('rækker med reserverede baner er ikke med (deres egne baner findes kun i tidsrummet)', () => {
        const pr = bygProblem(opdaterRaekke(projekt(), 'U09 D', { dage: ['2026-11-21'], tidligst: '12:00', senest: '15:00', reserveredeBaner: 1 }));
        assert.equal(pr.alternativer.some((a) => a.raekke === 'U09 D'), false);
    });
    test('ingen særlige indstillinger → ingen alternativer', () => {
        assert.deepEqual(bygProblem(projekt()).alternativer, []);
    });
});

describe('diagnoseTekst: tidsrum og dage', () => {
    test('tekst og handling, der retter rækken', () => {
        const d = diagnoseTekst([{ regel: 'tidsrum', raekke: 'U11 D' }, { regel: 'dage', raekke: 'U11 C' }], ['2026-11-21', '2026-11-22']);
        assert.match(d.tekst, /U11 D: rækkens eget tidsrum er for snævert/);
        assert.match(d.tekst, /U11 C: kampene kan ikke være på de dage/);
        assert.deepEqual(d.handlinger.map((h) => [h.raekke, h.aendring]), [['U11 D', { tidligst: null, senest: null }], ['U11 C', { dage: ['2026-11-21', '2026-11-22'] }]]);
    });
    test('"plads" nævner, at rækkernes tidsrum og dage også er undersøgt', () => {
        assert.match(diagnoseTekst([{ regel: 'plads' }]).tekst, /en enkelt rækkes tidsrum eller dage/);
    });
});
