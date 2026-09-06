/**
 * Unit-tests af auth-modellen — ingen server, ingen database.
 *
 * authMiddleware   = admin-endpoints (rolle + klub skal passe)
 * requireWriteAuthInClubMode = score-endpoints (device/club_admin for egen klub)
 *
 * Kør: npm run test:unit
 */
process.env.JWT_SECRET = 'unit-test-secret-mindst-32-tegn-aaaaaaaa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { authMiddleware, requireWriteAuthInClubMode } = require('../../middleware/auth');

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

function req({ token, accessMode, clubSubdomain }) {
    return {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        accessMode,
        clubSubdomain
    };
}

// Kører en middleware og fanger status/body/om next() blev kaldt
function run(mw, request) {
    let status = 200, body = null, nexted = false;
    const res = {
        status(c) { status = c; return this; },
        json(b) { body = b; return this; }
    };
    mw(request, res, () => { nexted = true; });
    return { status, body, nexted };
}

// ── authMiddleware (admin-endpoints) ─────────────────────────────────────

test('authMiddleware: device-token afvises på admin-endpoint i club-mode', () => {
    const r = run(authMiddleware, req({ token: sign({ role: 'device', clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('authMiddleware: device-token afvises også i direct-mode', () => {
    const r = run(authMiddleware, req({ token: sign({ role: 'device' }), accessMode: 'direct' }));
    assert.equal(r.status, 403);
});

test('authMiddleware: club_admin fra en ANDEN klub afvises', () => {
    const r = run(authMiddleware, req({ token: sign({ role: 'club_admin', clubSubdomain: 'anden' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('authMiddleware: club_admin for EGEN klub tillades', () => {
    const r = run(authMiddleware, req({ token: sign({ role: 'club_admin', clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('authMiddleware: super_admin tillades på tværs af klubber', () => {
    const r = run(authMiddleware, req({ token: sign({ role: 'super_admin' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('authMiddleware: {admin:true} uden klub afvises i club-mode', () => {
    const r = run(authMiddleware, req({ token: sign({ admin: true }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('authMiddleware: {admin:true} tillades i direct-mode (lokal installation)', () => {
    const r = run(authMiddleware, req({ token: sign({ admin: true }), accessMode: 'direct' }));
    assert.equal(r.nexted, true);
});

test('authMiddleware: manglende token giver 401', () => {
    const r = run(authMiddleware, req({ accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 401);
});

test('authMiddleware: token med forkert signatur giver 401', () => {
    const forkert = jwt.sign({ role: 'super_admin' }, 'en-helt-anden-hemmelighed-aaaaaaaaaaaaa');
    const r = run(authMiddleware, req({ token: forkert, accessMode: 'direct' }));
    assert.equal(r.status, 401);
});

test('authMiddleware: udløbet token giver 401', () => {
    const udloebet = jwt.sign({ role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const r = run(authMiddleware, req({ token: udloebet, accessMode: 'direct' }));
    assert.equal(r.status, 401);
    assert.match(r.body.error, /udløbet/i);
});

// ── requireWriteAuthInClubMode (score-endpoints) ─────────────────────────

test('write: direct-mode kræver ikke token', () => {
    const r = run(requireWriteAuthInClubMode, req({ accessMode: 'direct' }));
    assert.equal(r.nexted, true);
});

test('write: club-mode uden token giver 401 med authRequired', () => {
    const r = run(requireWriteAuthInClubMode, req({ accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 401);
    assert.equal(r.body.authRequired, true);
});

test('write: device-token for EGEN klub tillades (tæller/TV)', () => {
    const r = run(requireWriteAuthInClubMode, req({ token: sign({ role: 'device', clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('write: device-token for ANDEN klub afvises', () => {
    const r = run(requireWriteAuthInClubMode, req({ token: sign({ role: 'device', clubSubdomain: 'anden' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
});

test('write: club_admin for egen klub tillades', () => {
    const r = run(requireWriteAuthInClubMode, req({ token: sign({ role: 'club_admin', clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('write: super_admin tillades', () => {
    const r = run(requireWriteAuthInClubMode, req({ token: sign({ role: 'super_admin' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('write: {admin:true} uden klub afvises i club-mode (kendt standardadgangskode må ikke åbne alle klubber)', () => {
    const r = run(requireWriteAuthInClubMode, req({ token: sign({ admin: true }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
});
