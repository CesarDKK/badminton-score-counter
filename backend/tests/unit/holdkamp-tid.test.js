/**
 * Unit-tests af tidshåndteringen i holdkamp-hentningen.
 *
 * Badmintonplayer angiver dansk vægur; vi gemmer UTC, så det kan sammenlignes
 * med MySQL NOW(). Testene er uafhængige af serverens egen tidszone (TZ).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDanskTid, tilMysqlDato, danskVaeggurTilUtc } = require('../../routes/importHoldkamp');

test('sommertid: 16:00 dansk (CEST, +2) gemmes som 14:00 UTC', () => {
    const d = parseDanskTid('lø 05-09-2026 16:00');
    assert.equal(d.toISOString(), '2026-09-05T14:00:00.000Z');
    assert.equal(tilMysqlDato(d), '2026-09-05 14:00:00');
});

test('vintertid: 16:00 dansk (CET, +1) gemmes som 15:00 UTC', () => {
    const d = parseDanskTid('lø 10-01-2026 16:00');
    assert.equal(tilMysqlDato(d), '2026-01-10 15:00:00');
});

test('dato uden klokkeslæt tolkes som midnat dansk tid', () => {
    const d = parseDanskTid('05-09-2026');
    assert.equal(d.toISOString(), '2026-09-04T22:00:00.000Z');
});

test('punktum som separator accepteres (05.09.2026 16.00)', () => {
    const d = parseDanskTid('05.09.2026 16.00');
    assert.equal(tilMysqlDato(d), '2026-09-05 14:00:00');
});

test('ugyldig tekst giver null, og tilMysqlDato(null) giver null', () => {
    assert.equal(parseDanskTid('ingen tid her'), null);
    assert.equal(parseDanskTid(''), null);
    assert.equal(tilMysqlDato(null), null);
});

test('omregningen er stabil hen over et DST-skifte (dagen efter skiftet til vintertid)', () => {
    // 25-10-2026 er sidste søndag i oktober (skift til CET). Dagen efter: +1.
    const d = danskVaeggurTilUtc(2026, 9, 26, 12, 0);
    assert.equal(d.toISOString(), '2026-10-26T11:00:00.000Z');
    // Dagen før skiftet: stadig CEST (+2)
    const f = danskVaeggurTilUtc(2026, 9, 24, 12, 0);
    assert.equal(f.toISOString(), '2026-10-24T10:00:00.000Z');
});
