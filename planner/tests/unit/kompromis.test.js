// Kompromiser undervejs (Jesper 2026-10-17): det, der er givet efter for at få programmet til at gå op, skal kunne
// trækkes tilbage, så løseren kan prøve igen.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, opdaterOpsaetning, saetSlotMin, genberegnKampe } from '../../src/store.js';
import { kompromiser, udenKompromiser } from '../../src/kompromis.js';
import { anvendAendring } from '../../src/kampprogram.js';
import { INGEN_PAUSE, reglerFor } from '../../src/regler.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

function foer() {
    let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 20) }] }], [LOER]));
    p = opdaterDag(p, LOER, { baner: 4, start: '09:00', slut: '17:00', foerSkoledag: false });
    return saetForm(p, 'U11 D HS', { formValg: 'swiss' });
}
const ider = (liste) => liste.map((k) => k.id).sort();

describe('kompromiserne findes ved at sammenligne med opsætningen fra før "Lav kampprogram"', () => {
    test('ingen ændringer: ingen kompromiser', () => {
        assert.deepEqual(kompromiser(foer(), foer()), []);
    });
    test('kamplængde, pause på dagen, længere dag, tidsrum, dispensation, grupper og færre runder', () => {
        const a = foer();
        let b = genberegnKampe(opdaterOpsaetning(saetSlotMin(a, 20), { pauseMin: { ...INGEN_PAUSE } }));
        b = opdaterDag(b, LOER, { slut: '18:00' });
        b = opdaterRaekke(b, 'U11 D', { senest: '16:30', maxHaltidMin: 420 });
        b = anvendAendring(b, { type: 'tidsvindue', aargang: 'U11', vindue: ['09:00', '19:25'] });
        b = saetForm(b, 'U11 D HS', { swissGrupper: 2, swissRunder: 3 }); // 3 runder: færre end de 4, planneren valgte
        const k = kompromiser(a, b);
        assert.deepEqual(ider(k), ['dag|2026-11-21|slut', 'kategori|U11 D HS|swissGrupper', 'kategori|U11 D HS|swissRunder', 'pauseMin', 'raekke|U11 D|maxHaltidMin', 'raekke|U11 D|senest', 'slotMin', 'tidsvindue|U11'].sort());
        const tekst = Object.fromEntries(k.map((x) => [x.id, x.tekst]));
        // Teksten står ud for et flueben og siger, hvad der sker, hvis man sætter det (Jesper 2026-10-17)
        assert.equal(tekst.slotMin, 'Tilbage til 30 min kampe (nu 20 min)');
        assert.equal(tekst.pauseMin, 'Pausen tilbage i planen (nu gives den på dagen)');
        assert.equal(tekst['dag|2026-11-21|slut'], '21/11: dagen slutter igen 17:00 (nu 18:00)');
        assert.equal(tekst['raekke|U11 D|maxHaltidMin'], 'U11 D: max 360 min for singler igen (nu 420 min)');
        assert.equal(tekst['raekke|U11 D|senest'], 'U11 D spiller igen senest til dagens slut (nu 16:30)');
        assert.equal(tekst['kategori|U11 D HS|swissGrupper'], 'U11 D HS som én Swiss Ladder igen (nu 2 grupper)');
        assert.equal(tekst['kategori|U11 D HS|swissRunder'], 'U11 D HS: automatisk antal runder igen (nu 3)');
        assert.equal(tekst['tidsvindue|U11'], "U11's tidsvindue tilbage til 09:00–19:00 (nu 09:00–19:25, kræver dispensation)");
    });
});

describe('de valgte trækkes tilbage — resten bliver stående', () => {
    test('kamplængden og pausen tilbage, den længere dag bliver', () => {
        const a = foer();
        let b = genberegnKampe(opdaterOpsaetning(saetSlotMin(a, 20), { pauseMin: { ...INGEN_PAUSE } }));
        b = opdaterDag(b, LOER, { slut: '18:00' });
        const valgte = kompromiser(a, b).filter((k) => ['slotMin', 'pauseMin'].includes(k.id));
        const c = udenKompromiser(b, valgte);
        assert.equal(c.opsaetning.slotMin, a.opsaetning.slotMin);
        assert.deepEqual(c.opsaetning.pauseMin, a.opsaetning.pauseMin);
        assert.equal(c.opsaetning.dage[0].slut, '18:00');
        assert.deepEqual(ider(kompromiser(a, c)), ['dag|2026-11-21|slut']);
    });
    test('grupper og tidsvindue tilbage: kampene bygges igen som én Swiss, vinduet som reglementet', () => {
        const a = foer();
        let b = saetForm(a, 'U11 D HS', { swissGrupper: 2 });
        b = anvendAendring(b, { type: 'tidsvindue', aargang: 'U11', vindue: ['09:00', '19:25'] });
        assert.equal(new Set(b.kampe.map((k) => k.tpRef.draw)).size, 2);
        const c = udenKompromiser(b, kompromiser(a, b));
        assert.equal(new Set(c.kampe.map((k) => k.tpRef.draw)).size, 1);
        assert.deepEqual(reglerFor(c).tidsvindue.U11, reglerFor(a).tidsvindue.U11, 'reglementets vindue');
        assert.deepEqual(kompromiser(a, c), []);
    });
});
