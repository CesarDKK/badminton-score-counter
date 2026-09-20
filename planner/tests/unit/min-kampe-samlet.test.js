// Tests af "minimum antal kampe tælles samlet" (single + double/mix tilsammen) — et bevidst TILVALG pr. række.
// Standarden er reglementets: kravet gælder pr. kategori (Appendiks 1 og U9/U11-vejledningen).
// i form.js (valg af form), store.js (genberegning) og rules.js (advarslen i Tjek).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { foreslaaForm, formTekst, minKampeSamlet, sikreKampe, effektivForm } from '../../src/form.js';
import { STANDARD_REGLER, nytProjekt, saetForm, opdaterRaekke, genberegnKampe } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';

const regler = STANDARD_REGLER;
const u9d = { id: 'U09 D', aargang: 'U09', raekke: 'D' };
const u9DS = { id: 'U09 D DS', kat: 'DS', type: 'single', halvBane: true };

/** 4 piger i single og double (2 par), og 6 drenge kun i single. */
function model({ pigerIDouble = true } = {}) {
    const sp = (id, koen) => [id, { id, fornavn: id, efternavn: 'X', koen, foedt: null, klub: 'K', memberid: null, niveau: {}, point: {} }];
    const piger = ['g1', 'g2', 'g3', 'g4'], drenge = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
    const kat = (id, k, type) => ({ id, eventId: 1, raekke: 'U09 D', aargang: 'U09', kat: k, type, mix: false, form: 'ingen lodtrækning', tilmeldte: 0, kampe: 0, runder: 0, halvBane: type === 'single' });
    return {
        version: 1, kilde: { filnavn: 't.tp', laestUtc: '', tpVersion: null },
        turnering: { navn: 'T', hal: '', dage: ['2026-11-21'] },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 6, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: [{ id: 'U09 D', aargang: 'U09', raekke: 'D', pauseKlasse: 'ABCD', kategorier: ['U09 D DS', 'U09 D HS', 'U09 D DD'] }],
        kategorier: [kat('U09 D DS', 'DS', 'single'), kat('U09 D HS', 'HS', 'single'), kat('U09 D DD', 'DD', 'double')],
        spillere: Object.fromEntries([...piger.map((id) => sp(id, 'D')), ...drenge.map((id) => sp(id, 'H'))]),
        kampe: [],
        tilmeldinger: {
            'U09 D DS': piger.map((id, i) => ({ entry: i + 1, spillere: [id] })),
            'U09 D HS': drenge.map((id, i) => ({ entry: 10 + i, spillere: [id] })),
            'U09 D DD': pigerIDouble ? [{ entry: 20, spillere: ['g1', 'g2'] }, { entry: 21, spillere: ['g3', 'g4'] }, { entry: 22, spillere: ['d1', 'd2'] }] : [],
        },
        bemaerkninger: [],
    };
}

/** Pigesinglen som Swiss Ladder (4 spillere → højst 3 runder, så kravet på 4 kun nås via doublen); resten automatisk. */
function projekt(valg) {
    let p = opdaterRaekke(nytProjekt(model(valg)), 'U09 D', { minKampeSamlet: true }); // tilvalgt i disse tests
    for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: k.id === 'U09 D DS' ? 'swiss' : 'auto' });
    return p;
}

describe('min. kampe samlet: hjælpere', () => {
    test('standarden er reglementets: kravet gælder pr. kategori i alle årgange; samlet tælling er et tilvalg', () => {
        for (const aargang of ['U09', 'U11', 'U13', 'U15', 'U17', 'U19', 'SEN']) assert.equal(minKampeSamlet({ aargang, raekke: 'D' }), false, aargang);
        assert.equal(minKampeSamlet({ aargang: 'U09', raekke: 'D', minKampeSamlet: true }), true);
        assert.equal(nytProjekt(model()).raekker[0].minKampeSamlet, false);
    });
    test('standard: 4 piger i Swiss Ladder når ikke single-kravet på 4, selv om de også spiller double', () => {
        let p = nytProjekt(model());
        for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: k.id === 'U09 D DS' ? 'swiss' : 'auto' });
        assert.equal(p.kategorier.find((k) => k.id === 'U09 D DS').formForslag.opfylderKrav, false);
        const a = tjekPlan(p).problemer.find((x) => (x.noegle || '') === 'U09 D DS:min-kampe');
        assert.ok(a, 'Tjek advarer');
        assert.doesNotMatch(a.tekst, /i alt/);
    });
    test('ældre gemte projekter (samlet tælling slået til af tidligere udgaver) sættes én gang tilbage til reglementet', async () => {
        const { normaliserHalvBane } = await import('../../src/store.js');
        const p = nytProjekt(model());
        const gammelt = { ...p, opsaetning: { ...p.opsaetning, minKampeSamletV3: undefined, minKampeSamletV2: true }, raekker: [{ ...p.raekker[0], minKampeSamlet: true }] };
        const ny = normaliserHalvBane(gammelt);
        assert.equal(ny.raekker[0].minKampeSamlet, false);
        assert.equal(ny.opsaetning.minKampeSamletV3, true);
        const tilvalgt = { ...ny, raekker: [{ ...ny.raekker[0], minKampeSamlet: true }] };
        assert.equal(normaliserHalvBane(tilvalgt).raekker[0].minKampeSamlet, true, 'brugerens senere tilvalg bevares');
    });
    test('effektivForm og sikreKampe: plannerens egen Swiss tæller runder, ikke kun runde 1', () => {
        const k = { id: 'X', form: 'dobbelt-pulje', runder: 0, formValg: 'auto', formForslag: { form: 'swiss', runder: 4, minKampe: 4 } };
        assert.equal(effektivForm(k).form, 'swiss');
        assert.equal(effektivForm({ ...k, formValg: 'tp' }).form, 'dobbelt-pulje');
        const kampe = [{ fase: 'swiss', spillere: ['a', 'b'], muligeSpillere: ['a', 'b'] }, { fase: 'swiss', spillere: [], muligeSpillere: ['a', 'b', 'c', 'd'] }];
        assert.deepEqual([...sikreKampe(k, kampe)].sort(), [['a', 4], ['b', 4], ['c', 4], ['d', 4]]);
    });
});

describe('min. kampe samlet: valg af form', () => {
    const deltagere = ['g1', 'g2', 'g3', 'g4'].map((id) => ({ spillere: [id] }));
    test('4 piger alene: Swiss Ladder kan ikke give 4 singler → under kravet (automatisk ville vælge dobbelt pulje)', () => {
        const f = foreslaaForm(4, u9DS, u9d, regler, { form: 'swiss', deltagere, samlet: true });
        assert.equal(f.opfylderKrav, false, formTekst(f));
        assert.equal(foreslaaForm(4, u9DS, u9d, regler, { form: 'auto', deltagere, samlet: true }).form, 'dobbelt-pulje');
    });
    test('4 piger med mindst 1 sikker doublekamp hver: 3 singler + 1 double = 4 → kravet er nået', () => {
        const andreKampe = new Map(deltagere.map((t) => [t.spillere[0], 1]));
        const f = foreslaaForm(4, u9DS, u9d, regler, { form: 'auto', deltagere, andreKampe, samlet: true });
        assert.equal(f.opfylderKrav, true, formTekst(f));
        assert.equal(f.form, 'pulje', 'en enkelt pulje er nok, når doublen tæller med — billigere end dobbelt pulje');
        assert.equal(f.kravInklAndre, true);
        assert.match(formTekst(f), /nås inkl\. mindst 1 kamp i double\/mix/);
        const uden = foreslaaForm(4, u9DS, u9d, regler, { form: 'auto', deltagere, andreKampe, samlet: false });
        assert.equal(uden.form, 'dobbelt-pulje', 'uden samlet tælling hjælper doublerne ikke — så skal der dobbelt pulje til');
    });
    test('den spiller, der har færrest andre kampe, bestemmer', () => {
        const andreKampe = new Map([['g1', 2], ['g2', 2], ['g3', 2]]); // g4 spiller ikke double
        const f = foreslaaForm(4, u9DS, u9d, regler, { form: 'swiss', deltagere, andreKampe, samlet: true });
        assert.equal(f.opfylderKrav, false);
    });
});

describe('min. kampe samlet: i projektet og i Tjek', () => {
    const minAdvarsler = (p) => tjekPlan(p).problemer.filter((x) => (x.noegle || '').endsWith(':min-kampe'));
    test('pigerne når kravet med single + double, og Tjek advarer ikke', () => {
        const p = projekt();
        const ds = p.kategorier.find((k) => k.id === 'U09 D DS');
        assert.equal(ds.formForslag.opfylderKrav, true, formTekst(ds.formForslag));
        assert.deepEqual(minAdvarsler(p).filter((x) => x.noegle.startsWith('U09 D DS')), []);
    });
    test('slås samlet tælling fra, er pigesinglen under kravet, og Tjek siger det', () => {
        const p = genberegnKampe(opdaterRaekke(projekt(), 'U09 D', { minKampeSamlet: false }));
        const ds = p.kategorier.find((k) => k.id === 'U09 D DS');
        assert.equal(ds.formForslag.opfylderKrav, false);
        const a = minAdvarsler(p).find((x) => x.noegle.startsWith('U09 D DS'));
        assert.ok(a, 'advarsel om for få kampe');
        assert.doesNotMatch(a.tekst, /i alt/);
        assert.match(a.tekst, /Vælg en anden form i fane 1/);
    });
    test('uden doubler: advarslen nævner, at der er talt samlet', () => {
        const p = projekt({ pigerIDouble: false });
        const a = minAdvarsler(p).find((x) => x.noegle.startsWith('U09 D DS'));
        assert.ok(a);
        assert.match(a.tekst, /i alt \(single \+ double\/mix\)/);
    });
    test('drengene, der kun spiller single, får stadig 4 singler — doublerne til to af dem ændrer ikke kategorien', () => {
        const p = projekt();
        const hs = p.kategorier.find((k) => k.id === 'U09 D HS');
        assert.ok(hs.formForslag.minKampe >= 4, formTekst(hs.formForslag));
        assert.equal(hs.formForslag.kravInklAndre, undefined);
    });
    test('plannerens egen Swiss Ladder giver ikke falsk advarsel om 1 sikker kamp', () => {
        let p = nytProjekt(model());
        p = saetForm(p, 'U09 D HS', { formValg: 'swiss' });
        const hs = p.kategorier.find((k) => k.id === 'U09 D HS');
        assert.equal(hs.formForslag.form, 'swiss');
        assert.deepEqual(minAdvarsler(p).filter((x) => x.noegle.startsWith('U09 D HS')), []);
    });
});
