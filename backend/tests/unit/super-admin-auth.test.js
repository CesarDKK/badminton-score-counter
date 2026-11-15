/**
 * Unit-tests af super-admin-guarden, især det tvungne password-skift:
 * et must-change-token må KUN nå /change-password.
 */
process.env.JWT_SECRET = 'unit-test-secret-mindst-32-tegn-aaaaaaaa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { superAdminAuth, generateSuperAdminToken, _saetSuperAdminOpslag } = require('../../middleware/superAdminAuth');

// Super-admin 1 findes i master-databasen med hash 'h1' (nr. 18)
_saetSuperAdminOpslag(async (id) => (id === 1 ? { password_hash: 'h1' } : null));

async function run(token, path) {
    let status = 200, body = null, nexted = false;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    await superAdminAuth({ headers: { authorization: `Bearer ${token}` }, path }, res, () => { nexted = true; });
    return { status, body, nexted };
}

test('normalt super-admin-token har adgang overalt', async () => {
    const r = await run(generateSuperAdminToken(1, 'superadmin', false, 'h1'), '/api/super-admin/clubs');
    assert.equal(r.nexted, true);
});

test('must-change-token blokeres på almindelige endpoints', async () => {
    const r = await run(generateSuperAdminToken(1, 'superadmin', true, 'h1'), '/api/super-admin/clubs');
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
    assert.equal(r.body.mustChangePassword, true);
});

test('must-change-token tillades på /change-password', async () => {
    const r = await run(generateSuperAdminToken(1, 'superadmin', true, 'h1'), '/api/super-admin/change-password');
    assert.equal(r.nexted, true);
});

test('token uden super_admin-rolle afvises med 403', async () => {
    const r = await run(jwt.sign({ role: 'club_admin' }, process.env.JWT_SECRET), '/api/super-admin/clubs');
    assert.equal(r.status, 403);
});

test('generateSuperAdminToken lægger mustChange i payloaden', () => {
    const p = jwt.verify(generateSuperAdminToken(7, 'x', true), process.env.JWT_SECRET);
    assert.equal(p.role, 'super_admin');
    assert.equal(p.id, 7);
    assert.equal(p.mustChange, true);
});

test('nr. 18: skiftet adgangskode, slettet admin og et token uden aftryk afvises med 401', async () => {
    for (const token of [
        generateSuperAdminToken(1, 'superadmin', false, 'gammel-hash'),
        generateSuperAdminToken(2, 'slettet', false, 'h1'),
        jwt.sign({ role: 'super_admin', id: 1, username: 'superadmin' }, process.env.JWT_SECRET),
    ]) {
        const r = await run(token, '/api/super-admin/clubs');
        assert.equal(r.status, 401);
        assert.equal(r.body.sessionEnded, true);
        assert.equal(r.nexted, false);
    }
});
