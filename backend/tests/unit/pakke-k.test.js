/**
 * Pakke K — nr. 74–82 (holdkamp, turnering, badmintonplanner; fundliste 2,
 * november 2026).
 *
 * Databasen erstattes af en optager, FØR ruterne indlæses (de henter
 * query/queryOne ud ved indlæsningen). node --test kører hver fil i sin egen
 * proces, så det rammer ikke andre tests.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

// ---------- Falsk database ----------
const db = require('../../config/database');
let svar = async () => [];          // (sql, params) → rækker / resultat
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
db.transaktion = async (fn) => {
    kald.push({ sql: 'BEGIN' });
    try {
        const r = await fn({ query: db.query, queryOne: db.queryOne });
        kald.push({ sql: 'COMMIT' });
        return r;
    } catch (e) {
        kald.push({ sql: 'ROLLBACK' });
        throw e;
    }
};
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };

const planner = require('../../routes/plannerIntegration');
const tournaments = require('../../routes/tournaments');
const teamMatches = require('../../routes/teamMatches');
const baneTildeling = require('../../config/baneTildeling');
const matchSessionTokens = require('../../routes/matchSessionTokens');
const holdkampFormater = require('../../config/holdkampFormater');
const { plannerNoegle } = require('../../middleware/rateLimiter');
const { autoRydSql } = require('../../config/banerydning');
const { splitStatements } = require('../../config/migrationRunner');

// ---------- Nr. 74: sync parrer på spillerne før løbenummeret ----------

const raekke = (id, sid, s1, s2, status = 'pending') => ({
    id, source_match_id: sid, status,
    side1_player1: s1[0] || null, side1_player2: s1[1] || null,
    side2_player1: s2[0] || null, side2_player2: s2[1] || null
});
const ts = (sid, s1, s2) => ({
    sourceMatchId: sid,
    side1Player1: s1[0] || '', side1Player2: s1[1] || '',
    side2Player1: s2[0] || '', side2Player2: s2[1] || ''
});

test('74: TS flytter kampene — den færdige kamps spillere havner ikke på en ventende række', () => {
    const existing = [
        raekke(1, '7#R1#0', ['Anna'], ['Berit'], 'finished'),
        raekke(2, '7#R1#1', ['?'], ['?'])
    ];
    // Kampene har byttet plads hos TS
    const incoming = [ts('7#R1#0', ['Carl'], ['Dorte']), ts('7#R1#1', ['Anna'], ['Berit'])];
    const par = tournaments.parSyncKampe(existing, incoming);
    assert.equal(par[1].row.id, 1, 'Anna–Berit er stadig række 1 (færdig)');
    assert.equal(par[0].row.id, 2, 'Carl–Dorte fylder pladsholderen');
    // Før: Anna–Berit (løbenummer 1) blev skrevet ind i række 2 — en dublet
});

test('74: to pladsholdere, der bytter plads, finder hinanden', () => {
    const existing = [raekke(1, '7#R1#0', ['Anna'], ['Berit']), raekke(2, '7#R1#1', [], [])];
    const incoming = [ts('7#R1#0', ['?'], ['?']), ts('7#R1#1', ['Anna'], ['Berit'])];
    const par = tournaments.parSyncKampe(existing, incoming);
    assert.equal(par[1].row.id, 1);
    assert.equal(par[0].row.id, 2);
    assert.ok(par.every(p => p.row), 'ingen nye kandidater');
});

test('74: en udskiftning af én spiller parres stadig på id (og siderne må være byttet)', () => {
    const existing = [raekke(1, '7#R1#0', ['Anna', 'Eva'], ['Berit', 'Fie'])];
    const par = tournaments.parSyncKampe(existing, [ts('7#R1#0', ['Berit', 'Fie'], ['Anna', 'Gry'])]);
    assert.equal(par[0].row.id, 1);
    const ombyttet = tournaments.parSyncKampe(existing, [ts('7#R1#5', ['Berit', 'Fie'], ['Anna', 'Eva'])]);
    assert.equal(ombyttet[0].row.id, 1, 'samme spillere, andet løbenummer og byttede sider');
});

test('74: helt andre spillere på et brugt id bliver en ny kamp med unikt id', () => {
    const existing = [raekke(1, '7#R1#0', ['Anna'], ['Berit'])];
    const par = tournaments.parSyncKampe(existing, [ts('7#R1#0', ['Carl'], ['Dorte'])]);
    assert.equal(par[0].row, null);
    assert.equal(par[0].sourceMatchId, '7#R1#0~2');
    // Næste sync finder den igen på spillerne
    const igen = tournaments.parSyncKampe(
        [...existing, raekke(2, '7#R1#0~2', ['Carl'], ['Dorte'])],
        [ts('7#R1#0', ['Carl'], ['Dorte'])]);
    assert.equal(igen[0].row.id, 2);
    assert.equal(tournaments.rundeScopeOf('7#R1#3~2'), '7#R1');
    assert.equal(tournaments.rundeScopeOf('7#R1#3~d17'), '7#R1');
});

test('74: kun samme draw og runde — en spiller i flere puljekampe forveksles ikke', () => {
    const existing = [raekke(1, '7#R1#0', ['Anna'], ['Berit']), raekke(2, '7#R2#0', ['Anna'], ['Carl'])];
    const par = tournaments.parSyncKampe(existing, [ts('7#R2#0', ['Anna'], ['Carl']), ts('7#R1#0', ['Anna'], ['Berit'])]);
    assert.equal(par[0].row.id, 2);
    assert.equal(par[1].row.id, 1);
});

// ---------- Nr. 75: stor import, og en fejlet import efterlader intet ----------

test('75: kun import- og bulk-ruten får 5 MB; resten har standardgrænsen', () => {
    const kilde = laes('backend/server.js');
    const m = kilde.match(/const STOR_JSON = (\/.+\/);/);
    assert.ok(m, 'STOR_JSON findes');
    const re = eval(m[1]);   // eslint-disable-line no-eval
    assert.ok(re.test('/api/tournaments/import'));
    assert.ok(re.test('/api/tournaments/12/matches/bulk'));
    assert.ok(!re.test('/api/tournaments/12/matches/3'));
    assert.ok(!re.test('/api/game-states/1'));
    assert.ok(!re.test('/api/integrations/planned-round'));
    assert.match(kilde, /express\.json\(\{ limit: '5mb' \}\)/);
    assert.doesNotMatch(kilde, /app\.use\(express\.json\(\)\)/);
});

test('75: import opretter turnering og kampe i én transaktion', () => {
    const kilde = laes('backend/routes/tournaments.js');
    assert.match(kilde, /router\.post\('\/import'[\s\S]{0,2500}transaktion\(async \(tx\)[\s\S]{0,1500}INSERT INTO tournaments[\s\S]{0,800}indsaetKampe\(tx,/);
    assert.match(laes('frontend/admin-script.js'), /api\.importTournament\(/);
    assert.match(laes('frontend/js/api.js'), /importTournament\(name, sourceTournamentId, matches\)/);
});

// ---------- Nr. 76: badmintonplanner — afvist/uændret bane beholder sin tildeling ----------

test('76: sammeKamp og beholdTildeling', () => {
    const a = { side1_player1: 'Anna', side1_player2: null, side2_player1: 'Berit', side2_player2: '' };
    assert.ok(planner.sammeKamp(a, { side1: ['Anna', ''], side2: ['Berit', null] }));
    assert.ok(!planner.sammeKamp(a, { side1: ['Anna', ''], side2: ['Carl', null] }));
    const res = [
        { courtNumber: 1, status: 'shown' },
        { courtNumber: 2, status: 'rejected', reason: 'match_in_progress' },
        { courtNumber: 3, status: 'shown', unchanged: true },
        { courtNumber: 4, status: 'rejected', reason: 'court_not_allowed' },
        { courtNumber: 5, status: 'cleared' }
    ];
    assert.deepEqual(planner.beholdTildeling(res), [2, 3]);
});

test('76: gemRunde sletter ikke de beholdte baners tildeling og indsætter ikke den uændrede igen', async () => {
    nulstil(async (sql) => (/INSERT INTO planner_rounds/.test(sql) ? { insertId: 99 } : { affectedRows: 0 }));
    const runde = {
        roundId: 'r2-b', sequence: 2, matches: [
            { courtNumber: 1, side1: ['A', null], side2: ['B', null], substitutes: [] },
            { courtNumber: 2, side1: ['C', null], side2: ['D', null], substitutes: [] },
            { courtNumber: 3, side1: ['E', null], side2: ['F', null], substitutes: [] }
        ]
    };
    const results = [
        { courtNumber: 1, status: 'shown' },
        { courtNumber: 2, status: 'rejected', reason: 'match_in_progress' },
        { courtNumber: 3, status: 'shown', unchanged: true }
    ];
    await planner.gemRunde(runde, 5, results);
    const sletA = kald.find(k => /DELETE a FROM planner_court_assignments/.test(k.sql));
    assert.match(sletA.sql, /a\.court_number NOT IN \(\?, \?\)/);
    assert.deepEqual(sletA.params, [5, 2, 3]);
    const sletR = kald.find(k => /DELETE FROM planner_rounds/.test(k.sql));
    assert.match(sletR.sql, /NOT IN \(SELECT round_id FROM planner_court_assignments\)/, 'en runde med en beholdt tildeling bliver stående');
    const indsat = kald.filter(k => /INSERT INTO planner_court_assignments/.test(k.sql)).map(k => k.params[0]);
    assert.deepEqual(indsat, [1], 'kun den nye bane; den uændrede har sin række');
});

test('76: dokumentationen beskriver genforsøg med hele runden og unchanged', () => {
    const doc = laes('docs/badmintonplanner-api.md');
    assert.match(doc, /`unchanged`/);
    assert.match(doc, /nyt `roundId`/);
    assert.doesNotMatch(doc, /Genforsøg kun baner, der blev afvist/);
});

// ---------- Nr. 77: planner-grænsen tæller pr. klub ----------

test('77: samme nøgle-id i to klubber deler ikke grænse', () => {
    const req = (klub, id) => ({ clubDbName: klub, plannerToken: id ? { id } : null, headers: {}, socket: { remoteAddress: '1.2.3.4' } });
    assert.notEqual(plannerNoegle(req('badminton_a', 1)), plannerNoegle(req('badminton_b', 1)));
    assert.equal(plannerNoegle(req('badminton_a', 1)), plannerNoegle(req('badminton_a', 1)));
    assert.match(plannerNoegle(req('badminton_a', null)), /ip:1\.2\.3\.4$/);
});

// ---------- Nr. 78: tildeling til en bane, hvor der spilles ----------

test('78: tildelingAfvist — kørende kamp afvises, uden force', () => {
    const koerer = { player1_score: 3, player2_score: 1, player1_games: 0, player2_games: 0, timer_seconds: 80, match_completed: 0 };
    const afsluttet = { ...koerer, player1_games: 2, match_completed: 1 };
    const tom = { player1_score: 0, player2_score: 0, player1_games: 0, player2_games: 0, timer_seconds: 0, match_completed: 0 };
    assert.equal(baneTildeling.tildelingAfvist({ stilling: koerer }).code, 'bane_i_gang');
    assert.equal(baneTildeling.tildelingAfvist({ stilling: koerer, force: true }), null);
    assert.equal(baneTildeling.tildelingAfvist({ stilling: koerer, force: 'true' }).code, 'bane_i_gang', 'kun boolsk true');
    assert.equal(baneTildeling.tildelingAfvist({ stilling: koerer, sammeBane: true }), null);
    assert.equal(baneTildeling.tildelingAfvist({ stilling: afsluttet }), null, 'afsluttet kamp ryddes som før');
    assert.equal(baneTildeling.tildelingAfvist({ stilling: tom }), null);
    assert.equal(baneTildeling.tildelingAfvist({ stilling: null }), null);
});

test('78: tjekOgRydBane — afviser, eller afbryder kampen ved force', async () => {
    const koerer = { player1_score: 3, player2_score: 0, player1_games: 0, player2_games: 0, timer_seconds: 0, match_completed: 0 };
    nulstil(async (sql) => (/FROM courts c JOIN game_states/.test(sql) ? [koerer]
        : /SELECT id FROM courts/.test(sql) ? [{ id: 7 }] : { affectedRows: 1 }));
    const afvist = await baneTildeling.tjekOgRydBane(4, { clubDbName: 'x', body: {} });
    assert.equal(afvist.code, 'bane_i_gang');
    assert.ok(!kald.some(k => /DELETE FROM game_states/.test(k.sql)));

    kald = [];
    assert.equal(await baneTildeling.tjekOgRydBane(4, { clubDbName: 'x', body: { force: true } }), null);
    const slet = kald.find(k => /DELETE FROM game_states WHERE court_id = \?/.test(k.sql));
    assert.deepEqual(slet.params, [7], 'den afbrudte kamps stilling arves ikke af den nye kamp');
});

test('78: ruterne bruger tjekket (ikke for tabletten) og fjerner planner-tildelingen', () => {
    const tm = laes('backend/routes/teamMatches.js');
    assert.match(tm, /if \(!erEnhed\) \{\s*const afvist = await baneTildeling\.tjekOgRydBane\(courtNumber, req\);\s*if \(afvist\) return res\.status\(409\)\.json\(afvist\);/);
    assert.match(tm, /fjernPlannerTildeling\(courtNumber\)/);
    const tu = laes('backend/routes/tournaments.js');
    assert.match(tu, /req\.user\?\.role !== 'device'[\s\S]{0,200}tjekOgRydBane\(courtNumber, req\)/);
    assert.match(tu, /fjernPlannerTildeling\(courtNumber\)/);
    const admin = laes('frontend/admin-script.js');
    assert.match(admin, /error\.body\?\.code !== 'bane_i_gang'/);
    assert.match(admin, /medBaneBekraeftelse\(\(force\) => api\.updateTeamMatchGame/);
    assert.match(admin, /medBaneBekraeftelse\(\(force\) => api\.updateTournamentMatch/);
    // Turneringskampen tildeles før navnene skrives
    const save = admin.slice(admin.indexOf('async function performSaveCourtChanges'));
    assert.ok(save.indexOf('updateTournamentMatch') < save.indexOf('api.updateCourt('));
});

// ---------- Nr. 79: auto-ryd tæller kun den aktuelle kamps delkamp ----------

test('79: delkampen skal være færdig efter, at kampen på banen begyndte', () => {
    const sql = autoRydSql();
    assert.match(sql, /gs\.match_start_time IS NOT NULL/);
    assert.match(sql, /g\.finished_at >= gs\.match_start_time/);
    assert.match(sql, /m\.finished_at >= gs\.match_start_time/);
});

// ---------- Nr. 80: holdsedlen er først frigivet, når spillerne er på ----------

test('80: holdseddelKlar', () => {
    const start = new Date('2026-11-14T13:00:00Z');
    const foer = new Date('2026-11-14T12:05:00Z');   // 55 min før
    const taet = new Date('2026-11-14T12:35:00Z');   // 25 min før
    const seddel = (games) => ({ team1Name: 'A', team2Name: 'B', games });
    const fuld = seddel([
        { category: 'HS', team1Player1: 'a', team2Player1: 'b' },
        { category: 'HD', team1Player1: 'a', team1Player2: 'c', team2Player1: 'b', team2Player2: 'd' }
    ]);
    assert.deepEqual(holdkampFormater.holdseddelKlar(fuld, { start, nu: foer }), { klar: true, mangler: 0 });

    const udenSpillere = seddel([{ category: 'HS', team1Player1: '', team2Player1: '' }, { category: 'HD', team1Player1: '', team2Player1: '' }]);
    assert.equal(holdkampFormater.holdseddelKlar(udenSpillere, { start, nu: taet }).klar, false, 'aldrig uden spillere');

    const halv = seddel([{ category: 'HS', team1Player1: 'a', team2Player1: '' }, { category: 'HD', team1Player1: 'a', team1Player2: 'c', team2Player1: '', team2Player2: null }]);
    assert.equal(holdkampFormater.holdseddelKlar(halv, { start, nu: taet }).klar, false, 'det ene hold har ikke sat spillere på');

    const afbud = seddel([
        { category: 'HS', team1Player1: 'a', team2Player1: '' },
        { category: 'HD', team1Player1: 'a', team1Player2: 'c', team2Player1: 'b', team2Player2: 'd' }
    ]);
    assert.deepEqual(holdkampFormater.holdseddelKlar(afbud, { start, nu: foer }), { klar: false, mangler: 1 });
    assert.deepEqual(holdkampFormater.holdseddelKlar(afbud, { start, nu: taet }), { klar: true, mangler: 1 }, 'tæt på kampstart er en tom plads et afbud');

    const makkerMangler = seddel([{ category: 'DD', team1Player1: 'a', team1Player2: '', team2Player1: 'b', team2Player2: 'd' }]);
    assert.equal(holdkampFormater.holdseddelKlar(makkerMangler, { start, nu: foer }).mangler, 1);
    assert.equal(holdkampFormater.holdseddelKlar(seddel([]), { start, nu: taet }).klar, false);
    assert.equal(holdkampFormater.holdseddelKlar({ team1Name: '', team2Name: 'B', games: fuld.games }, { start, nu: taet }).klar, false);
});

test('80: holdkamp-køen bruger holdseddelKlar', () => {
    const kilde = laes('backend/routes/importHoldkamp.js');
    assert.match(kilde, /const \{ klar, mangler \} = holdseddelKlar\(seddel, \{ start: info\.tid \|\| w\.start_time \}\);\s*if \(!klar\)/);
});

// ---------- Nr. 81: holdkamp og kø i én transaktion; UNIQUE på kilde-id ----------

test('81: opretHoldkamp kører i én transaktion, og køens status er med i den', async () => {
    nulstil(async (sql) => (/^SELECT/.test(sql.trim()) ? [] : { insertId: 41, affectedRows: 1 }));
    const id = await teamMatches.opretHoldkamp(
        { format: '4spillere', team1Name: 'A', team2Name: 'B', games: [{ category: 'HS' }, { category: 'DS' }] },
        (tx, tmId) => tx.query('UPDATE holdkamp_watchers SET status = ?', ['oprettet', tmId]));
    assert.equal(id, 41);
    const sqls = kald.map(k => k.sql.trim().split(/\s+/).slice(0, 3).join(' '));
    assert.equal(sqls[0], 'BEGIN');
    assert.equal(sqls[sqls.length - 1], 'COMMIT');
    assert.ok(kald.some(k => /UPDATE holdkamp_watchers/.test(k.sql)));

    // Fejler køens opdatering, rulles holdkampen tilbage
    nulstil(async (sql) => {
        if (/UPDATE holdkamp_watchers/.test(sql)) throw new Error('forbindelsen røg');
        return /^SELECT/.test(sql.trim()) ? [] : { insertId: 42 };
    });
    await assert.rejects(teamMatches.opretHoldkamp(
        { format: 'x', team1Name: 'A', team2Name: 'B', games: [{ category: 'HS' }] },
        (tx) => tx.query('UPDATE holdkamp_watchers SET status = ?', ['oprettet'])), /forbindelsen røg/);
    assert.equal(kald[kald.length - 1].sql, 'ROLLBACK');

    const kilde = laes('backend/routes/importHoldkamp.js');
    assert.match(kilde, /await opretHoldkamp\(\{[\s\S]{0,300}\}, \(tx, id\) => tx\.query\(\s*`UPDATE holdkamp_watchers SET status = 'oprettet'/);
});

test('81: migration 044 fjerner dubletter ikke-destruktivt før UNIQUE', () => {
    const sql = laes('backend/migrations/044_unik_turneringskamp_kilde.sql');
    const dele = splitStatements(sql);
    assert.equal(dele.length, 2);
    assert.match(dele[0], /^UPDATE tournament_matches t\s+JOIN/m);
    assert.match(dele[0], /HAVING COUNT\(\*\) > 1/);
    assert.match(dele[0], /t\.id <> d\.behold/);
    assert.match(dele[0], /CONCAT\(LEFT\(t\.source_match_id, 100\), '~d', t\.id\)/);
    assert.match(dele[1], /ADD UNIQUE KEY uq_tournament_source_match \(tournament_id, source_match_id\)/);
    assert.doesNotMatch(sql, /DELETE/i);
});

// ---------- Nr. 82: QR-sessioner og officielle kampe ----------

// En holdkamps delkamp må QR-telefonen gerne tælle (Jesper, 2026-11-13) —
// turneringskampe stadig ikke
test('82: ingen QR-session på en bane med en turneringskamp', async () => {
    nulstil(async (sql) => (/AS optaget/.test(sql) ? [{ optaget: 1 }] : []));
    assert.equal(await baneTildeling.turneringPaaBane(3), true);
    assert.match(kald[0].sql, /FROM tournament_matches/);
    assert.doesNotMatch(kald[0].sql, /team_match_games/, 'en holdkamp spærrer ikke QR-koden');
    // getOrCreateActiveToken er ikke eksporteret — QR-ruten kalder den; tjek kilden
    const kilde = laes('backend/routes/matchSessionTokens.js');
    const fn = kilde.slice(kilde.indexOf('async function getOrCreateActiveToken'));
    assert.ok(fn.indexOf('turneringPaaBane') < fn.indexOf('getActiveToken(courtNumber)'),
        'tjekkes før en eksisterende session genbruges');
    assert.match(fn, /if \(await turneringPaaBane\(courtNumber\)\) return null;/);
    nulstil(async () => [{ optaget: 0 }]);
    assert.equal(await baneTildeling.turneringPaaBane(3), false);
    assert.ok(matchSessionTokens.getActiveToken);
});

test('82: game-states melder kun en delkamp ind fra en QR-session og spærrer den på turneringsbaner', () => {
    const kilde = laes('backend/routes/gameStates.js');
    assert.match(kilde, /meldAfgjortKamp\(req, courtId, frisk, \{ kunHoldkamp: erQrSession\(req\.user\) \}\)/);
    assert.match(kilde, /meldAfgjortKamp\(req, courtId, existing, \{ erDouble: !!court\.is_doubles, kunHoldkamp: erQrSession\(req\.user\) \}\)/);
    assert.match(kilde, /if \(await turneringPaaBane\(parseInt\(req\.params\.courtId, 10\)\)\)/);
    for (const rute of ["router.put('/:courtId'", "router.post('/:courtId/taeller'", "router.post('/:courtId/result'", "router.delete('/:courtId'"]) {
        const linje = kilde.slice(kilde.indexOf(rute)).split('\n')[0];
        assert.match(linje, /kunEgenBane\('courtId'\), qrIkkeOfficielBane,/, rute);
    }
});

// ---------- Rest fra pakke G: banetal tjekker også planner-tildelinger ----------

test('Antal baner kan ikke sættes ned under en badmintonplanner-kamp', () => {
    assert.match(laes('backend/routes/settings.js'), /FROM planner_court_assignments WHERE court_number > \?/);
});
