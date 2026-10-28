/**
 * Unit-tests af livestream (screens/livestream.js): admins opsætning, hvornår en
 * bane sendes, overlayet og PC'ernes status — ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ls = require('../../screens/livestream');

const NU = 1_800_000_000_000;
const MIN = 60 * 1000;
const OPS = { enabled: 1, stream_key: 'abcd-efgh-ijkl-mnop', stream_url: ls.STANDARD_URL, overlay: 1 };
const gs = (ekstra = {}) => ({
    player1_name: 'Hansen', player1_name2: 'Makker 1', player1_score: 0, player1_games: 0,
    player2_name: 'Jensen', player2_name2: 'Makker 2', player2_score: 0, player2_games: 0,
    match_start_time: null, match_end_time: null, match_completed: 0,
    set_scores_history: '[]', updated_at: new Date(NU - MIN), ...ekstra
});

test('opsætning: YouTube-adressen er standard, og nøglen valideres', () => {
    assert.deepEqual(ls.rensOpsaetning({ enabled: true, streamKey: ' abcd-efgh-ijkl-mnop ' }),
        { enabled: true, overlay: true, stream_url: ls.STANDARD_URL, stream_key: 'abcd-efgh-ijkl-mnop' });
    // Tom nøgle = uændret, fjernNoegle = fjern
    assert.equal(ls.rensOpsaetning({ enabled: false, streamKey: '' }).stream_key, undefined);
    assert.equal(ls.rensOpsaetning({ fjernNoegle: true }).stream_key, null);
    assert.ok(ls.rensOpsaetning({ streamKey: 'ab' }).fejl);
    assert.ok(ls.rensOpsaetning({ streamKey: 'a/b/c/d' }).fejl);
    assert.ok(ls.rensOpsaetning({ streamKey: 'med mellemrum' }).fejl);
    // Facebooks nøgler har ?s_bl=…&a=… med
    assert.equal(ls.rensOpsaetning({ streamUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
        streamKey: 'FB-123456789-0-AbCdEf?s_bl=1&a=xyz' }).stream_key, 'FB-123456789-0-AbCdEf?s_bl=1&a=xyz');
});

test('opsætning: kun rtmp:// og rtmps:// uden brugernavn', () => {
    assert.ok(ls.gyldigUrl('rtmp://a.rtmp.youtube.com/live2'));
    assert.ok(!ls.gyldigUrl('https://youtube.com/live2'));
    assert.ok(!ls.gyldigUrl('rtmps://bruger:kode@host/live'));
    assert.ok(!ls.gyldigUrl('file:///etc/passwd'));
    assert.ok(ls.rensOpsaetning({ streamUrl: 'http://x' }).fejl);
});

test('admin ser kun slutningen af nøglen', () => {
    assert.equal(ls.noegleSlut('abcd-efgh-ijkl-mnop'), '…mnop');
    assert.equal(ls.noegleSlut(null), null);
});

test('sendes ikke: slået fra, uden nøgle, badmintonplanner eller ingen kamp', () => {
    assert.equal(ls.beslutning({ opsaetning: null, gs: gs(), nu: NU }).grund, 'slaaet-fra');
    assert.equal(ls.beslutning({ opsaetning: { ...OPS, enabled: 0 }, gs: gs(), nu: NU }).grund, 'slaaet-fra');
    assert.equal(ls.beslutning({ opsaetning: { ...OPS, stream_key: null }, gs: gs(), nu: NU }).grund, 'mangler-noegle');
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: gs({ player1_score: 5 }), planner: { court_number: 3 }, nu: NU }).grund, 'badmintonplanner');
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: gs({ player1_name: 'Spiller 1', player2_name: 'Spiller 2' }), nu: NU }).grund, 'ingen-kamp');
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: null, sidste: null, nu: NU }).grund, 'ingen-kamp');
});

test('sendes fra kampen sættes på banen — navne er nok, før første point', () => {
    assert.deepEqual(ls.beslutning({ opsaetning: OPS, gs: gs(), nu: NU }), { send: true, grund: 'kamp', kilde: 'gs' });
    assert.ok(ls.beslutning({ opsaetning: OPS, gs: gs({ player1_name: 'Spiller 1', player2_name: 'Spiller 2', player2_score: 1 }), nu: NU }).send);
});

test('en kamp, ingen har rørt i 30 minutter, sendes ikke', () => {
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: gs({ updated_at: new Date(NU - 31 * MIN) }), nu: NU }).grund, 'stille');
});

test('2 minutter efter kampen er afgjort — kun hvis PC\'en allerede sender', () => {
    const afgjort = gs({ player1_games: 2, match_completed: 1, match_end_time: new Date(NU - MIN) });
    assert.ok(ls.beslutning({ opsaetning: OPS, gs: afgjort, senderNu: true, nu: NU }).send);
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: afgjort, senderNu: false, nu: NU }).grund, 'afsluttet');
    const gammel = { ...afgjort, match_end_time: new Date(NU - 3 * MIN) };
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: gammel, senderNu: true, nu: NU }).grund, 'afsluttet');
    // Banen ryddet lige efter kampen: sidste afsluttede kamp holder streamen i 2 minutter
    const sidste = { ...afgjort, cleared_at: new Date(NU) };
    assert.deepEqual(ls.beslutning({ opsaetning: OPS, gs: null, sidste, senderNu: true, nu: NU }),
        { send: true, grund: 'afgjort', kilde: 'sidste' });
    // … men en ryddet badmintonplanner-kamp starter aldrig en stream
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: null, sidste, senderNu: false, nu: NU }).send, false);
});

test('overlay: navn, sættene og stillingen under hinanden', () => {
    const linjer = ls.overlayLinjer(gs({
        player1_score: 11, player2_score: 8, player1_games: 1,
        set_scores_history: JSON.stringify([{ player1Name: 'Hansen', player2Name: 'Jensen', score: '21-15' }])
    }), false);
    assert.deepEqual(linjer, ['Hansen 21 11', 'Jensen 15  8']);
});

test('overlay: double med makker — rækkerne står som i 1. sæt, også efter sidebyttet', () => {
    const linjer = ls.overlayLinjer(gs({
        player1_name2: 'Berg', player2_name2: 'Olsen', player1_score: 3, player2_score: 4,
        set_scores_history: JSON.stringify([{ player1Name: 'Jensen', player2Name: 'Hansen', score: '21-19' }])
    }), true);
    assert.deepEqual(linjer, ['Jensen / Olsen 21  4', 'Hansen / Berg  19  3']);
});

test('scoreboard: sæt som tal, stillingen, serven og banen — vendt som i 1. sæt', () => {
    const r = gs({
        player1_score: 3, player2_score: 4, serving_player: 1,
        set_scores_history: JSON.stringify([{ player1Name: 'Jensen', player2Name: 'Hansen', score: '21-19' }])
    });
    assert.deepEqual(ls.overlayTavle(r, false, 3),
        { bane: 3, navne: ['Jensen', 'Hansen'], saet: [[21, 19]], nu: [4, 3], serve: 2 });
    // I double er det holdet, der server
    assert.equal(ls.overlayTavle(gs({ serving_team: 2, serving_player: 1 }), true).serve, 2);
    // Afgjort: ingen stilling og ingen serv
    const slut = ls.overlayTavle(gs({ match_completed: 1, player1_score: 21, serving_player: 1,
        set_scores_history: JSON.stringify(['21-15', '21-10']) }), false);
    assert.deepEqual([slut.saet, slut.nu, slut.serve], [[[21, 15], [21, 10]], null, null]);
    assert.equal(ls.overlayTavle(null, false), null);
});

test('overlay: afgjort kamp viser kun sættene, lange navne afkortes', () => {
    const linjer = ls.overlayLinjer(gs({
        player1_name: 'Anne-Sofie Christiansen-Mortensen', player1_games: 2, match_completed: 1,
        match_end_time: new Date(NU), player1_score: 21, player2_score: 10,
        set_scores_history: JSON.stringify(['21-15', '21-10'])
    }), false);
    assert.equal(linjer[0], 'Anne-Sofie Christiansen-M… 21 21');
    assert.equal(linjer[1], 'Jensen'.padEnd(26) + ' 15 10');
});

test('status: PC\'ens oplysninger renses, og "sender siden" huskes', () => {
    const s = ls.rensStatus({ navn: 'tv-bane3', kamera: 'HD Pro Webcam C920', sender: true, koder: 'vaapi', fejl: '' });
    assert.deepEqual(s, { navn: 'tv-bane3', kioskVersion: '', kamera: 'HD Pro Webcam C920', sender: true, koder: 'vaapi', fejl: null });
    assert.equal(ls.rensStatus({ navn: '../x', koder: 'nvenc' }).navn, '');
    assert.equal(ls.rensStatus({ koder: 'nvenc' }).koder, null);

    ls.registrer('t-test', 7, s, '1.2.3.4', NU);
    ls.registrer('t-test', 7, s, '1.2.3.4', NU + 3000);
    assert.equal(ls.statusFor('t-test', NU + 3000)[7].senderSiden, NU);
    assert.equal(ls.statusFor('t-test', NU + 3000)[7].online, true);
    assert.equal(ls.statusFor('t-test', NU + 3 * MIN)[7].online, false);
    ls.registrer('t-test', 7, { ...s, sender: false }, '1.2.3.4', NU + 6000);
    assert.equal(ls.statusFor('t-test', NU + 6000)[7].senderSiden, null);
});
