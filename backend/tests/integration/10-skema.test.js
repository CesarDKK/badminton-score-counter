/**
 * Skemaet (nr. 56): master + standarddatabasen + en ny klub er bygget fra en
 * helt tom MySQL (koer.js: init.master.sql / init.sql, backendens opstart kører
 * migrationerne, klubben oprettes via super-admin). Alle migrationer er kørt
 * uden fejl, og en kørsel nummer to ændrer intet og fejler ikke.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rodQuery, opretKlub } = require('./faelles');

const MIGRATIONER = fs.readdirSync(path.join(__dirname, '..', '..', 'migrations')).filter(f => f.endsWith('.sql')).sort();

// Skemaet som tekst: tabeller, kolonner (type, null, standard, extra) og indeks
async function skema(db) {
    const kolonner = await rodQuery(null,
        `SELECT table_name AS t, column_name AS c, column_type AS ty, is_nullable AS n,
                column_default AS d, extra AS e
           FROM information_schema.columns WHERE table_schema = ? ORDER BY t, c`, [db]);
    const indeks = await rodQuery(null,
        `SELECT table_name AS t, index_name AS i, non_unique AS u,
                GROUP_CONCAT(column_name ORDER BY seq_in_index) AS k
           FROM information_schema.statistics WHERE table_schema = ?
          GROUP BY table_name, index_name, non_unique ORDER BY t, i`, [db]);
    return {
        kolonner: kolonner.map(r => `${r.t}.${r.c} ${r.ty} ${r.n} ${r.d} ${r.e}`),
        indeks: indeks.map(r => `${r.t}.${r.i} ${r.u} (${r.k})`),
    };
}

const koerte = async (db) => (await rodQuery(db, 'SELECT filename FROM migrations ORDER BY filename')).map(r => r.filename);

let klub;
test('Skema: en ny klub bygges med init.sql og alle migrationer, uden fejl', async () => {
    klub = await opretKlub('skema', 'Skemaklub');   // kaster, hvis en migration fejlede
    assert.deepEqual(await koerte(klub.db), MIGRATIONER);
});

test('Skema: standarddatabasen har kørt alle migrationer ved opstarten', async () => {
    assert.deepEqual(await koerte('badminton_counter'), MIGRATIONER);
});

test('Skema: en ny klub og standarddatabasen har samme skema', async () => {
    const a = await skema('badminton_counter');
    const b = await skema(klub.db);
    assert.deepEqual(b.kolonner, a.kolonner);
    assert.deepEqual(b.indeks, a.indeks);
    assert.ok(a.kolonner.length > 100, `forventede et fuldt skema, fik ${a.kolonner.length} kolonner`);
});

test('Skema: migrationerne kørt en gang til — intet køres, intet fejler, skemaet er uændret', async () => {
    const { runMigrationsForDatabase, runMigrationsForAllDatabases } = require('../../config/migrationRunner');
    const foer = { std: await skema('badminton_counter'), klub: await skema(klub.db), master: await skema('badminton_master') };

    for (const db of ['badminton_counter', klub.db]) {
        const r = await runMigrationsForDatabase(db);
        assert.equal(r.koert, 0, `${db}: ingen migration må køres igen`);
        assert.deepEqual(r.fejl, [], `${db}: ingen fejl`);
    }
    // Som en genstart af backenden: standarddatabasen + alle klubber fra master
    const status = await runMigrationsForAllDatabases();
    assert.equal(status.medFejl, 0, JSON.stringify(status.databaser));
    // Master-databasens opstart (kolonner tilføjes kun, hvis de mangler)
    await require('../../config/masterDatabase').initialize();

    assert.deepEqual(await skema('badminton_counter'), foer.std);
    assert.deepEqual(await skema(klub.db), foer.klub);
    assert.deepEqual(await skema('badminton_master'), foer.master);
    assert.deepEqual(await koerte(klub.db), MIGRATIONER);
});

test.after(async () => {
    await require('../../config/masterDatabase').pool.end().catch(() => {});
});
