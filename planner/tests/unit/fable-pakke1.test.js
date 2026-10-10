// Fable-gennemgangen 2026-10-10, første pakke: overløb på fælles baner (K1), panelet overlever små rettelser (V5)
// og "kræver dispensation" først, når rækken faktisk ligger på flere dage (V7). K1 dækkes også af kontrakt-testen.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { banebrugISlot } from '../../src/kapacitet.js';
import { panelGaelder } from '../../src/kampprogram.js';
import { raekkePanel } from '../../src/ui/opsaetning.js';
import { nytProjekt, opdaterDag, opdaterRaekke, flytKamp, laasKamp, kvitter, saetForm } from '../../src/store.js';
import { model } from '../hjaelp/model.js';

describe('K1: overløb tælles i halve baner, som i løseren', () => {
    const kap = { faelles: 1, reserveret: new Map([['U09 D', 1]]) };
    const u9 = { raekkeId: 'U09 D', halv: true };
    test('en halv kamp, der løber over, deler en fælles bane med en anden halv kamp', () => {
        const b = banebrugISlot([u9, u9, u9, { raekkeId: 'U09 C', halv: true }], kap);
        assert.equal(b.faellesBrugt, 1);
        assert.equal(b.forMange, false);
        assert.equal(b.overloeb.get('U09 D'), 1);
    });
    test('hele kampe fylder stadig en hel bane', () => {
        assert.equal(banebrugISlot([u9, u9, u9, { raekkeId: 'U11 D', halv: false }], kap).forMange, true);
    });
});

function projekt() {
    const dage = ['2026-11-21', '2026-11-22'];
    let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: [['a'], ['b'], ['c'], ['d']] }] }], dage));
    for (const d of dage) p = opdaterDag(p, d, { baner: 4, start: '09:00', slut: '18:00' });
    return opdaterRaekke(saetForm(p, 'U11 D HS', { formValg: 'pulje' }), 'U11 D', { dage });
}

describe('V5: beslutningskortene hører til projektet, så længe kampene og opsætningen er de samme', () => {
    test('flyt, lås og kvittér beholder panelet; en ændret række gør ikke', () => {
        const p = projekt();
        const kp = { projekt: p };
        const k = p.kampe[0].id;
        let q = flytKamp(p, k, '2026-11-21', '10:00');
        assert.equal(panelGaelder(kp, q), true);
        q = laasKamp(q, k, true);
        assert.equal(panelGaelder(kp, q), true);
        assert.equal(panelGaelder(kp, kvitter(q, 'x')), true);
        assert.equal(panelGaelder(kp, opdaterRaekke(q, 'U11 D', { senest: '16:00' })), false);
        assert.equal(panelGaelder(null, q), false);
    });
});

describe('V7: "kræver dispensation" først, når rækken ligger på flere dage', () => {
    test('to mulige dage, men programmet bruger én: intet mærke — men valget af dispensation findes', () => {
        let p = projekt();
        const [a, b] = p.kampe.map((k) => k.id);
        p = flytKamp(flytKamp(p, a, '2026-11-21', '09:00'), b, '2026-11-21', '10:00');
        const html = raekkePanel(p);
        assert.doesNotMatch(html, /kræver dispensation/);
        assert.match(html, /dispensation til flere dage/);
        p = flytKamp(p, b, '2026-11-22', '10:00');
        assert.match(raekkePanel(p), /kræver dispensation/);
        assert.match(raekkePanel(opdaterRaekke(p, 'U11 D', { dispensationFlereDage: true })), /dispensation givet/);
    });
});

describe('Panelet efter "Forbedr med løseren" uden lovlig plan (V1) og efter et flyt (V5)', async () => {
    const { kampprogramPanel } = await import('../../src/ui/plan.js');
    test('brugerens eget program: ingen Fortryd, tydelig titel og tilbud om kampprogram', () => {
        const p = projekt();
        const kp = { projekt: p, foer: p, valg: null, beslutninger: { kort: [], brud: 2 }, udfoert: [], beholdt: [], egetProgram: true, note: 'Løseren kunne bevise …', handlinger: [{ tekst: 'Lav kampprogram med forslag til ændringer', type: 'lav-kampprogram' }] };
        const html = kampprogramPanel(kp, [], p);
        assert.match(html, /dit program er ikke ændret/);
        assert.match(html, /Lav kampprogram med forslag til ændringer/);
        assert.doesNotMatch(html, /kp-fortryd/);
    });
    test('efter et flyt står kortene der stadig, med en note om at Tjek viser status nu', () => {
        const p = projekt();
        const kp = { projekt: p, foer: p, valg: { grund: 'fast', minutter: 30, udenPause: false }, beslutninger: { kort: [], brud: 0 }, udfoert: [], beholdt: [] };
        assert.doesNotMatch(kampprogramPanel(kp, [], p), /Du har flyttet/);
        const q = flytKamp(p, p.kampe[0].id, '2026-11-21', '10:00');
        assert.match(kampprogramPanel(kp, [], q), /Du har flyttet eller låst kampe/);
        assert.match(kampprogramPanel(kp, [], q), /kp-fortryd/);
    });
});
