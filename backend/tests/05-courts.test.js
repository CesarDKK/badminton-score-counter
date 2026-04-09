const { test } = require('node:test');
const assert = require('node:assert/strict');
const { req } = require('./helpers');

test('Courts: GET returnerer array', async () => {
    const { status, body } = await req('/api/courts');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
});

test('Courts: hvert element har korrekte felter', async () => {
    const { body } = await req('/api/courts');
    const court = body[0];
    assert.ok(typeof court.id === 'number');
    assert.ok(typeof court.court_number === 'number');
    assert.ok(typeof court.is_active === 'boolean');
    assert.ok(typeof court.is_doubles === 'boolean');
});

test('Courts: GET enkelt bane returnerer 200', async () => {
    const { body: courts } = await req('/api/courts');
    const { status, body } = await req(`/api/courts/${courts[0].court_number}`);
    assert.equal(status, 200);
    assert.equal(body.court_number, courts[0].court_number);
});

test('Courts: GET ikke-eksisterende bane returnerer 404', async () => {
    const { status } = await req('/api/courts/9999');
    assert.equal(status, 404);
});

test('Courts: PUT ugyldigt gameMode afvises', async () => {
    const { body: courts } = await req('/api/courts');
    const { status } = await req(`/api/courts/${courts[0].court_number}`, {
        method: 'PUT',
        body: { gameMode: '30' }
    });
    assert.equal(status, 400);
});
