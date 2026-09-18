// Tests af "minimum antal kampe tælles samlet" (U9: single + double/mix tilsammen)
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

function projekt(valg) {
    let p = nytProjekt(model(valg));
    for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'auto' });
    return p;
}

describe('min. kampe samlet: hjælpere', () => {
    test('alle årgange tæller samlet som standard; rækkens eget valg vinder', () => {
        assert.equal(minKampeSamlet(u9d), true);
        for (const aargang of ['U11', 'U13', 'U15', 'U17', 'U19', 'SEN']) assert.equal(minKampeSamlet({ aargang, raekke: 'D' }), true, aargang);
        assert.equal(minKampeSamlet({ aargang: 'U09', raekke: 'D', minKampeSamlet: false }), false);
        assert.equal(minKampeSamlet({ aargang: 'U11', raekke: 'D', minKampeSamlet: true }), true);
        assert.equal(nytProjekt(model()).raekker[0].minKampeSamlet, true);
    });
    test('ældre gemte projekter (kun U9 samlet) opgraderes én gang til alle rækker', async () => {
        const { normaliserHalvBane } = await import('../../src/store.js');
        const p = nytProjekt(model());
        const gammelt = { ...p, opsaetning: { ...p.opsaetning, minKampeSamletV2: undefined }, raekker: [{ ...p.raekker[0], id: 'U11 D', aargang: 'U11', minKampeSamlet: false }] };
        const ny = normaliserHalvBane(gammelt);
        assert.equal(ny.raekker[0].minKampeSamlet, true);
        assert.equal(ny.opsaetning.minKampeSamletV2, true);
        const fravalgt = { ...ny, raekker: [{ ...ny.raekker[0], minKampeSamlet: false }] };
        assert.equal(normaliserHalvBane(fravalgt).raekker[0].minKampeSamlet, false, 'brugerens senere fravalg bevares');
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
    test('4 piger alene: ingen form giver 4 singler → under kravet', () => {
        const f = foreslaaForm(4, u9DS, u9d, regler, { form: 'auto', deltagere, samlet: true });
        assert.equal(f.opfylderKrav, false, formTekst(f));
    });
    test('4 piger med mindst 1 sikker doublekamp hver: 3 singler + 1 double = 4 → kravet er nået', () => {
        const andreKampe = new Map(deltagere.map((t) => [t.spillere[0], 1]));
        const f = foreslaaForm(4, u9DS, u9d, regler, { form: 'auto', deltagere, andreKampe, samlet: true });
        assert.equal(f.opfylderKrav, true, formTekst(f));
        assert.equal(f.kravInklAndre, true);
        assert.match(formTekst(f), /nås inkl\. mindst 1 kamp i double\/mix/);
        const uden = foreslaaForm(4, u9DS, u9d, regler, { form: 'auto', deltagere, andreKampe, samlet: false });
        assert.equal(uden.opfylderKrav, false, 'uden samlet tælling hjælper doublerne ikke');
    });
    test('den spiller, der har færrest andre kampe, bestemmer', () => {
        const andreKampe = new Map([['g1', 2], ['g2', 2], ['g3', 2]]); // g4 spiller ikke double
        const f = foreslaaForm(4, u9DS, u9d, regler, { form: 'auto', deltagere, andreKampe, samlet: true });
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
