const { test } = require('node:test');
const assert = require('node:assert/strict');
const { req } = require('./helpers');

test('Server: health check returnerer healthy', async () => {
    const { status, body } = await req('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'healthy');
    assert.ok(body.timestamp);
    assert.ok(typeof body.uptime === 'number');
});

test('Server: ukendt endpoint returnerer 404', async () => {
    const { status } = await req('/api/findesikke');
    assert.equal(status, 404);
});
