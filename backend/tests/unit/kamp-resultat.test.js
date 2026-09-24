/**
 * Unit-tests af reglerne for et indtastet kampresultat (badmintonplanner-baner):
 * afsluttet før tid, valgfri vinder, walkover. Samme tilfælde køres mod
 * backend/config/kampResultat.js (serveren afgør) og frontend/js/kamp-resultat.js
 * (tællersiden foreslår), så de to kopier ikke glider fra hinanden.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const udgaver = {
    backend: require('../../config/kampResultat'),
    frontend: require('../../../frontend/js/kamp-resultat')
};

for (const [navn, K] of Object.entries(udgaver)) {
    test(`${navn}: sæt færdigt efter 15/21 og 21/30`, () => {
        assert.equal(K.saetFaerdigt(15, 7, '15'), true);
        assert.equal(K.saetFaerdigt(15, 14, '15'), false);
        assert.equal(K.saetFaerdigt(21, 20, '15'), true);   // loft
        assert.equal(K.saetFaerdigt(13, 4, '15'), false);
        assert.equal(K.saetFaerdigt(21, 19, '21'), true);
        assert.equal(K.saetFaerdigt(30, 29, '21'), true);
        assert.equal(K.saetFaerdigt(15, 7, '21'), false);
    });

    test(`${navn}: foreslået vinder — sæt, så føring i sidste sæt, så point`, () => {
        assert.equal(K.foreslaaVinder([[15, 7], [13, 4]], '15'), 1);
        assert.equal(K.foreslaaVinder([[7, 15], [13, 4]], '15'), 2);   // vundet sæt tæller før føring
        assert.equal(K.foreslaaVinder([[7, 15], [4, 13]], '15'), 2);
        assert.equal(K.foreslaaVinder([[7, 15], [15, 9], [10, 10]], '15'), 2); // lige i sæt og sidste sæt → flest point (32-34)
        assert.equal(K.foreslaaVinder([[0, 0]], '15'), null);
    });

    test(`${navn}: 15-7 13-4 er afsluttet før tid, og vinderen kan vælges frit`, () => {
        const a = K.validerIndtastning({ sets: [[15, 7], [13, 4]], winner: 1 }, '15');
        assert.deepEqual(a.resultat, { sets: [[15, 7], [13, 4]], winner: 1, walkover: false, outcome: 'ended_early' });
        const b = K.validerIndtastning({ sets: [[15, 7], [13, 4]], winner: 2 }, '15');
        assert.equal(b.resultat.winner, 2); // fx opgivet af den førende side
    });

    test(`${navn}: færdigspillet kamp er 'completed', og vinderen skal passe`, () => {
        const ok = K.validerIndtastning({ sets: [[21, 15], [18, 21], [21, 19]], winner: 1 }, '21');
        assert.equal(ok.resultat.outcome, 'completed');
        const forkert = K.validerIndtastning({ sets: [[21, 15], [21, 19]], winner: 2 }, '21');
        assert.match(forkert.error, /vundet 2 sæt/);
    });

    test(`${navn}: walkover kræver kun en vinder`, () => {
        const r = K.validerIndtastning({ walkover: true, winner: 2, sets: [[1, 2]] }, '15');
        assert.deepEqual(r.resultat, { sets: [], winner: 2, walkover: true, outcome: 'walkover' });
    });

    test(`${navn}: tomme sæt sidst ignoreres, men ét sæt skal udfyldes`, () => {
        const r = K.validerIndtastning({ sets: [[15, 9], [0, 0], [0, 0]], winner: 1 }, '15');
        assert.deepEqual(r.resultat.sets, [[15, 9]]);
        assert.equal(r.resultat.outcome, 'ended_early');
        assert.match(K.validerIndtastning({ sets: [[0, 0]], winner: 1 }, '15').error, /mindst ét sæt/);
    });

    test(`${navn}: afviser umulige resultater`, () => {
        assert.match(K.validerIndtastning({ sets: [[15, 7]] }, '15').error, /hvem der vandt/);
        assert.match(K.validerIndtastning({ sets: [[13, 4], [15, 7]], winner: 1 }, '15').error, /kun sidste sæt/);
        assert.match(K.validerIndtastning({ sets: [[15, 7], [15, 7], [15, 7]], winner: 1 }, '15').error, /afgjort efter sæt 2/);
        assert.match(K.validerIndtastning({ sets: [[22, 20]], winner: 1 }, '15').error, /højst gå til 21/);
        assert.match(K.validerIndtastning({ sets: [[-1, 5]], winner: 1 }, '15').error, /hele tal/);
        assert.match(K.validerIndtastning({ sets: [[1.5, 5]], winner: 1 }, '15').error, /hele tal/);
        assert.match(K.validerIndtastning({ sets: [[1, 2], [3, 4], [5, 6], [7, 8]], winner: 1 }, '15').error, /kun sidste sæt|Højst 3/);
    });
}
