// Gennemgangen 2026-10-11, pakke B: førstegangsbrugeren og "Til TP" — tidsgitteret i TP, kategorier der afventer
// lodtrækningen i TP, dagenes betydning pr. række og panelets nye knapper. (Løseren i trin 4, fortryd og ændringer
// under beregning bor i app.js og afprøves i browseren.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, flytKamp, laasKamp } from '../../src/store.js';
import { byggListe, listeSomTekst, tidsgitterBesked, AFVENTER_TEKST } from '../../src/ui/liste.js';
import { raekkePanel } from '../../src/ui/opsaetning.js';
import { kampprogramPanel } from '../../src/ui/plan.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21', SOEN = '2026-11-22';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

function projekt() {
    let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 4) }] }], [LOER, SOEN]));
    for (const d of [LOER, SOEN]) p = opdaterDag(p, d, { baner: 4, start: '09:00', slut: '18:00' });
    return opdaterRaekke(p, 'U11 D', { dage: [LOER, SOEN] });
}

describe('A1: TP\'s tidsgitter skal passe til kamplængden', () => {
    test('25 min i planen og 30 i filen → besked øverst i listen og i den kopierede tekst', () => {
        const p = { ...projekt(), tpGitter: { ...projekt().tpGitter, slotMin: 30 }, opsaetning: { ...projekt().opsaetning, slotMin: 25 } };
        assert.match(tidsgitterBesked(p), /25 min .*30 min/);
        assert.match(listeSomTekst(p), /^OBS: Sæt tidsintervallet i TP til 25 min/);
        assert.equal(tidsgitterBesked({ ...p, opsaetning: { ...p.opsaetning, slotMin: 30 } }), '');
    });
});

describe('U2/A2: kategorier, planneren selv bygger, afventer lodtrækningen i TP', () => {
    test('ingen tider i listen eller den kopierede tekst — kun en besked', () => {
        const p = saetForm(projekt(), 'U11 D HS', { formValg: 'pulje' });
        const kat = byggListe(p).find((k) => k.kategori === 'U11 D HS');
        assert.equal(kat.afventer, true);
        assert.equal(kat.grupper.length, 0);
        const tekst = listeSomTekst(p);
        assert.ok(tekst.includes(AFVENTER_TEKST));
        assert.doesNotMatch(tekst, /#1 – #2/);
    });
});

describe('A3: hvad dagene betyder for rækken', () => {
    test('D-række med to dage: "spiller én af dagene — planneren vælger", og dagen, programmet bruger', () => {
        let p = saetForm(projekt(), 'U11 D HS', { formValg: 'pulje' });
        assert.match(raekkePanel(p), /Spiller én af dagene — planneren vælger\./);
        for (const k of p.kampe) p = flytKamp(p, k.id, LOER, '10:00');
        assert.match(raekkePanel(p), /planneren vælger: lagt på lør\. 21\/11/);
        assert.match(raekkePanel(opdaterRaekke(p, 'U11 D', { dispensationFlereDage: true })), /Fordeles på de valgte dage/);
    });
});

describe('Panelet: tilbud fra løseren, videre til TP, låste kampe', () => {
    const p = projekt();
    const kp = { projekt: p, foer: p, valg: { grund: 'fast', minutter: 30, udenPause: false }, beslutninger: { kort: [], brud: 0 }, udfoert: [], beholdt: [] };
    test('går programmet op: "Videre til Til TP"', () => {
        assert.match(kampprogramPanel(kp, [], p), /data-handling="til-tp"/);
    });
    test('løserens forbedring, mens man var i Til TP, er et tilbud', () => {
        assert.match(kampprogramPanel({ ...kp, tilbud: { plan: {}, tekst: 'Løseren fandt et bedre program' } }, [], p), /data-handling="kp-tilbud"/);
    });
    test('låste kampe nævnes', () => {
        const m = saetForm(p, 'U11 D HS', { formValg: 'pulje' });
        const id = m.kampe[0].id;
        const q = laasKamp(flytKamp(m, id, LOER, '10:00'), id, true);
        assert.match(kampprogramPanel({ ...kp, projekt: q }, [], q), /1 kamp er låst og beholder sin tid/);
    });
});
