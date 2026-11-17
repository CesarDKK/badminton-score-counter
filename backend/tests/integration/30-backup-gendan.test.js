/**
 * Backup → gendan (nr. 56) gennem super-admins API, mod rigtig MySQL og disk:
 *  - rundtur med rækker og en uploadet sponsorfil
 *  - en backup fra en anden klub giver 409 anden_klub
 *  - en backup uden de nyeste data-migrationer får dem kørt (config/dataMigrationer.js)
 *  - adgangslinkene (device_tokens) følger ikke med: klubbens nuværende bevares,
 *    og en ældre backup med links i gendannes uden dem
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { kald, rodQuery, superToken, opretKlub, ADMIN_HOST } = require('./faelles');

let C, D, superT, billede;

const filSti = (klub, filnavn) => {
    const kandidater = [path.join(process.env.UPLOAD_DIR, klub.db, path.basename(filnavn)), path.join(process.env.UPLOAD_DIR, filnavn)];
    return kandidater.find(s => fs.existsSync(s)) || kandidater[0];
};
const hentBackup = async (klub) => {
    const r = await kald(`/api/super-admin/clubs/${klub.id}/backup`, { host: ADMIN_HOST, token: superT });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    return r.body;
};
const gendan = (klub, backup) => kald(`/api/super-admin/clubs/${klub.id}/restore`, {
    method: 'POST', host: ADMIN_HOST, token: superT,
    body: { multipart: { felt: 'backup', filnavn: 'backup.json', type: 'application/json', data: JSON.stringify(backup) } }
});
const kampe = async (klub) => (await rodQuery(klub.db, 'SELECT winner_name FROM match_history ORDER BY id')).map(r => r.winner_name);
const links = async (klub) => (await rodQuery(klub.db, "SELECT name FROM device_tokens WHERE token_type <> 'match_session' ORDER BY id")).map(r => r.name);

before(async () => {
    superT = await superToken();
    C = await opretKlub('backupc', 'Backup C');
    D = await opretKlub('backupd', 'Backup D');
    billede = await require('sharp')({ create: { width: 64, height: 36, channels: 3, background: '#336699' } }).png().toBuffer();
});

test('Backup → gendan: rækker og den uploadede fil kommer tilbage; ændringer efter backuppen forsvinder', async () => {
    await rodQuery(C.db, "INSERT INTO match_history (court_id, winner_name, loser_name, games_won, duration) VALUES (1, 'Før backup', 'Taber', '2-0', '20:00')");
    await rodQuery(C.db, "INSERT INTO player_info (name, club, gender, age_group) VALUES ('Spiller i backup', 'Backup C', 'Dame', 'U11')");
    const up = await kald('/api/sponsors/upload', {
        method: 'POST', host: C.host, token: C.adminToken,
        body: { multipart: { felt: 'images', filnavn: 'sponsor.png', type: 'image/png', data: billede } }
    });
    assert.ok([200, 201].includes(up.status), `upload: ${up.status} ${JSON.stringify(up.body)}`);
    const [sponsor] = await rodQuery(C.db, 'SELECT id, filename FROM sponsor_images');
    assert.ok(sponsor, 'sponsorrækken er gemt');
    const sti = filSti(C, sponsor.filename);
    const indhold = fs.readFileSync(sti);

    const backup = await hentBackup(C);
    assert.equal(backup.clubDbName, C.db);
    assert.ok(Object.keys(backup.files || {}).length >= 1, 'filen er med i backuppen');
    assert.equal(backup.tables.device_tokens, undefined, 'adgangslinkene er ikke med');

    // Efter backuppen: kampen slettes, en ny kommer til, billedet (række + fil) forsvinder
    await rodQuery(C.db, "DELETE FROM match_history WHERE winner_name = 'Før backup'");
    await rodQuery(C.db, "INSERT INTO match_history (court_id, winner_name, loser_name, games_won, duration) VALUES (1, 'Efter backup', 'Taber', '2-1', '30:00')");
    await rodQuery(C.db, 'DELETE FROM sponsor_images');
    fs.rmSync(sti);

    const g = await gendan(C, backup);
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.deepEqual(await kampe(C), ['Før backup']);
    assert.equal((await rodQuery(C.db, "SELECT COUNT(*) AS n FROM player_info WHERE name = 'Spiller i backup'"))[0].n, 1);
    const [igen] = await rodQuery(C.db, 'SELECT filename FROM sponsor_images');
    assert.equal(igen && igen.filename, sponsor.filename);
    assert.deepEqual(fs.readFileSync(filSti(C, igen.filename)), indhold, 'filen er tilbage, byte for byte');
});

test('Gendan: en backup fra en anden klub afvises med 409 anden_klub, og intet ændres', async () => {
    await rodQuery(D.db, "INSERT INTO match_history (court_id, winner_name, loser_name, games_won, duration) VALUES (1, 'Klub D', 'Taber', '2-0', '20:00')");
    const fraD = await hentBackup(D);
    const foer = await kampe(C);
    const g = await gendan(C, fraD);
    assert.equal(g.status, 409);
    assert.equal(g.body.code, 'anden_klub');
    assert.deepEqual(await kampe(C), foer);
});

test('Gendan: adgangslinkene følger ikke med — de nuværende bevares, en ældre backups links gendannes ikke', async () => {
    const opret = (navn) => kald('/api/device-tokens', {
        method: 'POST', host: C.host, token: C.adminToken, body: { name: navn, destination: 'court/1', locked: true }
    });
    assert.equal((await opret('Link før backup')).status, 201);
    const backup = await hentBackup(C);
    assert.equal((await opret('Link efter backup')).status, 201);

    // Som en backup fra før nr. 47, med adgangslinkene i
    backup.tables.device_tokens = [{ id: 9999, token: 'gammel-backup-token', name: 'Link fra gammel backup', destination: 'court/1', locked: 1, is_active: 1 }];
    const g = await gendan(C, backup);
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.deepEqual(await links(C), ['Link før backup', 'Link efter backup']);
    assert.equal((await rodQuery(C.db, "SELECT COUNT(*) AS n FROM device_tokens WHERE token = 'gammel-backup-token'"))[0].n, 0);
});

test('Gendan: en backup uden de nyeste data-migrationer får dem kørt (043: det gamle lilla standardtema → Skifer)', async () => {
    const LILLA = { color_primary: '#533483', color_accent: '#e94560', color_bg_dark: '#1a1a2e', color_bg_container: '#16213e', color_bg_card: '#252347' };
    const farver = async () => Object.fromEntries((await rodQuery(C.db,
        "SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'color_%' AND setting_key IN ('color_primary','color_accent','color_bg_dark','color_bg_container','color_bg_card')"))
        .map(r => [r.setting_key, r.setting_value.toLowerCase()]));
    const lilla = (backup) => {
        for (const r of backup.tables.settings) if (r.setting_key in LILLA) r.setting_value = LILLA[r.setting_key];
        return backup;
    };

    // Kontrol: backuppen har kørt 043 → farverne gendannes, som de er
    const ny = lilla(await hentBackup(C));
    assert.ok(ny.migrationer.includes('043_ny_standard_skifer.sql'));
    const g1 = await gendan(C, ny);
    assert.equal(g1.status, 200, JSON.stringify(g1.body));
    assert.deepEqual(g1.body.dataMigrationer, []);
    assert.equal((await farver()).color_primary, '#533483');

    // Backup fra før 043: migrationen køres på de gendannede rækker
    const gammel = lilla(await hentBackup(C));
    gammel.migrationer = gammel.migrationer.filter(f => f < '043');
    gammel.migration = gammel.migrationer[gammel.migrationer.length - 1];
    const g2 = await gendan(C, gammel);
    assert.equal(g2.status, 200, JSON.stringify(g2.body));
    assert.ok(g2.body.dataMigrationer.includes('043_ny_standard_skifer.sql'), JSON.stringify(g2.body.dataMigrationer));
    const efter = await farver();
    assert.equal(efter.color_primary, '#4a5c6a');
    assert.equal(efter.color_bg_dark, '#11212d');
});
