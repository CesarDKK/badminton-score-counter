const { test } = require('node:test');
const assert = require('node:assert/strict');
const { req, adminLogin, ADMIN_PASSWORD } = require('./helpers');

test('Settings: GET returnerer alle felter', async () => {
    const { status, body } = await req('/api/settings');
    assert.equal(status, 200);
    assert.ok(typeof body.courtCount === 'number');
    assert.ok(typeof body.showResetButton === 'boolean');
    assert.ok(['15', '21'].includes(body.defaultGameMode));
});

test('Settings: GET theme returnerer objekt', async () => {
    const { status, body } = await req('/api/settings/theme');
    assert.equal(status, 200);
    assert.ok(typeof body === 'object');
});

test('Settings: opdater bane antal kræver auth', async () => {
    const { status } = await req('/api/settings/court-count', {
        method: 'PUT',
        body: { courtCount: 4 }
    });
    assert.equal(status, 401);
});

test('Settings: opdater bane antal med auth virker', { skip: !ADMIN_PASSWORD }, async (t) => {
    if (!ADMIN_PASSWORD) return t.skip('TEST_ADMIN_PASSWORD ikke sat');
    const token = await adminLogin();
    const original = (await req('/api/settings')).body.courtCount;

    const { status } = await req('/api/settings/court-count', {
        method: 'PUT',
        body: { courtCount: 5 }
    }, { token });
    assert.equal(status, 200);

    const after = (await req('/api/settings')).body.courtCount;
    assert.equal(after, 5);

    await req('/api/settings/court-count', {
        method: 'PUT',
        body: { courtCount: original }
    }, { token });
});

test('Settings: ugyldigt bane antal afvises', { skip: !ADMIN_PASSWORD }, async (t) => {
    if (!ADMIN_PASSWORD) return t.skip('TEST_ADMIN_PASSWORD ikke sat');
    const token = await adminLogin();
    const { status } = await req('/api/settings/court-count', {
        method: 'PUT',
        body: { courtCount: 99 }
    }, { token });
    assert.equal(status, 400);
});

