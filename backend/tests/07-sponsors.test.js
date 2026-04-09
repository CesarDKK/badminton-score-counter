const { test } = require('node:test');
const assert = require('node:assert/strict');
const { req, adminLogin, ADMIN_PASSWORD } = require('./helpers');

test('Sponsors: GET billeder er tilgængeligt (public)', async () => {
    // /api/sponsors/images er public (bruges af TV/bane sider)
    const { status, body } = await req('/api/sponsors/images');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
});

test('Sponsors: GET indstillinger er tilgængeligt (public)', async () => {
    const { status, body } = await req('/api/sponsors/settings');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object');
});

test('Sponsors: DELETE ikke-eksisterende sponsor returnerer 404', { skip: !ADMIN_PASSWORD }, async (t) => {
    if (!ADMIN_PASSWORD) return t.skip('TEST_ADMIN_PASSWORD ikke sat');
    const token = await adminLogin();
    const { status } = await req('/api/sponsors/99999', {
        method: 'DELETE'
    }, { token });
    assert.equal(status, 404);
});
