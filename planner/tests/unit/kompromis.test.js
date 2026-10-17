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

describe('kamplængden kan gå et mellemtrin tilbage (Jesper 2026-10-17: "hvorfor ikke 25?")', () => {
    test('20 min nu, 30 før: valget er 25 og 30 — og 25 sættes, når det vælges', () => {
        const a = foer();
        const b = genberegnKampe(saetSlotMin(a, 20));
        const k = kompromiser(a, b).find((x) => x.id === 'slotMin');
        assert.deepEqual(k.valg, [25, 30]);
        assert.equal(udenKompromiser(b, [{ ...k, foer: 25 }]).opsaetning.slotMin, 25);
        assert.equal(udenKompromiser(b, [k]).opsaetning.slotMin, 30, 'standard: som før');
    });
});

describe('gennemgangen 2026-10-17, pakke 1: låste kampe og middelvejen i prøven', async () => {
    const { laasteUdenForGitter } = await import('../../src/kompromis.js');
    const { flytKamp, laasKamp } = await import('../../src/store.js');
    test('en låst kamp kl. 9:20 passer ikke i 30-min-gitteret — 30 tilbydes ikke, 25 heller ikke, kun det, der passer', () => {
        const a = foer();
        let b = genberegnKampe(saetSlotMin(a, 20));
        const id = b.kampe[0].id;
        b = laasKamp(flytKamp(b, id, '2026-11-21', '09:20'), id, true);
        assert.equal(laasteUdenForGitter(b, 30), 1);
        assert.equal(laasteUdenForGitter(b, 20), 0);
        const k = kompromiser(a, b).find((x) => x.id === 'slotMin');
        assert.equal(k.blokeret, true, '25 og 30: kl. 9:20 findes ikke');
        assert.match(k.tekst, /kræver, at 1 låst kamp låses op/);
    });
    test('en låst kamp kl. 10:00 passer i 30 men ikke 25: kun 30 tilbydes', () => {
        const a = foer();
        let b = genberegnKampe(saetSlotMin(a, 20));
        const id = b.kampe[0].id;
        b = laasKamp(flytKamp(b, id, '2026-11-21', '10:00'), id, true);
        const k = kompromiser(a, b).find((x) => x.id === 'slotMin');
        assert.deepEqual(k.valg, [30]);
        assert.equal(k.foer, 30);
    });
    test('trækkes kamplængden eller pausen tilbage, prøves U9/U11 uden middelvejens ekstra kampe', () => {
        const a = foer();
        const b = { ...genberegnKampe(saetSlotMin(a, 20)), kategorier: a.kategorier.map((k) => ({ ...k, middelvej: true })) };
        const k = kompromiser(a, b).find((x) => x.id === 'slotMin');
        const c = udenKompromiser(b, [k]);
        assert.ok(c.kategorier.every((x) => !x.middelvej));
    });
});

describe('diagnosens "flere" nævner rækkernes tidsrum og dage', async () => {
    const { diagnoseTekst } = await import('../../src/solver-klient.js');
    test('teksten', () => {
        assert.match(diagnoseTekst([{ regel: 'flere' }]).tekst, /rækkernes tidsrum og dage/);
    });
});

describe('programmerne uden kompromiserne (Jesper 2026-10-17: planer, der er tæt på, og som kan vælges)', async () => {
    const { variantValg, lavVarianter } = await import('../../src/kompromis.js');
    const efter = () => genberegnKampe(opdaterOpsaetning(saetSlotMin(foer(), 20), { pauseMin: { ...INGEN_PAUSE } }));
    test('én række pr. kompromis, hvert trin for kamplængden og "Alt som før"', () => {
        const tekster = variantValg(foer(), efter()).map((x) => x.tekst);
        assert.deepEqual(tekster, ['Kampe på 25 min (nu 20 min)', 'Kampe på 30 min som før (nu 20 min)', 'Pausen tilbage i planen (nu gives den på dagen)', 'Alt som før']);
    });
    test('planlæggeren laver hvert program: fejl, sluttid, tid i hallen — og projektet, der kan tages i brug', () => {
        const liste = lavVarianter(foer(), efter());
        assert.ok(liste.length >= 4);
        for (const v of liste) {
            assert.equal(typeof v.fejl, 'number');
            assert.ok(v.slut['2026-11-21'], 'sluttid for dagen');
            assert.ok(v.haltidGnsMin > 0);
            assert.ok(Object.keys(v.projekt.plan).length > 0, 'programmet har tider');
        }
        // Rækkefølgen: færrest fejl først
        assert.deepEqual(liste.map((v) => v.fejl), [...liste.map((v) => v.fejl)].sort((a, b) => a - b));
        // "Kampe på 30 min som før" har 30 min og pausen på dagen; "Alt som før" også reglementets pause
        const tredive = liste.find((v) => v.tekst.startsWith('Kampe på 30'));
        assert.equal(tredive.projekt.opsaetning.slotMin, 30);
        const alt = liste.find((v) => v.tekst === 'Alt som før');
        assert.equal(alt.projekt.opsaetning.slotMin, 30);
        assert.deepEqual(alt.projekt.opsaetning.pauseMin, foer().opsaetning.pauseMin);
    });
    test('går to kompromiser hver for sig op, prøves de sammen', () => {
        // Dagen er så lang, at alt går op: begge kompromiser kan trækkes tilbage hver for sig — og sammen
        const a = opdaterDag(foer(), LOER, { slut: '21:00' });
        const b = genberegnKampe(opdaterOpsaetning(saetSlotMin(a, 25), { pauseMin: { ...INGEN_PAUSE } }));
        const liste = lavVarianter(a, b);
        const op = liste.filter((v) => !v.fejl && !v.udenTid).map((v) => v.tekst);
        assert.ok(op.some((t) => t.includes(' + ')) || op.includes('Alt som før'), `kombinationen findes: ${op.join(' | ')}`);
    });
});
