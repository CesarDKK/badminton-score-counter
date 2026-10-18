// Hvad planneren gør med løserens svar (src/loeser-svar.js, gennemgangen af løseren 2026-10-17, pakke 3)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { vurderLoeserPlan, visPlanMedFaerrestBrud, vurderProeve } from '../../src/loeser-svar.js';

describe('løserens lovlige plan', () => {
    const auto = { auto: true, harProgram: true, scoreLoeser: 10, scoreFoer: 12, fejlLoeser: 0, fejlFoer: 0 };
    test('af sig selv efter "Lav kampprogram": en bedre plan lægges ind', () => {
        assert.equal(vurderLoeserPlan(auto), 'indlaeg');
    });
    test('har brugeren set listen til TP imens, bliver den et tilbud', () => {
        assert.equal(vurderLoeserPlan({ ...auto, listeSet: true }), 'tilbud');
    });
    test('flere fejl i Tjek end programmet: programmet beholdes, selv med bedre score', () => {
        assert.equal(vurderLoeserPlan({ ...auto, fejlLoeser: 1 }), 'beholdt-fejl');
    });
    test('ikke bedre: programmet beholdes', () => {
        assert.equal(vurderLoeserPlan({ ...auto, scoreLoeser: 12 }), 'beholdt');
    });
    test('trykkede brugeren selv, eller var der intet program, vælger brugeren', () => {
        assert.equal(vurderLoeserPlan({ ...auto, auto: false }), 'vaelg');
        assert.equal(vurderLoeserPlan({ ...auto, harProgram: false }), 'vaelg');
    });
});

describe('planen med færrest brud og prøven', () => {
    test('planen med færrest brud vises kun med højst lige så mange fejl i Tjek', () => {
        assert.equal(visPlanMedFaerrestBrud(3, 3), true);
        assert.equal(visPlanMedFaerrestBrud(4, 3), false);
    });
    test('en lovlig prøve er et tilbud, når den ikke får flere fejl — "bedre" ser på fejl og så score', () => {
        assert.deepEqual(vurderProeve({ lovlig: true, fejlProeve: 0, fejlNu: 0, scoreProeve: 9, scoreNu: 10 }), { tilbud: true, bedre: true });
        assert.deepEqual(vurderProeve({ lovlig: true, fejlProeve: 0, fejlNu: 0, scoreProeve: 11, scoreNu: 10 }), { tilbud: true, bedre: false });
        assert.equal(vurderProeve({ lovlig: true, fejlProeve: 1, fejlNu: 0, scoreProeve: 1, scoreNu: 10 }).tilbud, false);
    });
    test('en prøve med regelbrud er kun et tilbud med færre fejl end det nuværende', () => {
        assert.equal(vurderProeve({ lovlig: false, fejlProeve: 2, fejlNu: 2, scoreProeve: 1, scoreNu: 10 }).tilbud, false);
        assert.equal(vurderProeve({ lovlig: false, fejlProeve: 1, fejlNu: 2, scoreProeve: 1, scoreNu: 10 }).tilbud, true);
    });
});
