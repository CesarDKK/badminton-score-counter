/**
 * Pakke R — admin på kampdagen.
 *   48  ret/slet én kamp, "før tid" + ret i turneringshistorikken, eksport til Excel
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-pakke-r';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('os').tmpdir();

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

// ---------- Falsk database (før ruterne indlæses — de destrukturerer query) ----------
const db = require('../../config/database');
let svar = async () => [];
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };

const { authMiddleware } = require('../../middleware/auth');
const eksport = require('../../config/historikEksport');
const { rettetRaekke } = require('../../config/historikRettelse');
const matchHistory = require('../../routes/matchHistory');
const teamMatches = require('../../routes/teamMatches');
const tournaments = require('../../routes/tournaments');

function lag(router, metode, sti) {
    const l = router.stack.find(x => x.route && x.route.path === sti && x.route.methods[metode]);
    assert.ok(l, `${metode.toUpperCase()} ${sti} findes`);
    return l;
}
const rute = (router, metode, sti) => { const h = lag(router, metode, sti).route.stack; return h[h.length - 1].handle; };
const indeks = (router, metode, sti) => router.stack.findIndex(x => x.route && x.route.path === sti && x.route.methods[metode]);

function falskSvar() {
    return {
        statusKode: 200, krop: null, headers: {}, dele: [], slut: false, headersSent: false,
        status(s) { this.statusKode = s; return this; },
        json(j) { this.krop = j; this.headersSent = true; return this; },
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
        write(d) { this.headersSent = true; this.dele.push(d); return true; },
        end() { this.slut = true; },
        destroy() { this.oedelagt = true; }
    };
}
async function koer(handler, req) {
    const res = falskSvar();
    let fejl = null;
    await handler({ params: {}, query: {}, body: {}, ...req }, res, (e) => { fejl = e; });
    if (fejl) throw fejl;
    return res;
}

// ======================= Nr. 48: CSV til Excel =======================

test('48: CSV-felter — formel-værn, citationstegn, semikolon, BOM og CRLF', () => {
    assert.equal(eksport.csvFelt('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(eksport.csvFelt('+45 12'), "'+45 12");
    assert.equal(eksport.csvFelt('-3'), "'-3");
    assert.equal(eksport.csvFelt('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(eksport.csvFelt('\tx'), "'\tx");
    assert.equal(eksport.csvFelt('Jens; Bo'), '"Jens; Bo"');
    assert.equal(eksport.csvFelt('a\nb'), '"a\nb"');
    assert.equal(eksport.csvFelt('Søren Ærø'), 'Søren Ærø');
    assert.equal(eksport.csvFelt('21-15 19-21'), '21-15 19-21', 'sætcifre midt i feltet er ikke en formel');
    assert.equal(eksport.csvFelt(null), '');
    assert.equal(eksport.csvFelt(7), '7');
    assert.equal(eksport.csvLinje(['a', 'b;c', 3]), 'a;"b;c";3\r\n');
    assert.equal(eksport.BOM, '﻿');
    assert.equal(eksport.SKILLE, ';');
});

test('48: dansk dato i dansk tid (sommer- og vintertid)', () => {
    assert.equal(eksport.danskDato(new Date('2026-07-01T10:05:00Z')), '01-07-2026 12:05');
    assert.equal(eksport.danskDato(new Date('2026-11-21T08:30:00Z')), '21-11-2026 09:30');
    assert.equal(eksport.danskDato('2026-11-21T23:30:00Z'), '22-11-2026 00:30');
    assert.equal(eksport.danskDato(null), '');
    assert.equal(eksport.danskDato('vrøvl'), '');
    assert.equal(eksport.filnavn('kamphistorik', new Date('2026-11-21T23:30:00Z')), 'kamphistorik-2026-11-22.csv');
});

test('48: sætcifrene vendes, så den angivne side står først — som admins visning', () => {
    const raw = 'Jens & Bo 15-7 Anna & Lis, Anna & Lis 15-13 Jens & Bo, Jens & Bo 15-10 Anna & Lis';
    assert.equal(eksport.saetCifre(raw, 'Jens & Bo'), '15-7 13-15 15-10');
    assert.equal(eksport.saetCifre(raw, 'Lis / Anna'), '7-15 15-13 10-15', 'makker-rækkefølge og "/" er ligegyldige');
    assert.equal(eksport.saetCifre('A 10-4 B (afsluttet før tid)', 'B'), '4-10 (før tid)');
    assert.equal(eksport.saetCifre('W.O.', 'A'), 'W.O.');
    assert.equal(eksport.saetCifre('Walkover', 'A'), 'W.O.');
    assert.equal(eksport.saetCifre('21-15, 19-21', 'A'), '21-15 19-21', 'gammelt format uden navne');
    assert.equal(eksport.saetCifre(null, 'A'), '');
});

test('48: rækkerne pr. fane', () => {
    assert.deepEqual(eksport.enkeltRaekke({
        match_date: new Date('2026-11-21T09:00:00Z'), court_number: 3, winner_name: 'Jens', loser_name: 'Bo',
        games_won: '2-1', set_scores: 'Bo 15-10 Jens, Jens 15-8 Bo, Jens 15-12 Bo', duration: '31:07'
    }), ['21-11-2026 10:00', 3, 'Jens', 'Bo', '2-1', '10-15 15-8 15-12', '31:07']);

    const h = eksport.holdRaekke({
        created_at: new Date('2026-11-21T09:00:00Z'), finished_at: new Date('2026-11-21T09:40:00Z'),
        started_at: new Date('2026-11-21T09:10:00Z'), team1_name: 'Holte', team2_name: 'Lyngby',
        category: 'HD', court_number: 2, status: 'finished', winner_team: 2,
        team1_player1: 'A', team1_player2: 'B', team2_player1: 'C', team2_player2: 'D',
        set_scores: 'A / B 15-13 C / D, C / D 15-9 A / B, C / D 15-11 A / B'
    });
    assert.deepEqual(h, ['21-11-2026 10:40', 'Holte – Lyngby', 'HD', 2, 'Holte', 'A / B', 'Lyngby', 'C / D', 'Lyngby', '15-13 9-15 11-15', '30:00']);
    const ikke = eksport.holdRaekke({ created_at: new Date('2026-11-21T09:00:00Z'), team1_name: 'H', team2_name: 'L', category: 'DS', status: 'pending' });
    assert.equal(ikke[8], 'Ikke spillet');
    assert.equal(ikke[9], '');

    const t = eksport.turneringRaekke({
        finished_at: new Date('2026-11-21T10:00:00Z'), started_at: new Date('2026-11-21T09:35:30Z'),
        tournament_name: 'Lyngby', label: 'U11 HS — Runde 1', court_number: 4,
        side1_player1: 'Ea', side2_player1: 'Ib', winner_team: 1, set_scores: 'Ea 15-3 Ib, Ea 15-4 Ib'
    });
    assert.deepEqual(t, ['21-11-2026 11:00', 'Lyngby', 'U11 HS — Runde 1', 4, 'Ea', 'Ib', 'Ea', '15-3 15-4', '24:30']);
});

test('48: rækkerne hentes i bidder — aldrig hele tabellen på én gang', async () => {
    const alle = Array.from({ length: 2503 }, (_, i) => ({ id: 2503 - i }));
    const hentet = [];
    await eksport.hentIBidder(async (efter, antal) => {
        hentet.push({ efter, antal });
        const fra = efter === null ? alle : alle.filter(r => r.id < efter);
        return fra.slice(0, antal);
    }, async () => {}, 1000);
    assert.deepEqual(hentet, [{ efter: null, antal: 1000 }, { efter: 1504, antal: 1000 }, { efter: 504, antal: 1000 }]);
    assert.equal(eksport.BID, 1000);
});

test('48: eksport-ruterne — samme adgang som historikken, før parameter-ruterne, CSV i bidder', async () => {
    for (const [router, navn] of [[matchHistory, 'match-history'], [teamMatches, 'team-matches'], [tournaments, 'tournaments']]) {
        const l = lag(router, 'get', '/export.csv');
        const h = l.route.stack.map(s => s.handle);
        assert.equal(h[0], authMiddleware, `${navn}: login`);
        const hist = lag(router, 'get', navn === 'match-history' ? '/all' : '/history');
        assert.equal(hist.route.stack[1].handle.toString(), l.route.stack[1].handle.toString(), `${navn}: requirePage som historikken`);
        const fn = l.route.stack[1].handle;
        let næste = false;
        fn({ user: { role: 'club_admin', permissions: ['history'] } }, falskSvar(), () => { næste = true; });
        assert.ok(næste, `${navn}: adgang med siden history`);
        const res = falskSvar();
        fn({ user: { role: 'club_admin', permissions: ['holdkamp'] } }, res, () => assert.fail('uden history'));
        assert.equal(res.statusKode, 403);
    }
    assert.ok(indeks(matchHistory, 'get', '/export.csv') < indeks(matchHistory, 'get', '/:courtId'), 'før /:courtId');

    // Kamphistorikken: overskrift, BOM, bidder med keyset (id < sidste)
    let n = 0;
    nulstil(async (sql, p) => {
        n++;
        if (n === 1) return Array.from({ length: 1000 }, (_, i) => ({ id: 2000 - i, winner_name: '=1+1', loser_name: 'Bo', games_won: '2-0', set_scores: '=1+1 15-1 Bo', duration: '10:00', match_date: new Date('2026-11-21T09:00:00Z'), court_number: 1 }));
        if (n === 2) return [{ id: 5, winner_name: 'Ea', loser_name: 'Ib', games_won: 'W.O.', set_scores: 'Walkover', duration: '00:00', match_date: new Date('2026-11-21T09:00:00Z'), court_number: null }];
        return [];
    });
    const res = await koer(rute(matchHistory, 'get', '/export.csv'), {});
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    assert.match(res.headers['content-disposition'], /^attachment; filename="kamphistorik-\d{4}-\d{2}-\d{2}\.csv"$/);
    const csv = res.dele.join('');
    assert.ok(csv.startsWith('﻿Dato;Bane;Vinder;Taber;Sæt;Sætcifre (vinder først);Varighed\r\n'));
    assert.equal(csv.split('\r\n').length - 2, 1001);
    assert.match(csv, /\r\n21-11-2026 10:00;1;'=1\+1;Bo;2-0;15-1;10:00\r\n/);
    assert.match(csv, /\r\n21-11-2026 10:00;;Ea;Ib;W\.O\.;W\.O\.;00:00\r\n$/);
    assert.ok(res.slut);
    assert.equal(kald.length, 2);
    assert.match(kald[0].sql, /ORDER BY mh\.id DESC LIMIT 1000/);
    assert.doesNotMatch(kald[0].sql, /WHERE mh\.id < \?/);
    assert.match(kald[1].sql, /WHERE mh\.id < \?/);
    assert.deepEqual(kald[1].params, [1001]);

    // Holdkampe og turneringer: kun afsluttede, keyset
    nulstil(async () => []);
    const hk = await koer(rute(teamMatches, 'get', '/export.csv'), {});
    assert.match(kald[0].sql, /WHERE tm\.status = 'finished'/);
    assert.ok(hk.dele.join('').startsWith('﻿Dato;Holdkamp;Delkamp;Bane;Hold 1;'));
    nulstil(async () => []);
    const tu = await koer(rute(tournaments, 'get', '/export.csv'), {});
    assert.match(kald[0].sql, /WHERE m\.status = 'finished'/);
    assert.ok(tu.dele.join('').startsWith('﻿Dato;Turnering;Kamp;Bane;Side 1;Side 2;Vinder;'));

    // En fejl midt i strømmen: forbindelsen lukkes (ingen halv fil med 200 og "OK")
    let m = 0;
    nulstil(async () => { m++; if (m === 1) return Array.from({ length: 1000 }, (_, i) => ({ id: 1000 - i })); throw new Error('DB væk'); });
    const brudt = await koer(rute(matchHistory, 'get', '/export.csv'), {});
    assert.ok(brudt.oedelagt);
    assert.ok(!brudt.slut);
});

// ======================= Nr. 48: ret og slet én kamp =======================

test('48: rettelsen bruger tællerens regler og skriver rækken som "Indtast resultat" på banen', () => {
    const ok = rettetRaekke({ side1: 'Jens & Bo', side2: 'Anna & Lis', gameMode: '15', winner: 2, sets: [[15, 7], [13, 15], [9, 15]] });
    assert.deepEqual(ok.felter, {
        winner_name: 'Anna & Lis', loser_name: 'Jens & Bo', games_won: '2-1',
        set_scores: 'Jens & Bo 15-7 Anna & Lis, Jens & Bo 13-15 Anna & Lis, Jens & Bo 9-15 Anna & Lis'
    });
    // Før tid: kun sidste sæt afbrudt, vinderen vælges frit
    const tidligt = rettetRaekke({ side1: 'A', side2: 'B', winner: 2, sets: [[15, 10], [8, 3]] });
    assert.equal(tidligt.felter.set_scores, 'A 15-10 B, A 8-3 B (afsluttet før tid)');
    assert.equal(tidligt.felter.games_won, '0-1');
    assert.equal(tidligt.felter.winner_name, 'B');
    // Walkover
    assert.deepEqual(rettetRaekke({ side1: 'A', side2: 'B', winner: 1, walkover: true }).felter,
        { winner_name: 'A', loser_name: 'B', games_won: 'W.O.', set_scores: 'Walkover' });
    // 21-format
    assert.equal(rettetRaekke({ side1: 'A', side2: 'B', gameMode: '21', winner: 1, sets: [[21, 19], [23, 21]] }).felter.games_won, '2-0');
    // Afvisninger — tællerens tekster
    assert.match(rettetRaekke({ side1: 'A', side2: 'B', winner: 1, sets: [[25, 10]] }).error, /højst gå til 21/);
    assert.match(rettetRaekke({ side1: 'A', side2: 'B', winner: 1, sets: [[15, 10], [15, 3], [15, 1]] }).error, /afgjort efter sæt 2/);
    assert.match(rettetRaekke({ side1: 'A', side2: 'B', winner: 2, sets: [[15, 10], [15, 3]] }).error, /vundet 2 sæt/);
    assert.match(rettetRaekke({ side1: 'A', side2: 'B', winner: 1, sets: [[10, 8], [15, 3]] }).error, /Sæt 1 er ikke spillet færdigt/);
    assert.match(rettetRaekke({ side1: '', side2: 'B', winner: 1, sets: [[15, 1], [15, 1]] }).error, /navn/);
    assert.match(rettetRaekke({ side1: 'A', side2: 'A', winner: 1, sets: [[15, 1], [15, 1]] }).error, /forskellige/);
    assert.match(rettetRaekke({ side1: 'x'.repeat(101), side2: 'B', winner: 1, sets: [[15, 1], [15, 1]] }).error, /100 tegn/);
    assert.match(rettetRaekke({ side1: 'A', side2: 'B', gameMode: '11', winner: 1, sets: [[15, 1], [15, 1]] }).error, /pointformat/);
    assert.match(rettetRaekke({ side1: 'A', side2: 'B', winner: 3, sets: [[15, 1], [15, 1]] }).error, /hvem der vandt/);
    // Styretegn i navne fjernes
    assert.equal(rettetRaekke({ side1: 'A\u0000\nB', side2: 'C', winner: 1, walkover: true }).felter.winner_name, 'A B');
    // Reglerne kodes ikke en gang til
    const src = laes('backend/config/historikRettelse.js');
    assert.match(src, /require\('\.\/kampResultat'\)/);
    assert.doesNotMatch(src, /saetFaerdigt|maks:\s*30/);
});

test('48: PUT og DELETE /api/match-history/:id — login + siden history, efter /all', async () => {
    for (const metode of ['put', 'delete']) {
        const h = lag(matchHistory, metode, '/:id').route.stack.map(s => s.handle);
        assert.equal(h[0], authMiddleware);
        assert.equal(h.length, 3);
    }
    assert.ok(indeks(matchHistory, 'delete', '/all') < indeks(matchHistory, 'delete', '/:id'), '"all" er aldrig et id');

    // Ret
    nulstil(async (sql) => {
        if (/^UPDATE match_history/.test(sql)) return { affectedRows: 1 };
        if (/^SELECT/.test(sql)) return [{ id: 7, winner_name: 'B' }];
        return [];
    });
    const put = rute(matchHistory, 'put', '/:id');
    const r = await koer(put, { params: { id: '7' }, body: { side1: 'A', side2: 'B', winner: 2, walkover: true } });
    assert.equal(r.statusKode, 200);
    assert.deepEqual(kald[0].params, ['B', 'A', 'W.O.', 'Walkover', 7]);
    assert.doesNotMatch(kald[0].sql, /duration/, 'varigheden røres ikke');
    assert.deepEqual(r.krop.match, { id: 7, winner_name: 'B' });
    // Ugyldigt → 422 med tællerens tekst, intet skrevet
    nulstil();
    const u = await koer(put, { params: { id: '7' }, body: { side1: 'A', side2: 'B', winner: 1, sets: [[30, 1]] } });
    assert.equal(u.statusKode, 422);
    assert.equal(kald.length, 0);
    assert.equal((await koer(put, { params: { id: 'all' }, body: {} })).statusKode, 400);
    nulstil(async () => ({ affectedRows: 0 }));
    assert.equal((await koer(put, { params: { id: '9' }, body: { side1: 'A', side2: 'B', winner: 1, walkover: true } })).statusKode, 404);

    // Slet: rækken og banens kobling til den
    nulstil(async () => ({ affectedRows: 1 }));
    const del = rute(matchHistory, 'delete', '/:id');
    const d = await koer(del, { params: { id: '7' } });
    assert.equal(d.statusKode, 200);
    assert.match(kald[0].sql, /^DELETE FROM match_history WHERE id = \?/);
    assert.deepEqual(kald[0].params, [7]);
    assert.match(kald[1].sql, /UPDATE game_states SET result_history_id = NULL WHERE result_history_id = \?/);
    nulstil(async () => ({ affectedRows: 0 }));
    assert.equal((await koer(del, { params: { id: '7' } })).statusKode, 404);
    assert.equal((await koer(del, { params: { id: '1; DROP' } })).statusKode, 400);
});

test('48: admin — ret/slet pr. kamp med bekræftelse, før tid og ret i turneringshistorikken, eksportknapper', () => {
    const a = laes('frontend/admin-script.js');
    const html = laes('frontend/admin.html');
    // Enkeltkampe
    assert.match(a, /api\.request\(`\/match-history\/\$\{id\}`, \{ method: 'PUT'/);
    assert.match(a, /BadmintonUtils\.confirmDialog\('Slet kampen\?'[\s\S]*?danger: true/);
    assert.match(a, /api\.request\(`\/match-history\/\$\{id\}`, \{ method: 'DELETE' \}\)/);
    assert.doesNotMatch(a, /[^.\w]confirm\(/, 'ingen native confirm');
    // Turnering: før tid + historikken bruger samme formular
    assert.match(a, /function toggleTurneringFoerTid\(id\)/);
    assert.match(a, /\+ \(foerTid \? AFSLUTTET_FOER_TID : ''\)/);
    assert.match(a, /renderTurneringResultatForm\(t\.id, m, 'historik'\)/);
    assert.match(a, /function findTurneringskamp\(tournamentId, matchId\)/);
    assert.match(a, /rawSetScores = String\(rawSetScores\)\.replace\(\/ \\\(afsluttet før tid\\\)\$\/, ''\)/);
    // Holdkampens "Rediger resultat" er urørt
    assert.match(a, /Rediger resultat/);
    // Eksport
    for (const t of ['single', 'team', 'tournament']) assert.match(html, new RegExp(`data-eksport="${t}"`));
    assert.match(a, /single: '\/match-history\/export\.csv'/);
    assert.match(a, /team: '\/team-matches\/export\.csv'/);
    assert.match(a, /tournament: '\/tournaments\/export\.csv'/);
    assert.match(a, /Authorization: `Bearer \$\{api\.token\}`/);
    // Versioner
    assert.match(html, /admin-script\.js\?v=120/);
    assert.match(html, /admin-styles\.css\?v=36/);
});
