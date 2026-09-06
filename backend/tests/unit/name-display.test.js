/**
 * Unit-tests af visningsnavne på TV-skærmen (frontend/js/name-display.js):
 * kun fornavn, forbogstav ved sammenfald, hele efternavnet hvis det heller
 * ikke rækker. Filen er ren logik og kan derfor testes her uden browser.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fornavn, efternavn, visningsnavne } = require('../../../frontend/js/name-display');

test('fornavn: første ord — dobbelt fornavn skæres til ét', () => {
    assert.equal(fornavn('Anna Marie Jensen'), 'Anna');
    assert.equal(fornavn('Hans Henrik Heidemann'), 'Hans');
    assert.equal(fornavn('Jesper'), 'Jesper');
    assert.equal(fornavn('  Bo   Hansen '), 'Bo');
});

test('fornavn: bindestreg-navne holdes samlet, alias efter "/" ignoreres', () => {
    assert.equal(fornavn('Jens-Peter Hansen-Olsen'), 'Jens-Peter');
    assert.equal(fornavn('Anna Jensen / A. Jensen'), 'Anna');
    assert.equal(fornavn(''), '');
    assert.equal(fornavn(null), '');
});

test('efternavn: sidste ord, tomt ved kun ét ord', () => {
    assert.equal(efternavn('Anna Marie Jensen'), 'Jensen');
    assert.equal(efternavn('Jesper'), '');
});

test('visningsnavne: ingen sammenfald → rene fornavne, tomme pladser bevares', () => {
    assert.deepEqual(
        visningsnavne(['Anna Marie Jensen', 'Christoffer Rasmussen', 'Bo Hansen', '']),
        ['Anna', 'Christoffer', 'Bo', '']
    );
});

test('visningsnavne: sammenfald giver forbogstav — også på tværs af modstandere', () => {
    assert.deepEqual(
        visningsnavne(['Anna Jensen', 'Bo Hansen', 'Anna Kristensen', 'Lis Berg']),
        ['Anna J.', 'Bo', 'Anna K.', 'Lis']
    );
});

test('visningsnavne: sammenfald er uafhængigt af store/små bogstaver', () => {
    assert.deepEqual(visningsnavne(['anna jensen', 'Anna Kristensen']), ['anna J.', 'Anna K.']);
});

test('visningsnavne: ens forbogstav → hele efternavnet', () => {
    assert.deepEqual(
        visningsnavne(['Anna Jensen', 'Anna Jørgensen']),
        ['Anna Jensen', 'Anna Jørgensen']
    );
});

test('visningsnavne: sammenfald uden efternavn kan ikke skelnes og forbliver fornavn', () => {
    assert.deepEqual(visningsnavne(['Anna', 'Anna Kristensen']), ['Anna', 'Anna K.']);
});

test('visningsnavne: tre ens fornavne håndteres', () => {
    assert.deepEqual(
        visningsnavne(['Anna Jensen', 'Anna Kristensen', 'Anna Berg', 'Bo Hansen']),
        ['Anna J.', 'Anna K.', 'Anna B.', 'Bo']
    );
});
