const { test } = require('node:test');
const assert = require('node:assert/strict');
const { req, adminLogin, ADMIN_PASSWORD } = require('./helpers');

test('Auth: forkert adgangskode returnerer 401', async () => {
    const { status, body } = await req('/api/auth/login', {
        method: 'POST',
        body: { password: '__forkert_kode_xyz__' }
    });
    assert.equal(status, 401);
    assert.ok(body.error);
});

test('Auth: manglende adgangskode returnerer 400', async () => {
    const { status } = await req('/api/auth/login', {
        method: 'POST',
        body: {}
    });
    assert.equal(status, 400);
});

test('Auth: korrekt adgangskode returnerer token', { skip: !ADMIN_PASSWORD }, async (t) => {
    if (!ADMIN_PASSWORD) return t.skip('TEST_ADMIN_PASSWORD ikke sat');
    const token = await adminLogin();
    assert.ok(typeof token === 'string');
    assert.ok(token.length > 10);
});

test('Auth: beskyttet endpoint kræver token', async () => {
    // PUT /api/settings/court-count kræver auth — uden token skal det give 401
    const { status } = await req('/api/settings/court-count', {
        method: 'PUT',
        body: { courtCount: 4 }
    });
    assert.equal(status, 401);
});

test('Auth: beskyttet endpoint med ugyldigt token returnerer 401', async () => {
    const { status } = await req('/api/settings/court-count', {
        method: 'PUT',
        body: { courtCount: 4 }
    }, { token: 'ugyldig.jwt.token' });
    assert.equal(status, 401);
});
