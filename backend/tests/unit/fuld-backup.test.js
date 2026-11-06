/**
 * Unit-tests af status for den fulde backup (config/fuldBackup.js): hvornår
 * super-admin skal advare. Ingen database, ingen filer.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { vurder } = require('../../config/fuldBackup');

const NU = Date.UTC(2026, 10, 6, 9, 0);
const TIME = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');   // som scriptets date -u
const status = (felter = {}) => ({
    tid: iso(NU - 6 * TIME), ok: true, fejl: null, uploadsOk: true,
    senesteGode: iso(NU - 6 * TIME), senesteGodeBytes: 48_000_000, antal: 14, intervalTimer: 24, beholdDage: 14, ...felter
});

test('en god backup i nat: ingen advarsel', () => {
    const s = vurder(status(), NU);
    assert.equal(s.opsat, true);
    assert.equal(s.ok, true);
    assert.equal(s.niveau, null);
    assert.equal(s.besked, null);
    assert.equal(s.senesteGodeBytes, 48_000_000);
    assert.equal(s.antal, 14);
});

test('ingen statusfil (mappen ikke monteret, eller første kørsel ikke færdig)', () => {
    assert.deepEqual(vurder(null, NU), { opsat: false });
    assert.deepEqual(vurder({}, NU), { opsat: false });
    assert.deepEqual(vurder({ tid: 'ikke en dato' }, NU), { opsat: false });
});

test('seneste kørsel fejlede: advarsel med fejlen — den gode fra i går tæller stadig', () => {
    const s = vurder(status({ ok: false, fejl: 'mysqldump fejlede: Access denied', senesteGode: iso(NU - 30 * TIME) }), NU);
    assert.equal(s.niveau, 'advarsel');
    assert.equal(s.besked, 'Den seneste kørsel fejlede');
    assert.equal(s.fejl, 'mysqldump fejlede: Access denied');
});

test('ingen god backup i tre døgn — eller slet ingen: kritisk', () => {
    const gammel = vurder(status({ ok: false, fejl: 'x', senesteGode: iso(NU - 80 * TIME) }), NU);
    assert.equal(gammel.niveau, 'kritisk');
    assert.equal(gammel.besked, 'Den seneste gode backup er 80 timer gammel');
    const ingen = vurder(status({ ok: false, fejl: 'x', senesteGode: null, antal: 0 }), NU);
    assert.equal(ingen.niveau, 'kritisk');
    assert.equal(ingen.besked, 'Der findes ingen god backup');
    assert.equal(ingen.senesteGode, null);
});

test('backup-tjenesten er holdt op med at køre: status er gammel', () => {
    const s = vurder(status({ tid: iso(NU - 40 * TIME), senesteGode: iso(NU - 40 * TIME) }), NU);
    assert.equal(s.niveau, 'advarsel');
    assert.equal(s.besked, 'Backup-tjenesten har ikke kørt i 40 timer');
    // Inden for halvandet interval er det ikke en advarsel (kørslen tager lidt tid)
    assert.equal(vurder(status({ tid: iso(NU - 30 * TIME), senesteGode: iso(NU - 30 * TIME) }), NU).niveau, null);
});

test('billederne kunne ikke arkiveres: advarsel, selv om dumpen er god', () => {
    const s = vurder(status({ uploadsOk: false }), NU);
    assert.equal(s.niveau, 'advarsel');
    assert.match(s.besked, /billederne/);
    // Ingen billedmappe monteret (null) er ikke en fejl
    assert.equal(vurder(status({ uploadsOk: null }), NU).niveau, null);
});

test('et andet interval end 24 timer flytter grænserne med', () => {
    const hver6 = status({ intervalTimer: 6, tid: iso(NU - 10 * TIME), senesteGode: iso(NU - 10 * TIME) });
    assert.equal(vurder(hver6, NU).niveau, 'advarsel');                 // over 9 timer siden sidste kørsel
    assert.equal(vurder({ ...hver6, senesteGode: iso(NU - 20 * TIME) }, NU).niveau, 'kritisk');   // over 18 timer
});
