/**
 * Device token tests — kræver en klub i databasen med en club admin.
 * Hoppes over automatisk hvis TEST_CLUB_HOST ikke er sat.
 *
 * Sæt disse miljøvariabler for at aktivere:
 *   TEST_CLUB_HOST=lyngby.badmintonapp.dk
 *   TEST_CLUB_ADMIN_USER=admin
 *   TEST_CLUB_ADMIN_PASS=hemmeligt
 */
const { test, skip } = require('node:test');
const assert = require('node:assert/strict');
const { req } = require('./helpers');

const CLUB_HOST = process.env.TEST_CLUB_HOST;
const CLUB_USER = process.env.TEST_CLUB_ADMIN_USER;
const CLUB_PASS = process.env.TEST_CLUB_ADMIN_PASS;

const skipMsg = 'Sæt TEST_CLUB_HOST, TEST_CLUB_ADMIN_USER og TEST_CLUB_ADMIN_PASS for at køre klub-tests';

async function clubAdminLogin() {
    const { status, body } = await req('/api/club-admin/login', {
        method: 'POST',
        body: { username: CLUB_USER, password: CLUB_PASS }
    }, { host: CLUB_HOST });

    if (status !== 200 || !body?.token) {
        throw new Error(`Klub login fejlede (${status}): ${JSON.stringify(body)}`);
    }
    return body.token;
}

if (!CLUB_HOST) {
    test('DeviceTokens: (tests sprunget over — ' + skipMsg + ')', (t) => {
        t.skip(skipMsg);
    });
} else {
    let createdTokenId;

    test('DeviceTokens: login som klub admin virker', async () => {
        const token = await clubAdminLogin();
        assert.ok(token.length > 10);
    });

    test('DeviceTokens: GET liste returnerer array', async () => {
        const token = await clubAdminLogin();
        const { status, body } = await req('/api/device-tokens', {}, { token, host: CLUB_HOST });
        assert.equal(status, 200);
        assert.ok(Array.isArray(body));
    });

    test('DeviceTokens: opret nyt token', async () => {
        const token = await clubAdminLogin();
        const { status, body } = await req('/api/device-tokens', {
            method: 'POST',
            body: { name: 'Test Token', destination: 'court/1', locked: true }
        }, { token, host: CLUB_HOST });
        assert.equal(status, 201);
        assert.ok(body.id);
        assert.ok(body.token);
        createdTokenId = body.id;
    });

    test('DeviceTokens: oprettet token vises på listen', async () => {
        const token = await clubAdminLogin();
        const { body } = await req('/api/device-tokens', {}, { token, host: CLUB_HOST });
        const found = body.find(t => t.id === createdTokenId);
        assert.ok(found, 'Oprettet token skal findes på listen');
        assert.equal(found.name, 'Test Token');
    });

    test('DeviceTokens: slet token', async () => {
        const token = await clubAdminLogin();
        const { status } = await req(`/api/device-tokens/${createdTokenId}`, {
            method: 'DELETE'
        }, { token, host: CLUB_HOST });
        assert.equal(status, 200);
    });

    test('DeviceTokens: slettet token er ikke på listen', async () => {
        const token = await clubAdminLogin();
        const { body } = await req('/api/device-tokens', {}, { token, host: CLUB_HOST });
        const found = body.find(t => t.id === createdTokenId);
        assert.ok(!found, 'Slettet token må ikke være på listen');
    });

    test('DeviceTokens: opret kræver auth', async () => {
        const { status } = await req('/api/device-tokens', {
            method: 'POST',
            body: { name: 'Uautoriseret', destination: 'court/1', locked: false }
        }, { host: CLUB_HOST });
        assert.equal(status, 401);
    });
}
