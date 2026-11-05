/**
 * Pausens sekundtal, når uret tæller (routes/gameStates.js pauseSekunderTilbage).
 * Tabletten gemmer selv sekundtallet hvert 10. sekund; urets vej gemmer kun
 * pausens start, så serveren regner resten ud — ellers stod pausen på 60, og
 * TV'et begyndte forfra ved ca. 20 sek. tilbage.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-til-ur-pause';
const { pauseSekunderTilbage } = require('../../routes/gameStates');

const START = 1793872800000;
const urRaekke = (ekstra = {}) => ({
    rest_break_active: 1, rest_break_seconds_left: 60, rest_break_duration: 60,
    rest_break_started_at: START, tryk_taeller: 'aaaa', taeller_id: 'aaaa', ...ekstra
});

test('uret tæller: sekundtallet regnes ud fra pausens start', () => {
    assert.equal(pauseSekunderTilbage(urRaekke(), START), 60);
    assert.equal(pauseSekunderTilbage(urRaekke(), START + 40 * 1000), 20);
    assert.equal(pauseSekunderTilbage(urRaekke(), START + 40 * 1000 + 300), 20, 'rundes op');
    assert.equal(pauseSekunderTilbage(urRaekke(), START + 90 * 1000), 0, 'aldrig under 0');
    assert.equal(pauseSekunderTilbage(urRaekke(), START - 5000), 60, 'aldrig over pausens længde');
    // Sætpausen (2 min)
    assert.equal(pauseSekunderTilbage(urRaekke({ rest_break_duration: 120, rest_break_seconds_left: 120 }), START + 30 * 1000), 90);
});

test('tabletten tæller: det gemte sekundtal bruges uændret', () => {
    // En tablet har overtaget tællingen fra uret
    assert.equal(pauseSekunderTilbage(urRaekke({ taeller_id: 'bbbb', rest_break_seconds_left: 37 }), START + 40 * 1000), 37);
    // Uret har aldrig talt på banen
    assert.equal(pauseSekunderTilbage(urRaekke({ tryk_taeller: null, taeller_id: 'bbbb', rest_break_seconds_left: 50 }), START + 40 * 1000), 50);
    // Ingen pause / ingen starttid
    assert.equal(pauseSekunderTilbage(urRaekke({ rest_break_active: 0, rest_break_seconds_left: 0 }), START + 40 * 1000), 0);
    assert.equal(pauseSekunderTilbage(urRaekke({ rest_break_started_at: null }), START + 40 * 1000), 60);
});
