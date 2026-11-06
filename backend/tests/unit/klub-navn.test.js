/**
 * Unit-tests af config/klubNavn.js: hvilke subdomæner en klub må få, og hvilke
 * databaser "Slet klub" aldrig må droppe. Før kunne en klub oprettet som
 * "badminton-master" få master-databasen som sin egen — og "Slet klub" droppede den.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validerSubdomain, dbNavn, erBeskyttetDatabase } = require('../../config/klubNavn');

test('almindelige klubnavne godtages', () => {
    for (const navn of ['lyngby', 'aarhus-badminton', 'kbh2', 'abc', 'badminton', 'master', 'a'.repeat(63)]) {
        assert.equal(validerSubdomain(navn), null, navn);
    }
    assert.equal(dbNavn('aarhus-badminton'), 'aarhus_badminton');
});

test('navne, der ville give en systemdatabase som klubbens, afvises', () => {
    for (const navn of ['badminton-master', 'badminton-counter', 'football-tournament', 'mysql', 'sys',
        'information-schema', 'performance-schema']) {
        assert.match(validerSubdomain(navn), /reserveret/, navn);
    }
});

test('demoens database følger DB_NAME', () => {
    const foer = process.env.DB_NAME;
    process.env.DB_NAME = 'Min_Demo';
    try {
        assert.match(validerSubdomain('min-demo'), /reserveret/);
        assert.equal(erBeskyttetDatabase('min_demo'), true);
        assert.equal(validerSubdomain('badminton-counter'), null);   // ikke demoen på denne server
    } finally {
        if (foer === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = foer;
    }
});

test('adresser, serveren selv bruger, og optagne mapper/nøgler afvises', () => {
    for (const navn of ['app', 'api', 'admin', 'www', 'mail', 'statistik', 'planner', 'local', 'direct', 'central-logos']) {
        assert.match(validerSubdomain(navn), /reserveret/, navn);
    }
});

test('formatet: små bogstaver, tal og bindestreg — ikke bindestreg først eller sidst, højst 63 tegn', () => {
    for (const navn of ['', '-lyngby', 'lyngby-', 'Lyngby', 'lyngby_bk', 'lyn gby', 'lyngby.dk', 'æble', 'a`b',
        'a'.repeat(64), null, undefined, 42, ['lyngby']]) {
        assert.match(String(validerSubdomain(navn)), /små bogstaver/, String(navn));
    }
});

test('erBeskyttetDatabase: systemdatabaser og tomme navne slettes aldrig', () => {
    for (const db of ['badminton_master', 'BADMINTON_MASTER', 'badminton_counter', 'football_tournament',
        'mysql', 'sys', 'information_schema', 'performance_schema', '', null, undefined]) {
        assert.equal(erBeskyttetDatabase(db), true, String(db));
    }
    for (const db of ['lyngby', 'aarhus_badminton', 'badminton_master2']) {
        assert.equal(erBeskyttetDatabase(db), false, db);
    }
});

test('masterDatabase.createClubDatabase nægter en systemdatabase, før den forbinder', async () => {
    const masterDb = require('../../config/masterDatabase');
    try {
        for (const db of ['badminton_master', 'badminton_counter', 'mysql', 'a`; DROP DATABASE x; --', '']) {
            await assert.rejects(masterDb.createClubDatabase(db), (e) => e.kode === 'DATABASE_FINDES', db);
        }
    } finally {
        await masterDb.pool.end().catch(() => {});
    }
});
