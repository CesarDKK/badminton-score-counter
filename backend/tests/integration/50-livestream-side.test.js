/**
 * Nr. 21a: Livestream har sin egen side-rettighed ('livestream').
 *  - migration 053 giver den til alle med 'devicetokens' i en begrænset liste
 *    (ingen mister adgang ved deployet); NULL (alle sider) er urørt
 *  - derefter er de to sider adskilt: 'livestream' åbner Livestream, ikke
 *    Adgangslinks, og omvendt
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { kald, rodQuery, superToken, opretKlub, ADMIN_HOST } = require('./faelles');

let K, superT;
const MIG = '053_livestream_side.sql';

async function nyAdmin(navn, pagePermissions) {
    const kode = 'test-kode-' + navn;
    const r = await kald(`/api/super-admin/clubs/${K.id}/admins`, {
        method: 'POST', host: ADMIN_HOST, token: superT, body: { username: navn, password: kode, pagePermissions }
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const l = await kald('/api/club-admin/login', { method: 'POST', host: K.host, body: { username: navn, password: kode } });
    assert.equal(l.status, 200, JSON.stringify(l.body));
    return l.body.token;
}

before(async () => {
    superT = await superToken();
    K = await opretKlub('livestreamside', 'Livestreamklub');
});

test('21a: migration 053 giver livestream til dem med devicetokens — og kun dem', async () => {
    const raekker = [
        ['m-links', '["devicetokens"]', ['devicetokens', 'livestream']],
        ['m-links-hist', '["history","devicetokens"]', ['history', 'devicetokens', 'livestream']],
        ['m-hist', '["history"]', ['history']],
        ['m-alle', null, null],
        ['m-har', '["devicetokens","livestream"]', ['devicetokens', 'livestream']],
        ['m-ugyldig', 'ikke json', 'ikke json'],
    ];
    for (const [navn, perms] of raekker) {
        await rodQuery(K.db, "INSERT INTO club_admins (username, password_hash, page_permissions) VALUES (?, 'x', ?)", [navn, perms]);
    }
    // Som en klub, der får migrationen ved deployet
    await rodQuery(K.db, 'DELETE FROM migrations WHERE filename = ?', [MIG]);
    const r = await require('../../config/migrationRunner').runMigrationsForDatabase(K.db);
    assert.deepEqual(r.fejl, []);
    assert.equal(r.koert, 1);

    for (const [navn, , forventet] of raekker) {
        const [row] = await rodQuery(K.db, 'SELECT page_permissions AS p FROM club_admins WHERE username = ?', [navn]);
        const faktisk = row.p === null ? null : (forventet === 'ikke json' ? row.p : JSON.parse(row.p));
        assert.deepEqual(faktisk, forventet, navn);
    }
    // En gang til ændrer intet (idempotent)
    await rodQuery(K.db, 'DELETE FROM migrations WHERE filename = ?', [MIG]);
    await require('../../config/migrationRunner').runMigrationsForDatabase(K.db);
    const [igen] = await rodQuery(K.db, "SELECT page_permissions AS p FROM club_admins WHERE username = 'm-links'");
    assert.deepEqual(JSON.parse(igen.p), ['devicetokens', 'livestream']);
});

test('21a: livestream og adgangslinks er nu adskilte sider', async () => {
    const kunLivestream = await nyAdmin('kun-livestream', ['livestream']);
    const kunLinks = await nyAdmin('kun-links', ['devicetokens']);

    assert.equal((await kald('/api/livestream', { host: K.host, token: kunLivestream })).status, 200);
    assert.equal((await kald('/api/device-tokens', { host: K.host, token: kunLivestream })).status, 403);

    assert.equal((await kald('/api/livestream', { host: K.host, token: kunLinks })).status, 403);
    assert.equal((await kald('/api/device-tokens', { host: K.host, token: kunLinks })).status, 200);

    // Fuld adgang (NULL) omfatter den nye side
    assert.equal((await kald('/api/livestream', { host: K.host, token: K.adminToken })).status, 200);
});

test('21a: super-admin kan give og vise rettigheden', async () => {
    const r = await kald(`/api/super-admin/clubs/${K.id}/admins`, { host: ADMIN_HOST, token: superT });
    assert.equal(r.status, 200);
    const a = r.body.find(x => x.username === 'kun-livestream');
    assert.deepEqual(a.page_permissions, ['livestream']);
});

test.after(async () => {
    await require('../../config/masterDatabase').pool.end().catch(() => {});
});
