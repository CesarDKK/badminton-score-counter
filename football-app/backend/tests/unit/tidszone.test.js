/**
 * Nr. 90e: football-puljen kører i UTC som badminton-backendens.
 * Ingen database — puljen forbinder først ved første kald.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('puljen fortolker UTC og sætter time_zone UTC på hver ny forbindelse', () => {
  const { pool } = require('../../db');
  assert.equal(pool.pool.config.connectionConfig.timezone, '+00:00');
  const lyttere = pool.listeners('connection');
  assert.equal(lyttere.length, 1);
  const sendt = [];
  lyttere[0]({ query: (sql) => sendt.push(sql) });
  assert.deepEqual(sendt, ["SET time_zone = '+00:00'"]);
});

test('alle football-tidspunkter er TIMESTAMP, som MySQL selv skriver — intet gemt flyttes af UTC-sessionen', () => {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'init.sql'), 'utf8');
  assert.doesNotMatch(sql, /\bDATETIME\b/i, 'en DATETIME-kolonne ville gemme vægur og flytte sig med sessionen');
  // Ingen rute skriver et JS-tidspunkt i databasen (kun NOW()/CURRENT_TIMESTAMP)
  const ruter = path.join(__dirname, '..', '..', 'routes');
  for (const f of fs.readdirSync(ruter)) {
    const tekst = fs.readFileSync(path.join(ruter, f), 'utf8');
    assert.doesNotMatch(tekst, /new Date\(/, `routes/${f}`);
  }
});
