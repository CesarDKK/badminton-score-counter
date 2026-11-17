/**
 * Nr. 21d: QR-kodens link (match_session) må ikke kunne melde sig som skærm/PC,
 * hente en stream-nøgle eller skrive skærm-hændelser. Token-værdien står i
 * QR-koden, så enhver, der har scannet den, kender den.
 *
 * PC-endepunkterne (pc-rapport, pc-opdatering, pc-fejllog, livestream/pc) tager
 * adgangslinkets rå token i X-Adgangslink; heartbeat tager sessionen (JWT).
 * Kontrol: TV-PC'ens eget link (tv/N) virker stadig.
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { kald, rodQuery, opretKlub, enhedsSession, qrLink } = require('./faelles');

let K, tvToken, qrToken;
const rapport = () => ({ navn: 'tv-pc-test', kioskVersion: '2026.11.8',
    haendelser: [{ type: 'pc-genstart', fra: Date.now() - 60000, til: Date.now() - 30000, tekst: 'test' }] });
const pcKald = (sti, token, body) => kald(sti, { method: 'POST', host: K.host, ekstra: { 'X-Adgangslink': token }, body });
const haendelser = async () => (await rodQuery('badminton_master', 'SELECT COUNT(*) AS n FROM skaerm_haendelser'))[0].n;

before(async () => {
    K = await opretKlub('skaerm', 'Skærmklub');
    const r = await kald('/api/device-tokens', {
        method: 'POST', host: K.host, token: K.adminToken, body: { name: 'TV bane 1', destination: 'tv/1', locked: true }
    });
    assert.equal(r.status, 201);
    tvToken = r.body.token;
    qrToken = await qrLink(K, 1);
});

test('21d: TV-PC\'ens eget link kan stadig melde sig (kontrol)', async () => {
    const foer = await haendelser();
    assert.equal((await pcKald('/api/screens/pc-rapport', tvToken, rapport())).status, 200);
    assert.ok(await haendelser() > foer, 'kontrol: rapporten gemmer en hændelse');
    assert.equal((await pcKald('/api/screens/pc-opdatering', tvToken, { navn: 'tv-pc-test' })).status, 200);
    assert.equal((await pcKald('/api/screens/pc-fejllog/spoerg', tvToken, { navn: 'tv-pc-test' })).status, 200);
    assert.equal((await pcKald('/api/livestream/pc', tvToken, { navn: 'tv-pc-test' })).status, 200);
});

test('21d: QR-kodens link afvises på alle PC-endepunkter og skriver ingen hændelser', async () => {
    const foer = await haendelser();
    for (const [sti, body] of [
        ['/api/screens/pc-rapport', rapport()],
        ['/api/screens/pc-opdatering', { navn: 'tv-pc-test' }],
        ['/api/screens/pc-fejllog/spoerg', { navn: 'tv-pc-test' }],
        ['/api/screens/pc-fejllog?navn=tv-pc-test', undefined],
        ['/api/livestream/pc', { navn: 'telefon', kamera: 'falsk' }],
    ]) {
        const r = await pcKald(sti, qrToken, body);
        assert.equal(r.status, 403, `${sti}: ${r.status} ${JSON.stringify(r.body)}`);
        assert.ok(!JSON.stringify(r.body).includes('noegle') && !JSON.stringify(r.body).includes('rtmp'), `${sti}: ingen nøgle`);
    }
    assert.equal(await haendelser(), foer, 'ingen skærm-hændelser fra QR-linket');
});

test('21d: QR-sessionen (JWT) kan ikke sende livstegn som skærm', async () => {
    const session = await enhedsSession(K, qrToken);
    const r = await kald('/api/screens/heartbeat', {
        method: 'POST', host: K.host, token: session, body: { klientId: 'telefon-1', side: 'tv', bane: 1 }
    });
    assert.equal(r.status, 403, JSON.stringify(r.body));
});
