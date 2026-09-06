/**
 * Unit-tests af super-admin-guarden, især det tvungne password-skift:
 * et must-change-token må KUN nå /change-password.
 */
process.env.JWT_SECRET = 'unit-test-secret-mindst-32-tegn-aaaaaaaa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { superAdminAuth, generateSuperAdminToken } = require('../../middleware/superAdminAuth');

function run(token, path) {
    let status = 200, body = null, nexted = false;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    superAdminAuth({ headers: { authorization: `Bearer ${token}` }, path }, res, () => { nexted = true; });
    return { status, body, nexted };
}

test('normalt super-admin-token har adgang overalt', () => {
    const r = run(generateSuperAdminToken(1, 'superadmin', false), '/api/super-admin/clubs');
    assert.equal(r.nexted, true);
});

test('must-change-token blokeres på almindelige endpoints', () => {
    const r = run(generateSuperAdminToken(1, 'superadmin', true), '/api/super-admin/clubs');
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
    assert.equal(r.body.mustChangePassword, true);
});

test('must-change-token tillades på /change-password', () => {
    const r = run(generateSuperAdminToken(1, 'superadmin', true), '/api/super-admin/change-password');
    assert.equal(r.nexted, true);
});

test('token uden super_admin-rolle afvises med 403', () => {
    const r = run(jwt.sign({ role: 'club_admin' }, process.env.JWT_SECRET), '/api/super-admin/clubs');
    assert.equal(r.status, 403);
});

test('generateSuperAdminToken lægger mustChange i payloaden', () => {
    const p = jwt.verify(generateSuperAdminToken(7, 'x', true), process.env.JWT_SECRET);
    assert.equal(p.role, 'super_admin');
    assert.equal(p.id, 7);
    assert.equal(p.mustChange, true);
});
