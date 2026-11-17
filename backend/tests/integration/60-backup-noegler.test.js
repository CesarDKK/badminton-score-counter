/**
 * Nr. 21b: stream-nøglerne (court_streams.stream_key og banens YouTube-stream,
 * yt_*) står ikke i backup-filen, og en gendannelse beholder klubbens nuværende
 * nøgler — også når en ældre backup har dem med.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { kald, rodQuery, superToken, opretKlub, ADMIN_HOST } = require('./faelles');

let K, superT;
const HEMMELIGT = ['noegle-1-hemmelig', 'yt-noegle-hemmelig', 'noegle-2-hemmelig'];

const gendan = (backup) => kald(`/api/super-admin/clubs/${K.id}/restore`, {
    method: 'POST', host: ADMIN_HOST, token: superT,
    body: { multipart: { felt: 'backup', filnavn: 'backup.json', type: 'application/json', data: JSON.stringify(backup) } }
});
const baner = async () => rodQuery(K.db,
    'SELECT court_number, enabled, stream_key, yt_stream_key, yt_stream_id, yt_broadcast_tjek FROM court_streams ORDER BY court_number');

before(async () => {
    superT = await superToken();
    K = await opretKlub('noegler', 'Nøgleklub');
    await rodQuery(K.db, `INSERT INTO court_streams (court_number, enabled, stream_key, yt_stream_key, yt_stream_id, yt_ingest_url, yt_broadcast_tjek)
        VALUES (1, 1, 'noegle-1-hemmelig', 'yt-noegle-hemmelig', 'yt-stream-1', 'rtmp://yt/1', '2026-11-01 10:00:00'),
               (2, 0, 'noegle-2-hemmelig', NULL, NULL, NULL, NULL)`);
});

test('21b: hverken super-admins eller klubbens egen backup indeholder nøglerne', async () => {
    for (const [sti, host, token] of [
        [`/api/super-admin/clubs/${K.id}/backup`, ADMIN_HOST, superT],
        ['/api/backup', K.host, K.adminToken],
    ]) {
        const r = await kald(sti, { host, token });
        assert.equal(r.status, 200, `${sti}: ${JSON.stringify(r.body).slice(0, 200)}`);
        const tekst = JSON.stringify(r.body);
        for (const h of HEMMELIGT) assert.ok(!tekst.includes(h), `${sti}: ${h} står i filen`);
        const cs = r.body.tables.court_streams;
        assert.equal(cs.length, 2, 'banernes opsætning er stadig med');
        assert.equal(cs[0].enabled, 1);
        for (const row of cs) {
            assert.ok(!Object.keys(row).some(k => k === 'stream_key' || k.startsWith('yt_')), Object.keys(row).join(','));
        }
    }
});

test('21b: gendannelsen bevarer klubbens nuværende nøgler — også en ældre backup med nøgler i', async () => {
    const backup = (await kald(`/api/super-admin/clubs/${K.id}/backup`, { host: ADMIN_HOST, token: superT })).body;

    // Efter backuppen: bane 1 slås fra og får en ny nøgle, bane 3 kommer til
    await rodQuery(K.db, "UPDATE court_streams SET enabled = 0, stream_key = 'ny-noegle-1' WHERE court_number = 1");
    await rodQuery(K.db, "INSERT INTO court_streams (court_number, enabled, stream_key) VALUES (3, 1, 'noegle-3')");

    const g = await gendan(backup);
    assert.equal(g.status, 200, JSON.stringify(g.body));
    let r = await baner();
    assert.deepEqual(r.map(x => [x.court_number, x.enabled, x.stream_key]),
        [[1, 1, 'ny-noegle-1'], [2, 0, 'noegle-2-hemmelig'], [3, 0, 'noegle-3']],
        'opsætningen fra backuppen, nøglerne fra nu; bane 3 beholder nøglen (slået fra)');
    assert.equal(r[0].yt_stream_key, 'yt-noegle-hemmelig');
    assert.equal(r[0].yt_stream_id, 'yt-stream-1');
    assert.equal(new Date(r[0].yt_broadcast_tjek).toISOString(), '2026-11-01T10:00:00.000Z', 'tidsstemplet bevares uændret (UTC)');

    // En ældre backup (før nr. 21b) med nøgler i: gendannes, men nøglerne bruges ikke
    const gammel = JSON.parse(JSON.stringify(backup));
    gammel.tables.court_streams[0].stream_key = 'gammel-laekket-noegle';
    gammel.tables.court_streams[0].yt_stream_key = 'gammel-yt-noegle';
    gammel.tables.court_streams.push({ court_number: 4, enabled: 1, stream_key: 'gammel-bane-4' });
    const g2 = await gendan(gammel);
    assert.equal(g2.status, 200, JSON.stringify(g2.body));
    r = await baner();
    assert.equal(r[0].stream_key, 'ny-noegle-1');
    assert.equal(r[0].yt_stream_key, 'yt-noegle-hemmelig');
    const b4 = r.find(x => x.court_number === 4);
    assert.ok(b4, 'bane 4 fra den gamle backup er gendannet');
    assert.equal(b4.stream_key, null, 'uden den gamle nøgle');
});
