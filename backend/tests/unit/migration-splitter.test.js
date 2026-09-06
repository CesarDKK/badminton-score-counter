/**
 * Unit-tests af migrations-splitteren. Den kører ved hver opstart mod alle
 * klub-databaser, så en fejl her rammer bredt. Testene dækker både de kanter
 * det naive split(';') ikke kunne (DELIMITER, semikolon i strenge) og en
 * regressionstest af, at samtlige rigtige migrationsfiler parses fornuftigt.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { splitStatements } = require('../../config/migrationRunner');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

test('splitter simple statements på semikolon', () => {
    const r = splitStatements('CREATE TABLE a (id INT);\nINSERT INTO a VALUES (1);\n');
    assert.equal(r.length, 2);
    assert.match(r[0], /^CREATE TABLE/);
    assert.match(r[1], /^INSERT INTO/);
});

test('semikolon inde i en streng deler IKKE statementet', () => {
    const r = splitStatements("INSERT INTO t (a) VALUES ('x;y');");
    assert.equal(r.length, 1);
    assert.equal(norm(r[0]), "INSERT INTO t (a) VALUES ('x;y')");
});

test('semikolon i en kommentar deler ikke, og kommentaren følger med statementet', () => {
    const r = splitStatements('-- første; kommentar\nALTER TABLE t ADD c INT; /* mid; blok */ UPDATE t SET c = 1;');
    assert.equal(r.length, 2);
    assert.match(r[0], /ALTER TABLE t ADD c INT/);
    assert.match(r[1], /UPDATE t SET c = 1/);
});

test('escaped og fordoblede anførselstegn håndteres', () => {
    const r = splitStatements("INSERT INTO t VALUES ('it''s; ok'), ('a\\';b');");
    assert.equal(r.length, 1);
});

test('DELIMITER $$ holder en trigger samlet som ét statement', () => {
    const sql = `
INSERT INTO t (a) VALUES ('x;y');
DELIMITER $$
CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW BEGIN
  SET NEW.a = 'a;b'; SET NEW.b = 1;
END$$
DELIMITER ;
UPDATE t SET a = 1;`;
    const r = splitStatements(sql);
    assert.equal(r.length, 3, 'forventet INSERT, CREATE TRIGGER, UPDATE');
    assert.match(r[1], /^CREATE TRIGGER/);
    assert.match(r[1], /END$/);
    assert.match(r[2], /^UPDATE/);
});

test('USE-statements fjernes — også med en kommentar foran (regression: ellers skiftes der til forkert database)', () => {
    const r = splitStatements('-- Migration 006\nUSE badminton_counter;\nALTER TABLE g ADD x INT;');
    assert.equal(r.length, 1);
    assert.match(r[0], /^ALTER TABLE g/);
    assert.ok(r.every(s => !/USE\s+badminton/i.test(s)));
});

test('kommentar-only fragmenter og tomme statements filtreres væk', () => {
    const r = splitStatements('-- kun en kommentar\n;\n\n/* blok */;\nSELECT 1;');
    assert.deepEqual(r.map(norm), ['SELECT 1']);
});

test('ADD COLUMN IF NOT EXISTS omskrives (MySQL 8 kender ikke syntaksen)', () => {
    const r = splitStatements('ALTER TABLE t ADD COLUMN IF NOT EXISTS c INT;');
    assert.equal(r.length, 1);
    assert.doesNotMatch(r[0], /IF NOT EXISTS/i);
    assert.match(r[0], /ADD COLUMN c INT/);
});

test('alle rigtige migrationsfiler parses til mindst ét statement uden USE eller tomme fragmenter', () => {
    const filer = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    assert.ok(filer.length >= 25, `forventede migrationer i ${MIGRATIONS_DIR}, fandt ${filer.length}`);
    for (const f of filer) {
        const r = splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
        assert.ok(r.length >= 1, `${f}: ingen statements`);
        for (const s of r) {
            const uden = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim();
            assert.ok(uden.length > 0, `${f}: tomt statement`);
            assert.doesNotMatch(uden, /^USE\b/i, `${f}: USE slap igennem`);
        }
    }
});
