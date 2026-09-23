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
const { authMiddleware, requireWriteAuthInClubMode, _saetAdgangslinkOpslag } = require('../../middleware/auth');

// Adgangslink-opslaget i databasen: id 1–99 er aktive, alt andet tilbagekaldt/slettet
_saetAdgangslinkOpslag(async (id) => id >= 1 && id < 100);

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

function req({ token, accessMode, clubSubdomain }) {
    return {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        accessMode,
        clubSubdomain
    };
}

// Kører en middleware og fanger status/body/om next() blev kaldt
async function run(mw, request) {
    let status = 200, body = null, nexted = false;
    const res = {
        status(c) { status = c; return this; },
        json(b) { body = b; return this; }
    };
    await mw(request, res, () => { nexted = true; });
    return { status, body, nexted };
}

// ── authMiddleware (admin-endpoints) ─────────────────────────────────────

test('authMiddleware: device-token afvises på admin-endpoint i club-mode', async () => {
    const r = await run(authMiddleware, req({ token: sign({ role: 'device', clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('authMiddleware: device-token afvises også i direct-mode', async () => {
    const r = await run(authMiddleware, req({ token: sign({ role: 'device' }), accessMode: 'direct' }));
    assert.equal(r.status, 403);
});

test('authMiddleware: club_admin fra en ANDEN klub afvises', async () => {
    const r = await run(authMiddleware, req({ token: sign({ role: 'club_admin', clubSubdomain: 'anden' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('authMiddleware: club_admin for EGEN klub tillades', async () => {
    const r = await run(authMiddleware, req({ token: sign({ role: 'club_admin', clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('authMiddleware: super_admin tillades på tværs af klubber', async () => {
    const r = await run(authMiddleware, req({ token: sign({ role: 'super_admin' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('authMiddleware: {admin:true} uden klub afvises i club-mode', async () => {
    const r = await run(authMiddleware, req({ token: sign({ admin: true }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('authMiddleware: {admin:true} tillades i direct-mode (lokal installation)', async () => {
    const r = await run(authMiddleware, req({ token: sign({ admin: true }), accessMode: 'direct' }));
    assert.equal(r.nexted, true);
});

test('authMiddleware: manglende token giver 401', async () => {
    const r = await run(authMiddleware, req({ accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 401);
});

test('authMiddleware: token med forkert signatur giver 401', async () => {
    const forkert = jwt.sign({ role: 'super_admin' }, 'en-helt-anden-hemmelighed-aaaaaaaaaaaaa');
    const r = await run(authMiddleware, req({ token: forkert, accessMode: 'direct' }));
    assert.equal(r.status, 401);
});

test('authMiddleware: udløbet token giver 401', async () => {
    const udloebet = jwt.sign({ role: 'super_admin' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const r = await run(authMiddleware, req({ token: udloebet, accessMode: 'direct' }));
    assert.equal(r.status, 401);
    assert.match(r.body.error, /udløbet/i);
});

// ── requireWriteAuthInClubMode (score-endpoints) ─────────────────────────

test('write: direct-mode kræver ikke token', async () => {
    const r = await run(requireWriteAuthInClubMode, req({ accessMode: 'direct' }));
    assert.equal(r.nexted, true);
});

test('write: club-mode uden token giver 401 med authRequired', async () => {
    const r = await run(requireWriteAuthInClubMode, req({ accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 401);
    assert.equal(r.body.authRequired, true);
});

test('write: device-token for EGEN klub tillades (tæller/TV)', async () => {
    const r = await run(requireWriteAuthInClubMode, req({ token: sign({ role: 'device', tokenId: 7, clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('write: device-token for ANDEN klub afvises', async () => {
    const r = await run(requireWriteAuthInClubMode, req({ token: sign({ role: 'device', clubSubdomain: 'anden' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
});

test('write: club_admin for egen klub tillades', async () => {
    const r = await run(requireWriteAuthInClubMode, req({ token: sign({ role: 'club_admin', clubSubdomain: 'lyngby' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('write: super_admin tillades', async () => {
    const r = await run(requireWriteAuthInClubMode, req({ token: sign({ role: 'super_admin' }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.nexted, true);
});

test('write: {admin:true} uden klub afvises i club-mode (kendt standardadgangskode må ikke åbne alle klubber)', async () => {
    const r = await run(requireWriteAuthInClubMode, req({ token: sign({ admin: true }), accessMode: 'club', clubSubdomain: 'lyngby' }));
    assert.equal(r.status, 403);
});

// ── Tilbagekaldte adgangslinks (A2) ──────────────────────────────────────

const club = (payload) => req({ token: sign({ clubSubdomain: 'lyngby', ...payload }), accessMode: 'club', clubSubdomain: 'lyngby' });

test('write: tilbagekaldt/slettet fast adgangslink afvises med 401 og tokenRevoked', async () => {
    const r = await run(requireWriteAuthInClubMode, club({ role: 'device', tokenId: 500, tokenType: 'permanent' }));
    assert.equal(r.status, 401);
    assert.equal(r.body.tokenRevoked, true);
    assert.equal(r.body.qrSessionEnded, false);
    assert.match(r.body.error, /tilbagekaldt/);
});

test('write: afsluttet QR-session afvises med qrSessionEnded', async () => {
    const r = await run(requireWriteAuthInClubMode, club({ role: 'device', tokenId: 501, tokenType: 'match_session' }));
    assert.equal(r.status, 401);
    assert.equal(r.body.qrSessionEnded, true);
});

test('write: device-token uden tokenId afvises', async () => {
    const r = await run(requireWriteAuthInClubMode, club({ role: 'device' }));
    assert.equal(r.status, 401);
});

test('write: admins slås ikke op i device_tokens', async () => {
    _saetAdgangslinkOpslag(async () => { throw new Error('må ikke slå op'); });
    try {
        assert.equal((await run(requireWriteAuthInClubMode, club({ role: 'club_admin' }))).nexted, true);
        assert.equal((await run(requireWriteAuthInClubMode, club({ role: 'super_admin' }))).nexted, true);
    } finally {
        _saetAdgangslinkOpslag(async (id) => id >= 1 && id < 100);
    }
});

test('write: databasefejl ved opslaget går til fejlhåndteringen', async () => {
    _saetAdgangslinkOpslag(async () => { throw new Error('db nede'); });
    try {
        let fejl = null;
        const res = { status() { return this; }, json() { return this; } };
        await requireWriteAuthInClubMode(club({ role: 'device', tokenId: 7 }), res, (e) => { fejl = e; });
        assert.equal(fejl && fejl.message, 'db nede');
    } finally {
        _saetAdgangslinkOpslag(async (id) => id >= 1 && id < 100);
    }
});
