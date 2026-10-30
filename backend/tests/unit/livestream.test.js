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

test('holdkampe sendes af sig selv — uden afbrydelser mellem delkampene', () => {
    const iGang = { mangler: 5, igang: 1, slut: null, start: new Date(NU - 10 * MIN) };
    assert.deepEqual(ls.beslutning({ opsaetning: OPS, gs: gs(), holdkamp: iGang, nu: NU }), { send: true, grund: 'holdkamp', kilde: 'gs' });
    // Mellem delkampene: banen er ryddet, ingen delkamp i gang — der sendes stadig
    const pause = { mangler: 3, igang: 0, slut: new Date(NU - 8 * MIN), start: new Date(NU - 40 * MIN) };
    assert.deepEqual(ls.beslutning({ opsaetning: OPS, gs: null, sidste: null, holdkamp: pause, nu: NU }),
        { send: true, grund: 'holdkamp', kilde: null });
    // … også mens den afgjorte delkamp står på banen
    const afgjort = gs({ player1_games: 2, match_completed: 1, match_end_time: new Date(NU - 8 * MIN) });
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: afgjort, holdkamp: pause, nu: NU }).kilde, 'gs');
    // En holdkamp, ingen har rørt i 45 minutter, er forladt
    const forladt = { mangler: 3, igang: 0, slut: new Date(NU - 50 * MIN), start: new Date(NU - 90 * MIN) };
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: null, holdkamp: forladt, nu: NU }).send, false);
    // Alle delkampe færdige (den sidste måske på en anden bane): 2 minutter mere — hvis PC'en sender
    const faerdig = { mangler: 0, igang: 0, slut: new Date(NU - MIN), start: new Date(NU - 30 * MIN) };
    assert.deepEqual(ls.beslutning({ opsaetning: OPS, gs: null, holdkamp: faerdig, senderNu: true, nu: NU }),
        { send: true, grund: 'afgjort', kilde: null });
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: null, holdkamp: faerdig, senderNu: false, nu: NU }).send, false);
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: null, holdkamp: { ...faerdig, slut: new Date(NU - 3 * MIN) },
        senderNu: true, nu: NU }).send, false);
    // Andre kampe kun, når de er startet med en knap
    assert.deepEqual(ls.beslutning({ opsaetning: OPS, gs: gs({ player1_score: 5 }), nu: NU }), { send: false, grund: 'ikke-startet' });
});

test('tablettens "Start livestream": kampen på banen — og ikke den næste', () => {
    const klar = { ...OPS, armed_until: new Date(NU + 4 * MIN) };
    // Kampen på banen (eller den næste, der sættes på inden 5 minutter) bliver valgt
    assert.deepEqual(ls.beslutning({ opsaetning: klar, gs: gs(), nu: NU }), { send: true, grund: 'valgt', kilde: 'gs', vaelg: true });
    // Ingen kamp endnu: venter — og glemmes efter 5 minutter
    assert.equal(ls.beslutning({ opsaetning: klar, gs: null, nu: NU }).send, false);
    assert.equal(ls.beslutning({ opsaetning: { ...OPS, armed_until: new Date(NU - 1) }, gs: gs(), nu: NU }).grund, 'ikke-startet');
    // Den valgte kamp sendes, til den er afgjort (+ 2 minutter) …
    const valgt = { ...OPS, manual_since: new Date(NU - 30 * MIN) };
    assert.deepEqual(ls.beslutning({ opsaetning: valgt, gs: gs({ player1_score: 9 }), nu: NU }), { send: true, grund: 'valgt', kilde: 'gs' });
    const afgjort = gs({ player1_games: 2, match_completed: 1, match_end_time: new Date(NU - MIN) });
    assert.deepEqual(ls.beslutning({ opsaetning: valgt, gs: afgjort, senderNu: true, nu: NU }),
        { send: true, grund: 'afgjort', kilde: 'gs', glem: true });
    // … og så glemmes den, så den næste kamp ikke sendes
    assert.equal(ls.beslutning({ opsaetning: valgt, gs: null, nu: NU }).glem, true);
    // En valgt kamp, der aldrig blev afgjort, glemmes efter 4 timer
    assert.equal(ls.beslutning({ opsaetning: { ...OPS, manual_since: new Date(NU - 5 * 60 * MIN) }, gs: gs(), nu: NU }).grund, 'ikke-startet');
    // Badmintonplanner-kampe sendes heller ikke med knappen
    assert.equal(ls.beslutning({ opsaetning: klar, gs: gs(), planner: { court_number: 3 }, nu: NU }).grund, 'badmintonplanner');
});

test('hele dagen (admin): alt sendes, også mellem kampene — scoreboardet tomt uden kamp', () => {
    const dag = { ...OPS, all_day_until: new Date(NU + 60 * MIN) };
    assert.deepEqual(ls.beslutning({ opsaetning: dag, gs: gs(), nu: NU }), { send: true, grund: 'hele-dagen', kilde: 'gs' });
    assert.deepEqual(ls.beslutning({ opsaetning: dag, gs: null, sidste: null, nu: NU }), { send: true, grund: 'hele-dagen', kilde: null });
    // Den ryddede kamp står i billedet i 5 minutter, som på TV'et
    const sidste = { match_end_time: new Date(NU - 2 * MIN) };
    assert.equal(ls.beslutning({ opsaetning: dag, gs: null, sidste, nu: NU }).kilde, 'sidste');
    assert.equal(ls.beslutning({ opsaetning: dag, gs: null, sidste: { match_end_time: new Date(NU - 6 * MIN) }, nu: NU }).kilde, null);
    // Udløbet (dagen er gået): så er det de almindelige regler igen
    assert.equal(ls.beslutning({ opsaetning: { ...OPS, all_day_until: new Date(NU - 1) }, gs: gs(), nu: NU }).grund, 'ikke-startet');
});

test('tabletten: knappen kun når banen er sat op med nøgle og kamera', () => {
    assert.equal(ls.tabletStatus({ opsaetning: OPS, kamera: false, nu: NU }).kan, false);
    assert.equal(ls.tabletStatus({ opsaetning: { ...OPS, enabled: 0 }, kamera: true, nu: NU }).kan, false);
    assert.deepEqual(ls.tabletStatus({ opsaetning: { ...OPS, armed_until: new Date(NU + MIN) }, kamera: true,
        pc: { online: true, sender: false, kamera: 'Lenovo 500' }, efterMin: 5, nu: NU }),
        { kan: true, start: 'klar', til: new Date(NU + MIN).toISOString(), holdkamp: false, planner: false, sender: false,
          kameraKlar: true, efterMin: 5 });
    // PC'en finder intet kamera, er slukket eller har ikke meldt sig: tabletten skjuler knappen
    assert.equal(ls.tabletStatus({ opsaetning: OPS, kamera: true, pc: { online: true, kamera: null }, nu: NU }).kameraKlar, false);
    assert.equal(ls.tabletStatus({ opsaetning: OPS, kamera: true, pc: { online: false, kamera: 'x' }, nu: NU }).kameraKlar, false);
    assert.equal(ls.tabletStatus({ opsaetning: OPS, kamera: true, pc: null, nu: NU }).kameraKlar, false);
    assert.equal(ls.tabletStatus({ opsaetning: OPS, kamera: true, nu: NU }).efterMin, 2);
});

test('hele dagen slutter kl. 23:59 dansk tid — sommer- og vintertid', () => {
    // 29. oktober 2026 kl. 10 dansk vintertid (UTC+1) → 22:59 UTC
    assert.equal(new Date(ls.dagensSlut(Date.UTC(2026, 9, 29, 9))).toISOString(), '2026-10-29T22:59:00.000Z');
    // 15. juni kl. 10 dansk sommertid (UTC+2) → 21:59 UTC
    assert.equal(new Date(ls.dagensSlut(Date.UTC(2026, 5, 15, 8))).toISOString(), '2026-06-15T21:59:00.000Z');
    // Lige efter midnat dansk tid (23:30 UTC den 28.) er det allerede den 29.
    assert.equal(new Date(ls.dagensSlut(Date.UTC(2026, 9, 28, 23, 30))).toISOString(), '2026-10-29T22:59:00.000Z');
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

test('scoreboard: double viser fornavne som TV\'et (forbogstav ved sammenfald), single hele navnet', () => {
    const d = ls.overlayTavle(gs({
        player1_name: 'Ella Brink Sørensen', player1_name2: 'Bertram Holm',
        player2_name: 'Konrad Lilholm Beltoft', player2_name2: 'Yudan Li'
    }), true);
    assert.deepEqual(d.navne, ['Ella / Bertram', 'Konrad / Yudan']);
    // To med samme fornavn — også på tværs af siderne
    const ens = ls.overlayTavle(gs({
        player1_name: 'Anna Jensen', player1_name2: 'Mads Berg',
        player2_name: 'Anna Krogh', player2_name2: 'Ole Nielsen'
    }), true);
    assert.deepEqual(ens.navne, ['Anna J. / Mads', 'Anna K. / Ole']);
    // Makker ikke udfyldt: kun fornavnet
    assert.equal(ls.overlayTavle(gs({ player1_name: 'Ella Brink Sørensen' }), true).navne[0], 'Ella');
    // Single: hele navnet, der er plads til det
    assert.equal(ls.overlayTavle(gs({ player1_name: 'Konrad Lilholm Beltoft' }), false).navne[0], 'Konrad Lilholm Beltoft');
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
    assert.deepEqual(s, { navn: 'tv-bane3', kioskVersion: '', kamera: 'HD Pro Webcam C920', sender: true, koder: 'vaapi',
        format: null, mikrofon: null, fejl: null });
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

test('TV\'ets LIVE-mærke: kun mens banens PC selv melder, at den sender', () => {
    const s = ls.rensStatus({ navn: 'tv-bane2', kamera: 'C920', sender: true });
    ls.registrer('t-live', 9, { ...s, bane: 2 }, null, NU);
    assert.equal(ls.senderBane('t-live', 2, NU + 1000), true);
    assert.equal(ls.senderBane('t-live', 3, NU + 1000), false);      // en anden bane
    assert.equal(ls.senderBane('t-andenklub', 2, NU + 1000), false); // en anden klub
    assert.equal(ls.senderBane('t-live', 2, NU + 2 * MIN), false);   // PC'en er væk
    ls.registrer('t-live', 9, { ...s, sender: false, bane: 2 }, null, NU + 3000);
    assert.equal(ls.senderBane('t-live', 2, NU + 4000), false);
});

test('indstillinger: standard, når intet er gemt eller værdien er ødelagt', () => {
    assert.deepEqual(ls.laesIndstillinger(null), { ...ls.STANDARD_INDSTILLINGER });
    assert.deepEqual(ls.laesIndstillinger('{ikke json'), { ...ls.STANDARD_INDSTILLINGER });
    const gemt = ls.laesIndstillinger(JSON.stringify({ oploesning: 1080, billeder: 60, kvalitet: 'hoej',
        placering: 'bund-hoejre', stoerrelse: 'stor', efterMin: 0, logo: 'livestream-logo-0123456789abcdef.png' }));
    assert.equal(gemt.oploesning, 1080);
    assert.equal(gemt.billeder, 60);
    assert.equal(gemt.efterMin, 0);
    assert.equal(gemt.logo, 'livestream-logo-0123456789abcdef.png');
    // Ukendte værdier og et logo uden for mønstret (sti) bliver standard
    const forkert = ls.laesIndstillinger({ oploesning: 4000, billeder: 24, efterMin: 99, logo: '../server.js' });
    assert.deepEqual(forkert, { ...ls.STANDARD_INDSTILLINGER });
});

test('indstillinger: admin ændrer kun det sendte, og logoet bevares', () => {
    const foer = { ...ls.STANDARD_INDSTILLINGER, logo: 'livestream-logo-0123456789abcdef.png' };
    const ny = ls.rensIndstillinger({ oploesning: '1080', billeder: '50', efterMin: '5' }, foer);
    assert.equal(ny.oploesning, 1080);
    assert.equal(ny.billeder, 50);
    assert.equal(ny.efterMin, 5);
    assert.equal(ny.kvalitet, 'normal');
    assert.equal(ny.logo, foer.logo);
    assert.match(ls.rensIndstillinger({ oploesning: 1440 }).fejl, /opløsning/);
    assert.match(ls.rensIndstillinger({ billeder: 24 }).fejl, /billeder/);
    assert.match(ls.rensIndstillinger({ efterMin: 11 }).fejl, /0–10/);
    assert.match(ls.rensIndstillinger({ efterMin: 1.5 }).fejl, /0–10/);
    assert.match(ls.rensIndstillinger({ placering: 'midt' }).fejl, /placering/);
});

test('opsætning pr. bane: kameraets felter er uændrede, når de ikke er med', () => {
    const o = ls.rensOpsaetning({ enabled: true, vend: true, lyd: 1, logo: 'sponsor' });
    assert.equal(o.flip_180, true);
    assert.equal(o.sound, true);
    assert.equal(o.logo, 'sponsor');
    assert.equal(o.mirror, undefined);
    assert.equal(ls.rensOpsaetning({ enabled: true }).logo, undefined);
    assert.match(ls.rensOpsaetning({ logo: 'hjemmeside' }).fejl, /logo/);
});

test('PC\'en får opløsning, billeder og kameraet i svaret', () => {
    const v = ls.videoTilPc({ ...ls.STANDARD_INDSTILLINGER, oploesning: 1080, billeder: 60 },
        { flip_180: 1, mirror: 0, autofocus: 1, sound: 0 });
    assert.deepEqual(v, { bredde: 1920, hoejde: 1080, billeder: 60, kvalitet: 'normal', placering: 'top-venstre',
        stoerrelse: 'normal', vend: true, spejl: false, autofokus: true, lyd: false });
    assert.equal(ls.videoTilPc(ls.STANDARD_INDSTILLINGER, null).bredde, 1280);
});

test('sponsor-logoet roterer som TV\'ets bannere', () => {
    const b = [{ filename: 'k/a.jpg' }, { filename: 'k/b.jpg' }];
    assert.equal(ls.sponsorNu([], 20, NU), null);
    assert.equal(ls.sponsorNu(b, 20, 0), 'k/a.jpg');
    assert.equal(ls.sponsorNu(b, 20, 20_000), 'k/b.jpg');
    assert.equal(ls.sponsorNu(b, 20, 40_000), 'k/a.jpg');
});

test('minutter efter kampen kan sættes i admin (0 = stop med det samme)', () => {
    const afgjort = gs({ player1_score: 21, match_completed: 1, match_end_time: new Date(NU - 3 * MIN) });
    const valgt = { ...OPS, manual_since: new Date(NU - 30 * MIN) };
    const spoerg = (efterMs) => ls.beslutning({ opsaetning: valgt, gs: afgjort, senderNu: true, efterMs, nu: NU }).send;
    assert.equal(spoerg(undefined), false);     // standard 2 minutter
    assert.equal(spoerg(5 * MIN), true);
    assert.equal(spoerg(0), false);
});

test('PC-status: formatet og mikrofonen valideres', () => {
    const s = ls.rensStatus({ format: '1920x1080@30', mikrofon: 'HD Pro Webcam C920' });
    assert.equal(s.format, '1920x1080@30');
    assert.equal(s.mikrofon, 'HD Pro Webcam C920');
    assert.equal(ls.rensStatus({ format: '<script>' }).format, null);
});

const LOGOER = [
    { id: 1, club_name: 'Lyngby', aliases: null, url: '/uploads/central_logos/lyngby.png' },
    { id: 2, club_name: 'Gladsaxe Søborg', aliases: 'GSB', url: '/uploads/central_logos/gsb.png' },
    { id: 3, club_name: 'Holte', aliases: null, url: '/uploads/central_logos/holte.png' }
];

test('klubbens logo findes i logo-databasen ud fra klubnavnet', () => {
    assert.deepEqual(ls.klubLogoFraDatabase('Gladsaxe Søborg Badminton', LOGOER),
        { url: '/uploads/central_logos/gsb.png', navn: 'Gladsaxe Søborg' });
    assert.equal(ls.klubLogoFraDatabase('Ukendt BK', LOGOER), null);
    assert.equal(ls.klubLogoFraDatabase(null, LOGOER), null);
});

test('logoer ud for navnene: spillernes klubber, override og makkeren i double', () => {
    const rk = gs({ player1_name: 'Hansen', player2_name: 'Jensen', player1_name2: 'Berg', player2_name2: 'Olsen' });
    const clubByName = { hansen: 'Lyngby', olsen: 'Holte' };
    assert.deepEqual(ls.spillerLogoer(rk, false, { logos: LOGOER, clubByName }), ['/uploads/central_logos/lyngby.png', null]);
    // Double: Jensen har ingen klub, makkeren Olsen har
    assert.deepEqual(ls.spillerLogoer(rk, true, { logos: LOGOER, clubByName }),
        ['/uploads/central_logos/lyngby.png', '/uploads/central_logos/holte.png']);
    // player_logos vinder: 0 = intet logo, ellers et bestemt
    const playerLogos = [{ player_name: 'Hansen', logo_id: 0 }, { player_name: 'Jensen', logo_id: 2 }];
    assert.deepEqual(ls.spillerLogoer(rk, false, { logos: LOGOER, clubByName, playerLogos }),
        [null, '/uploads/central_logos/gsb.png']);
    assert.equal(ls.spillerLogoer(rk, false, { logos: LOGOER, clubByName: {} }), null);
    assert.equal(ls.spillerLogoer(rk, false, { logos: [], clubByName }), null);
});

test('logoer ud for navnene: holdenes logoer i en holdkamp, også når siderne er byttet', () => {
    const holdkamp = { team1_name: 'Lyngby 1', team2_name: 'Holte 2', team1_logo_id: null, team2_logo_id: null,
        game: { team1_player1: 'Hansen', team1_player2: null, team2_player1: 'Jensen', team2_player2: null } };
    // Jensen (hold 2) står i player1-siden
    const rk = gs({ player1_name: 'Jensen', player2_name: 'Hansen' });
    assert.deepEqual(ls.spillerLogoer(rk, false, { holdkamp, logos: LOGOER }),
        ['/uploads/central_logos/holte.png', '/uploads/central_logos/lyngby.png']);
    // Logo valgt på holdkampen (2) og "intet logo" (0)
    assert.deepEqual(ls.spillerLogoer(rk, false, { holdkamp: { ...holdkamp, team1_logo_id: 2, team2_logo_id: 0 }, logos: LOGOER }),
        [null, '/uploads/central_logos/gsb.png']);
    // En anden kamp på banen (ingen af spillerne er i holdkampen): spillernes egne klubber
    const anden = gs({ player1_name: 'Berg', player2_name: 'Olsen' });
    assert.deepEqual(ls.spillerLogoer(anden, false, { holdkamp, logos: LOGOER, clubByName: { olsen: 'Holte' } }),
        [null, '/uploads/central_logos/holte.png']);
});

test('logoerne vendes med siderne i scoreboardet', () => {
    const rk = gs({ player1_name: 'Hansen', player2_name: 'Jensen',
        set_scores_history: JSON.stringify([{ score: '21-15', player1Name: 'Jensen', player2Name: 'Hansen' }]) });
    const t = ls.overlayTavle(rk, false, 3, ['/a.png', null]);
    assert.deepEqual(t.navne, ['Jensen', 'Hansen']);
    assert.deepEqual(t.logoer, [null, '/a.png']);
    assert.equal(ls.overlayTavle(rk, false, 3).logoer, undefined);
});
