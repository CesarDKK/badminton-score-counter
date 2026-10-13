/**
 * Unit-tests af enhedens session og adresse for et adgangslink — det, /t/:token
 * og /api/device-tokens/mit/skift (redigeret link) udleverer. Ingen database.
 *
 * Kør: npm run test:unit
 */
process.env.JWT_SECRET = 'unit-test-secret-mindst-32-tegn-aaaaaaaa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { adgangslinkSession } = require('../../middleware/adgangslinkSession');

const link = (felter) => ({ id: 7, locked: 1, token_type: 'permanent', show_qr_on_tv: 1, ...felter });
const dage = (p) => Math.round((p.exp - p.iat) / 86400);

function adresse(url) {
    const u = new URL(url, 'https://lyngby.badmintonapp.dk');
    return { sti: u.pathname, q: Object.fromEntries(u.searchParams) };
}

test('TV-link: tv-siden med bane og QR-valg, session i 180 dage', () => {
    const { url, sessionToken } = adgangslinkSession(link({ destination: 'tv/3', show_qr_on_tv: 0 }), 'lyngby');
    const a = adresse(url);
    assert.equal(a.sti, '/tv-v3.html');
    assert.equal(a.q.court, '3');
    assert.equal(a.q.qr, '0');
    assert.equal(a.q.dt, sessionToken);
    const p = jwt.verify(sessionToken, process.env.JWT_SECRET);
    assert.equal(p.role, 'device');
    assert.equal(p.tokenId, 7);
    assert.equal(p.destination, 'tv/3');
    assert.equal(p.clubSubdomain, 'lyngby');
    assert.equal(p.tokenType, 'permanent');
    assert.equal(dage(p), 180);
});

test('tablet-link: tællersiden, session i 14 dage, intet QR-flag', () => {
    const { url, sessionToken } = adgangslinkSession(link({ destination: 'court/2' }), 'lyngby');
    const a = adresse(url);
    assert.equal(a.sti, '/court-v3.html');
    assert.equal(a.q.court, '2');
    assert.equal(a.q.qr, undefined);
    assert.equal(dage(jwt.decode(sessionToken)), 14);
});

test('oversigt-link: oversigten, session i 180 dage', () => {
    const { url, sessionToken } = adgangslinkSession(link({ destination: 'oversigt' }), 'lyngby');
    assert.equal(adresse(url).sti, '/oversigt.html');
    assert.equal(dage(jwt.decode(sessionToken)), 180);
});

test('QR-tæller (match_session): kortlivet session på 12 timer', () => {
    const { sessionToken } = adgangslinkSession(link({ destination: 'court/1', token_type: 'match_session' }), 'lyngby');
    const p = jwt.decode(sessionToken);
    assert.equal(p.tokenType, 'match_session');
    assert.equal(p.exp - p.iat, 12 * 3600);
});

test('låsningen følger med i sessionen', () => {
    const fri = jwt.decode(adgangslinkSession(link({ destination: 'tv/1', locked: 0 }), 'x').sessionToken);
    assert.equal(fri.locked, 0);
});
