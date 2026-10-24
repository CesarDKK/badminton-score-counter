/**
 * Unit-tests af klub-admins mail (login med mail i stedet for brugernavn) —
 * ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliserMail, lignerMail } = require('../../config/adminMail');

test('normaliserMail: trimmer og gemmer med små bogstaver', () => {
    assert.deepEqual(normaliserMail('  Jesper@Klub.DK '), { value: 'jesper@klub.dk' });
});

test('normaliserMail: tom eller udeladt = ingen mail', () => {
    assert.deepEqual(normaliserMail(''), { value: null });
    assert.deepEqual(normaliserMail('   '), { value: null });
    assert.deepEqual(normaliserMail(undefined), { value: null });
    assert.deepEqual(normaliserMail(null), { value: null });
});

test('normaliserMail: afviser noget, der ikke er en mailadresse', () => {
    for (const forkert of ['jesper', 'jesper@', '@klub.dk', 'jesper@klub', 'jes per@klub.dk', 'a@b@c.dk']) {
        assert.ok(normaliserMail(forkert).error, forkert);
    }
    assert.ok(normaliserMail('a'.repeat(196) + '@k.dk').error, 'over 200 tegn');
});

test('lignerMail: kun indtastninger med @ prøves som mail', () => {
    assert.equal(lignerMail('jesper@klub.dk'), true);
    assert.equal(lignerMail('jesper'), false);
    assert.equal(lignerMail(undefined), false);
});
