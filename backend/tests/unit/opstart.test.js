/**
 * Unit-tests af backendens opstart-status (config/opstart.js) og af, hvad
 * migrationskøreren husker til super-admin (config/migrationRunner.js).
 * Ingen database.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const opstart = require('../../config/opstart');
const migrationRunner = require('../../config/migrationRunner');

const NU = 1_800_000_000_000;

beforeEach(() => { opstart._nulstil(NU); migrationRunner._nulstilStatus(); });

test('ikke klar, før opstarten er lykkedes — med antal forsøg og seneste fejl', () => {
    assert.equal(opstart.erKlar(), false);
    opstart.forsoeg();
    opstart.fejlede('connect ECONNREFUSED 172.18.0.2:3306');
    opstart.forsoeg();
    const s = opstart.status(null, NU + 100_000);
    assert.equal(s.klar, null);
    assert.equal(s.klarEfterSek, null);
    assert.equal(s.forsoeg, 2);
    assert.equal(s.fejl, 'connect ECONNREFUSED 172.18.0.2:3306');
    assert.equal(s.koertSek, 100);
});

test('klar: fejlen ryddes, og tiden til klar huskes', () => {
    opstart.forsoeg();
    opstart.fejlede('databasen svarer ikke');
    opstart.forsoeg();
    opstart.nuKlar(NU + 95_000);
    assert.equal(opstart.erKlar(), true);
    const s = opstart.status({ antal: 3, medFejl: 0, databaser: [] }, NU + 3_600_000);
    assert.equal(s.klarEfterSek, 95);
    assert.equal(s.fejl, null);
    assert.equal(s.forsoeg, 2);
    assert.equal(s.koertSek, 3600);
    assert.deepEqual(s.migrationer, { antal: 3, medFejl: 0, databaser: [] });
    assert.equal(s.startet, new Date(NU).toISOString());
});

test('en database, der ikke kan nås, huskes med fejlen — og kaster, så opstarten kan prøve igen', async () => {
    // Ingen database på denne adresse: forbindelsen afvises med det samme
    const gamle = { host: process.env.DB_HOST, port: process.env.DB_PORT };
    process.env.DB_HOST = '127.0.0.1';
    process.env.DB_PORT = '1';
    try {
        await assert.rejects(migrationRunner.runMigrationsForDatabase('klub_uden_database'));
    } finally {
        if (gamle.host === undefined) delete process.env.DB_HOST; else process.env.DB_HOST = gamle.host;
        if (gamle.port === undefined) delete process.env.DB_PORT; else process.env.DB_PORT = gamle.port;
    }
    const r = migrationRunner.statusFor('klub_uden_database');
    assert.equal(r.koert, 0);
    assert.equal(r.fejl.length, 1);
    assert.equal(r.fejl[0].fil, null);
    assert.match(r.fejl[0].besked, /^Databasen kunne ikke nås: /);
    assert.deepEqual(migrationRunner.status().databaser.map(d => d.db), ['klub_uden_database']);
    assert.equal(migrationRunner.status().medFejl, 1);
    assert.equal(migrationRunner.statusFor('en_anden'), null);
});
