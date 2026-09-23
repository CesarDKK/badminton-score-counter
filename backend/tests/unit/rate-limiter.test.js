/**
 * Unit-tests af login-grænserne — ingen database, en lille express-app på en tilfældig port.
 *
 * Før talte grænsen på req.ip med 'trust proxy: true', dvs. den første adresse i
 * X-Forwarded-For, som klienten selv skriver. "X-Forwarded-For: 10.0.0.1" slap helt
 * (lokalt net), og en ny tilfældig adresse pr. forsøg gav en ny tæller.
 *
 * Kør: npm run test:unit
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { loginLimiter, superAdminLoginLimiter, klientIp, erLokaltNet } = require('../../middleware/rateLimiter');

const req = (headers) => ({ headers, socket: { remoteAddress: '::ffff:172.18.0.9' } });

test('klientIp: Cloudflares CF-Connecting-IP først', () => {
    assert.equal(klientIp(req({ 'cf-connecting-ip': '203.0.113.7', 'x-real-ip': '172.18.0.2' })), '203.0.113.7');
});

test('klientIp: uden Cloudflare bruges nginx\' X-Real-IP, ellers forbindelsen', () => {
    assert.equal(klientIp(req({ 'x-real-ip': '192.168.1.20' })), '192.168.1.20');
    assert.equal(klientIp(req({})), '172.18.0.9');
});

test('klientIp: X-Forwarded-For (som klienten selv skriver) bruges ikke', () => {
    assert.equal(klientIp(req({ 'x-forwarded-for': '10.0.0.1', 'cf-connecting-ip': '203.0.113.7' })), '203.0.113.7');
    assert.equal(klientIp(req({ 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
});

test('erLokaltNet: en tablet på klubbens LAN (lokal installation) fritages', () => {
    assert.equal(erLokaltNet(req({ 'x-real-ip': '192.168.1.20' })), true);
    assert.equal(erLokaltNet(req({ 'x-real-ip': '127.0.0.1' })), true);
});

test('erLokaltNet: bag Cloudflare fritages ingen — heller ikke en "privat" CF-Connecting-IP', () => {
    assert.equal(erLokaltNet(req({ 'cf-connecting-ip': '10.0.0.1' })), false);
    assert.equal(erLokaltNet(req({ 'cf-connecting-ip': '203.0.113.7' })), false);
});

test('erLokaltNet: X-Forwarded-For: 10.0.0.1 giver ikke fritagelse', () => {
    assert.equal(erLokaltNet(req({ 'x-forwarded-for': '10.0.0.1', 'x-real-ip': '198.51.100.4' })), false);
});

// ── Grænserne i brug ─────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', false);
app.post('/login', loginLimiter, (r, s) => s.json({ ok: true }));
app.post('/super-admin/login', superAdminLoginLimiter, (r, s) => s.json({ ok: true }));
const server = app.listen(0);
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;
after(() => server.close());

async function forsoeg(path, n, headers) {
    const koder = [];
    for (let i = 0; i < n; i++) {
        const h = typeof headers === 'function' ? headers(i) : headers;
        koder.push((await fetch(url(path), { method: 'POST', headers: h })).status);
    }
    return koder;
}

test('login: 10 forsøg, så 429 — også når klienten skifter X-Forwarded-For hver gang', async () => {
    const koder = await forsoeg('/login', 12, (i) => ({ 'cf-connecting-ip': '203.0.113.50', 'x-forwarded-for': `10.0.0.${i}` }));
    assert.deepEqual(koder.slice(0, 10), Array(10).fill(200));
    assert.deepEqual(koder.slice(10), [429, 429]);
});

test('login: en anden klient har sin egen tæller', async () => {
    const [kode] = await forsoeg('/login', 1, { 'cf-connecting-ip': '203.0.113.51' });
    assert.equal(kode, 200);
});

test('super-admin-login: 5 forsøg, så 429', async () => {
    const koder = await forsoeg('/super-admin/login', 6, { 'cf-connecting-ip': '203.0.113.60' });
    assert.deepEqual(koder, [200, 200, 200, 200, 200, 429]);
});

test('super-admin-login: ingen fritagelse for lokalt net', async () => {
    const koder = await forsoeg('/super-admin/login', 6, { 'x-real-ip': '192.168.1.99' });
    assert.equal(koder[5], 429);
});
