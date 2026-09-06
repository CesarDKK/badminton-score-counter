/**
 * Unit-tests af diskcachen — især anti-forgiftningen: et tomt resultat må aldrig
 * fortrænge gode data, og tomme resultater holder kun kort.
 * Bruger en midlertidig mappe; CACHE_DIR sættes FØR modulet indlæses.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-cache-'));
process.env.CACHE_DIR = DIR;
process.env.CACHE_TTL_HOURS = '24';
process.env.CACHE_EMPTY_TTL_HOURS = '1';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../../cache');

after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const GODT = { klub: 'Lyngby', clubId: '1', season: '2025', hold: [{ navn: 'Lyngby 1' }], kampe: [], deltagelser: [] };
const TOMT = { klub: 'Lyngby', clubId: '1', season: '2025', hold: [], kampe: [], deltagelser: [] };

// Skriver en cachefil direkte med et bagdateret tidsstempel
function skrivMedAlder(clubId, season, raw, timerGammel, version = cache.DATA_VERSION) {
    const hentet = new Date(Date.now() - timerGammel * 3600 * 1000).toISOString();
    const p = path.join(DIR, `klub-${clubId}-${season}.json`);
    fs.writeFileSync(p, JSON.stringify({ ...raw, version, hentet }), 'utf8');
}

test('ingen cache → laes giver null', () => {
    assert.equal(cache.laes('42', '2025'), null);
});

test('skriv + laes: friske data returneres med frisk=true', () => {
    cache.skriv('1', '2025', GODT);
    const r = cache.laes('1', '2025');
    assert.ok(r);
    assert.equal(r.frisk, true);
    assert.equal(r.data.hold.length, 1);
    assert.equal(r.data.version, cache.DATA_VERSION);
});

test('anti-forgiftning: et tomt resultat overskriver IKKE gode data', () => {
    cache.skriv('2', '2025', GODT);
    const r = cache.skriv('2', '2025', TOMT);
    assert.equal(r.hold.length, 1, 'de gode data beholdes');
    assert.equal(cache.laes('2', '2025').data.hold.length, 1);
});

test('tomt resultat gemmes, når der ikke er gode data i forvejen (undgår hente-løkke)', () => {
    const r = cache.skriv('3', '2025', TOMT);
    assert.equal(r.hold.length, 0);
    assert.ok(cache.laes('3', '2025'));
});

test('tomt resultat er forældet efter 1 time, gode data holder 24', () => {
    skrivMedAlder('4', '2025', TOMT, 2);
    assert.equal(cache.laes('4', '2025').frisk, false, 'tomt, 2 timer gammelt → forældet');
    skrivMedAlder('5', '2025', GODT, 2);
    assert.equal(cache.laes('5', '2025').frisk, true, 'godt, 2 timer gammelt → stadig frisk');
    skrivMedAlder('6', '2025', GODT, 30);
    assert.equal(cache.laes('6', '2025').frisk, false, 'godt, 30 timer gammelt → forældet');
});

test('en fil med gammel DATA_VERSION regnes som forældet, men serveres stadig', () => {
    skrivMedAlder('7', '2025', GODT, 0, cache.DATA_VERSION - 1);
    const r = cache.laes('7', '2025');
    assert.ok(r, 'data serveres');
    assert.equal(r.frisk, false);
});

test('ugyldige tegn i id/sæson skrælles af filnavnet', () => {
    cache.skriv('9../x', '2025;', GODT);
    assert.ok(fs.existsSync(path.join(DIR, 'klub-9-2025.json')));
});
