/**
 * Unit-tests af football-admin-sessioner (middleware/auth.js) — ingen database.
 *
 * JWT'en gælder 7 dage, og før blev kun signaturen tjekket: en slettet admin
 * eller en admin, hvis adgangskode super-admin havde nulstillet, beholdt adgangen.
 *
 * Kør: npm run test:unit
 */
process.env.JWT_SECRET = 'unit-test-football-hemmelighed-32-tegn!!';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signClubAdminToken, requireAdmin, kodeAftryk, _saetAdminOpslag } = require('../../middleware/auth');

// "Databasen": admin 1 i klub 2 med hash 'hash-1'
_saetAdminOpslag(async (adminId, clubId) => (adminId === 1 && clubId === 2 ? { password_hash: 'hash-1' } : null));

async function run(token, clubId = 2) {
  let status = 200, body = null, nexted = false, fejl = null;
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, clubId };
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  await requireAdmin(req, res, (e) => { if (e) fejl = e; else nexted = true; });
  return { status, body, nexted, fejl, req };
}

test('admin med gyldig session får adgang', async () => {
  const r = await run(signClubAdminToken({ adminId: 1, clubId: 2, clubSubdomain: 'demo', passwordHash: 'hash-1' }));
  assert.equal(r.nexted, true);
  assert.equal(r.req.admin.adminId, 1);
});

test('slettet admin afvises med 401 og sessionEnded', async () => {
  const r = await run(signClubAdminToken({ adminId: 5, clubId: 2, clubSubdomain: 'demo', passwordHash: 'hash-5' }));
  assert.equal(r.status, 401);
  assert.equal(r.body.sessionEnded, true);
});

test('nulstillet adgangskode gør gamle sessioner ugyldige', async () => {
  const r = await run(signClubAdminToken({ adminId: 1, clubId: 2, clubSubdomain: 'demo', passwordHash: 'gammel-hash' }));
  assert.equal(r.status, 401);
  assert.match(r.body.error, /Adgangskoden er ændret/);
});

test('tokens fra før rettelsen (uden fingeraftryk) skal logge ind igen', async () => {
  const gammel = jwt.sign({ role: 'club_admin', adminId: 1, clubId: 2, clubSubdomain: 'demo' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  assert.equal((await run(gammel)).status, 401);
});

test('token fra en anden klub afvises stadig med 403', async () => {
  const r = await run(signClubAdminToken({ adminId: 1, clubId: 2, clubSubdomain: 'demo', passwordHash: 'hash-1' }), 3);
  assert.equal(r.status, 403);
});

test('databasefejl går til fejlhåndteringen', async () => {
  _saetAdminOpslag(async () => { throw new Error('db nede'); });
  try {
    const r = await run(signClubAdminToken({ adminId: 1, clubId: 2, clubSubdomain: 'demo', passwordHash: 'hash-1' }));
    assert.equal(r.fejl.message, 'db nede');
  } finally {
    _saetAdminOpslag(async (adminId, clubId) => (adminId === 1 && clubId === 2 ? { password_hash: 'hash-1' } : null));
  }
});

test('fingeraftrykket afslører ikke hashen', () => {
  assert.equal(kodeAftryk('hash-1').length, 16);
  assert.notEqual(kodeAftryk('hash-1'), kodeAftryk('hash-2'));
});
