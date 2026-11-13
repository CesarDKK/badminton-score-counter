/**
 * Pakke N — nr. 43–47 (admin; fundliste 1, november 2026).
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
const vm = require('vm');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed';

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

// ---------- Falsk database ----------
const db = require('../../config/database');
let svar = async () => [];
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

const jwt = require('jsonwebtoken');
const auth = require('../../middleware/auth');
const teamMatches = require('../../routes/teamMatches');
const deviceTokens = require('../../routes/deviceTokens');
const { splitStatements } = require('../../config/migrationRunner');
const klubBackup = require('../../config/klubBackup');

// Rutens sidste handler (efter middleware)
function rute(router, metode, sti) {
    const lag = router.stack.find(l => l.route && l.route.path === sti && l.route.methods[metode]);
    assert.ok(lag, `${metode} ${sti} findes`);
    const s = lag.route.stack;
    return s[s.length - 1].handle;
}
function svarObjekt() {
    return {
        statusCode: 200, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; return this; },
    };
}

const adminScript = laes('frontend/admin-script.js');
// En funktion fra admin-scriptet (til vm-tests) — fra "function navn(" til næste top-level
function adminFunktion(navn) {
    const start = adminScript.search(new RegExp(`^(async )?function ${navn}\\(`, 'm'));
    assert.ok(start >= 0, navn);
    const rest = adminScript.slice(start);
    const slut = rest.search(/\n\}\r?\n/);
    return rest.slice(0, slut + 2);
}

// ======================= Nr. 43: livestream-admin =======================

test('43: "Gem" på én bane tegner kun dens felter forfra — de andres ugemte ændringer bevares', () => {
    const render = adminFunktion('renderLivestream');
    assert.match(render, /function renderLivestream\(gemt = null\)/);
    assert.match(render, /const ugemte = lsUgemteAendringer\(boks, gemt === null \? null : String\(gemt\)\);/);
    assert.ok(render.indexOf('lsUgemteAendringer') < render.indexOf('boks.innerHTML'), 'huskes før siden tegnes');
    assert.ok(render.indexOf('lsGenskabAendringer(boks, ugemte)') > render.indexOf('boks.innerHTML'), 'sættes ind bagefter');
    assert.match(adminFunktion('loadLivestream'), /renderLivestream\(gemt\)/);
    assert.match(adminFunktion('gemLivestream'), /await loadLivestream\(bane\);/);
    assert.match(adminFunktion('gemLivestreamIndstillinger'), /await loadLivestream\('faelles'\);/);
    // Statussen hvert 10. s klapper ikke et kort med ugemte ændringer sammen
    const refresh = adminFunktion('refreshLivestreamStatus');
    assert.match(refresh, /!\(tom && ugemte\.size\)/);
    assert.match(refresh, /lsGenskabAendringer\(nyt, ugemte\)/);
});

test('43: lsUgemteAendringer/lsGenskabAendringer husker ændrede felter pr. kort', () => {
    const kode = ['lsFeltAendret', 'lsFeltNoegle', 'lsUgemteAendringer', 'lsGenskabAendringer'].map(adminFunktion).join('\n')
        + `\nconst LS_UGEMTE_FELTER = 'x';`;
    // Minimal DOM: felter med standardværdi (det, siden blev tegnet med) og nuværende værdi
    const felt = (bane, klasse, type, std, nu) => ({
        type, tagName: type === 'select' ? 'SELECT' : 'INPUT', dataset: {},
        classList: Object.assign([klasse], { contains: (c) => c === klasse }),
        defaultChecked: std, checked: nu, defaultValue: std, value: nu, disabled: false,
        options: type === 'select' ? [{ selected: nu === 'klub', defaultSelected: std === 'klub' }] : [],
        closest: (sel) => (sel === '.ls-bane' && bane !== null ? { dataset: { bane: String(bane) } } : null),
    });
    const ctx = { kaldt: [], livestreamNoegleIndtastet() { ctx.kaldt.push('noegle'); },
        livestreamLydAendret() { ctx.kaldt.push('lyd'); }, livestreamIndstillingAendret() { ctx.kaldt.push('faelles'); } };
    vm.createContext(ctx);
    vm.runInContext(kode, ctx);

    const foer = [
        felt(1, 'ls-vend', 'checkbox', false, true),       // bane 1: ændret
        felt(2, 'ls-noegle', 'password', '', 'ny-noegle'), // bane 2: nøgle tastet
        felt(2, 'ls-lyd', 'checkbox', false, false),       // bane 2: uændret
        felt(3, 'ls-overlay', 'checkbox', true, true),     // bane 3: uændret
    ];
    const rod = { querySelectorAll: () => foer };
    const alle = ctx.lsUgemteAendringer(rod);
    assert.deepEqual([...alle.keys()].sort(), ['1:ls-vend', '2:ls-noegle']);
    // Bane 1 er lige gemt: dens ændring glemmes, bane 2's huskes
    const efterGem = ctx.lsUgemteAendringer(rod, '1');
    assert.deepEqual([...efterGem.keys()], ['2:ls-noegle']);

    // Siden tegnet forfra: bane 2's nøgle sættes ind igen, og fluebenet følger nøglen
    const nye = [felt(1, 'ls-vend', 'checkbox', true, true), felt(2, 'ls-noegle', 'password', '', '')];
    ctx.lsGenskabAendringer({ querySelectorAll: () => nye }, efterGem);
    assert.equal(nye[1].value, 'ny-noegle');
    assert.equal(nye[0].checked, true, 'den gemte bane tegnes fra serveren');
    assert.deepEqual(ctx.kaldt, ['noegle']);
});

test('43: knapperne siger, hvad de gemmer, og kortet viser "Ikke gemt"', () => {
    assert.match(adminScript, /onclick="gemLivestream\(\$\{b\.bane\}\)">Gem bane \$\{b\.bane\}<\/button>/);
    assert.match(adminScript, /onclick="gemLivestreamIndstillinger\(\)">Gem fælles indstillinger<\/button>/);
    assert.equal((adminScript.match(/class="maerke maerke--afventer ls-ugemt" hidden>Ikke gemt</g) || []).length, 2);
    assert.match(adminFunktion('renderLivestream'), /boks\.oninput = boks\.onchange = lsMarkerUgemte;/);
    // .maerke sætter display og ville ellers vinde over hidden — mærket stod der altid
    assert.match(laes('frontend/admin-styles.css'), /^\.maerke\[hidden\] \{ display: none; \}/m);
});

test('43: ingen tekniske ord i det, admin læser (ffmpeg, overlay, CPU)', () => {
    // Kun den synlige tekst — kommentarer og klassenavne må gerne nævne dem
    const synlig = adminScript
        .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
        .replace(/class="[^"]*"/g, '').replace(/\.ls-overlay|overlay: el\.|b\.overlay|messageOverlay/g, '');
    assert.doesNotMatch(synlig, /ffmpeg:/);
    assert.doesNotMatch(synlig, />[^<]*\bOverlay\b/);
    assert.doesNotMatch(synlig, /og overlay/);
    assert.doesNotMatch(synlig, /CPU'en/);
    assert.match(adminScript, /Billede og scoreboard/);
    assert.match(adminScript, /Kodningens sidste linjer:/);
});

// ======================= Nr. 44: genaktivér adgangslink =======================

test('44: sessionGyldigFra — sessioner fra før genaktiveringen afvises', () => {
    const { sessionGyldigFra } = auth;
    assert.equal(sessionGyldigFra(100, null), true, 'aldrig genaktiveret');
    assert.equal(sessionGyldigFra(undefined, null), true);
    assert.equal(sessionGyldigFra(1000, 1000), true, 'udstedt samme sekund');
    assert.equal(sessionGyldigFra(1001, '1000.000000'), true, 'mysql giver UNIX_TIMESTAMP som tekst');
    assert.equal(sessionGyldigFra(999, 1000), false, 'udstedt før');
    assert.equal(sessionGyldigFra(undefined, 1000), false, 'uden iat');
});

test('44: middleware giver sessionens iat med til opslaget, og en gammel session afvises', async () => {
    const set = [];
    auth._saetAdgangslinkOpslag(async (id, iat) => { set.push([id, iat]); return iat >= 2000; });
    try {
        const kør = async (iat) => {
            const t = jwt.sign({ role: 'device', tokenId: 5, iat }, process.env.JWT_SECRET);
            const req = { accessMode: 'club', clubSubdomain: undefined, headers: { authorization: `Bearer ${t}` } };
            const res = svarObjekt();
            let videre = false;
            await auth.requireWriteAuthInClubMode(req, res, () => { videre = true; });
            return { videre, res };
        };
        assert.equal((await kør(2500)).videre, true);
        const gammel = await kør(1500);
        assert.equal(gammel.videre, false);
        assert.equal(gammel.res.statusCode, 401);
        assert.equal(gammel.res.body.tokenRevoked, true);
        assert.deepEqual(set, [[5, 2500], [5, 1500]]);
    } finally {
        auth._saetAdgangslinkOpslag(async () => true);
    }
    // Det rigtige opslag sammenligner med sessioner_fra
    const kilde = laes('backend/middleware/auth.js');
    assert.match(kilde, /UNIX_TIMESTAMP\(sessioner_fra\) AS fra FROM device_tokens WHERE id = \? AND is_active = 1/);
    assert.match(kilde, /erAdgangslinkAktiv\(decoded\.tokenId, decoded\.iat\)/);
});

test('44: genaktivering giver ny adresse og nyt sessions-tidspunkt — kun for tilbagekaldte links', async () => {
    const genaktiver = rute(deviceTokens, 'put', '/:id/genaktiver');
    const kør = async () => { const res = svarObjekt(); let fejl = null; await genaktiver({ params: { id: '7' } }, res, (e) => { fejl = e; }); if (fejl) throw fejl; return res; };

    nulstil(async () => []);
    assert.equal((await kør()).statusCode, 404);

    nulstil(async () => [{ id: 7, is_active: 1, token_type: 'permanent' }]);
    assert.equal((await kør()).statusCode, 400, 'et aktivt link genaktiveres ikke');

    nulstil(async () => [{ id: 7, is_active: 0, token_type: 'match_session' }]);
    assert.equal((await kør()).statusCode, 404, 'QR-sessioner er ikke admins links');

    let gammelToken = 'a'.repeat(64);
    nulstil(async (sql) => (/^SELECT id, token, name/.test(sql.trim())
        ? [{ id: 7, token: 'ny', name: 'TV bane 2', is_active: 1 }]
        : [{ id: 7, is_active: 0, token_type: 'permanent', token: gammelToken }]));
    const res = await kør();
    assert.equal(res.statusCode, 200);
    const upd = kald.find(k => /^UPDATE device_tokens/.test(k.sql));
    assert.match(upd.sql, /SET token = \?, is_active = 1, sessioner_fra = UTC_TIMESTAMP\(\)/);
    assert.match(upd.params[0], /^[0-9a-f]{64}$/);
    assert.notEqual(upd.params[0], gammelToken);
    assert.equal(upd.params[1], '7');
});

test('44: dialogerne navngiver linket, og et tilbagekaldt link har "Genaktivér"', () => {
    assert.match(adminScript, /onclick="handleGenaktiverDeviceToken\(\$\{t\.id\}\)" class="btn-secondary btn-sm">Genaktivér<\/button>/);
    const tilbagekald = adminFunktion('handleDeleteDeviceToken');
    assert.match(tilbagekald, /Enheder, der bruger linket \$\{adgangslinkNavn\(id\)\}, mister adgang/);
    assert.match(tilbagekald, /får så en ny adresse/);
    assert.match(adminFunktion('handlePermanentDeleteDeviceToken'), /Adgangslinket \$\{adgangslinkNavn\(id\)\} slettes permanent/);
    const genaktiver = adminFunktion('handleGenaktiverDeviceToken');
    assert.match(genaktiver, /confirmDialog\('Genaktivér adgangslink'/);
    assert.match(genaktiver, /\/device-tokens\/\$\{id\}\/genaktiver`, \{ method: 'PUT' \}/);

    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(`let sidsteAdgangslinks = [{ id: 3, name: 'TV "bane 1"' }];\n${adminFunktion('adgangslinkNavn')}\nthis.f = adgangslinkNavn;`, ctx);
    assert.equal(ctx.f(3), '"TV "bane 1""');
    assert.equal(ctx.f(9), 'dette link');
});

// ======================= Nr. 45: dobbelt holdkamp og redigering =======================

test('45: opretHoldkamp afviser en anden aktiv holdkamp fra samme kilde (409, holdkamp_findes)', async () => {
    nulstil(async (sql) => (/aktiv_kilde_id = \?/.test(sql) ? [{ id: 12, team1_name: 'Holte', team2_name: 'Lyngby' }] : []));
    await assert.rejects(
        teamMatches.opretHoldkamp({ format: 'x', team1Name: 'Holte', team2Name: 'Lyngby', games: [], sourceMatchId: '514948' }),
        (e) => e.status === 409 && e.code === 'holdkamp_findes' && e.teamMatchId === 12 && /Holte – Lyngby/.test(e.message));
    assert.ok(!kald.some(k => /^INSERT/.test(k.sql.trim())), 'intet indsat');
    assert.equal(kald[kald.length - 1].sql, 'ROLLBACK');

    // Ny kilde: kildens id gemmes på holdkampen
    nulstil(async (sql) => (/^SELECT/.test(sql.trim()) ? [] : { insertId: 13 }));
    assert.equal(await teamMatches.opretHoldkamp({ format: 'x', team1Name: 'A', team2Name: 'B', games: [{ category: 'HS' }], sourceMatchId: 514949 }), 13);
    const ins = kald.find(k => /INSERT INTO team_matches/.test(k.sql));
    assert.match(ins.sql, /aktiv_kilde_id/);
    assert.equal(ins.params[5], '514949');

    // Uden kilde (formularen): intet opslag, NULL
    nulstil(async (sql) => (/^SELECT/.test(sql.trim()) ? [] : { insertId: 14 }));
    await teamMatches.opretHoldkamp({ format: 'x', team1Name: 'A', team2Name: 'B', games: [] });
    assert.ok(!kald.some(k => /aktiv_kilde_id = \?/.test(k.sql)));
    assert.equal(kald.find(k => /INSERT INTO team_matches/.test(k.sql)).params[5], null);

    // Ugyldigt id
    await assert.rejects(teamMatches.opretHoldkamp({ format: 'x', team1Name: 'A', team2Name: 'B', games: [], sourceMatchId: "1' OR 1" }),
        (e) => e.status === 400);
});

test('45: to samtidige kald — den unikke nøgle afviser det andet som holdkamp_findes', async () => {
    nulstil(async (sql) => {
        if (/^INSERT INTO team_matches/.test(sql.trim())) { const e = new Error('Duplicate entry'); e.errno = 1062; e.code = 'ER_DUP_ENTRY'; throw e; }
        if (/aktiv_kilde_id = \?/.test(sql) && kald.some(k => /^INSERT/.test(k.sql.trim()))) return [{ id: 20, team1_name: 'A', team2_name: 'B' }];
        return [];
    });
    await assert.rejects(
        teamMatches.opretHoldkamp({ format: 'x', team1Name: 'A', team2Name: 'B', games: [], sourceMatchId: '1' }),
        (e) => e.status === 409 && e.code === 'holdkamp_findes' && e.teamMatchId === 20);
});

test('45: afsluttet holdkamp frigiver kilden; migration 045; ruten og køen bruger kilden', () => {
    const tm = laes('backend/routes/teamMatches.js');
    assert.match(tm, /UPDATE team_matches SET status = 'finished', aktiv_kilde_id = NULL WHERE id = \?/);
    assert.doesNotMatch(tm, /SET status = 'finished' WHERE/);
    assert.match(tm, /opretHoldkamp\(\{ format, team1Name, team2Name, games, team1LogoId, team2LogoId, sourceMatchId \}\)/);
    assert.match(tm, /code: error\.code, teamMatchId: error\.teamMatchId/);

    const sql = laes('backend/migrations/045_genaktiver_link_og_holdkamp_kilde.sql');
    const dele = splitStatements(sql);
    assert.equal(dele.length, 3);
    assert.match(dele[0], /ALTER TABLE device_tokens ADD COLUMN sessioner_fra DATETIME NULL/);
    assert.match(dele[1], /ALTER TABLE team_matches ADD COLUMN aktiv_kilde_id VARCHAR\(40\) NULL/);
    assert.match(dele[2], /ADD UNIQUE KEY uq_team_match_aktiv_kilde \(aktiv_kilde_id\)/);

    const imp = laes('backend/routes/importHoldkamp.js');
    assert.match(imp, /\.\.\.seddel, sourceMatchId: String\(params\.leagueMatchID\)/);
    assert.match(imp, /games: seddel\.games,\s+sourceMatchId: w\.league_match_id/);
    // Køen: findes holdkampen allerede (oprettet i hånden), er køen færdig — ingen fejl-løkke
    assert.match(imp, /if \(err\.code === 'holdkamp_findes'\) \{[\s\S]{0,200}SET status = 'oprettet', team_match_id = \?/);
});

test('45: "Opret Holdkamp" fra importen kan ikke trykkes to gange og sender kilden med', () => {
    const f = adminFunktion('bpCreate');
    assert.match(f, /if \(bpOpretter\) return;/);
    assert.ok(f.indexOf('bpOpretter = true') < f.indexOf('api.createTeamMatch'), 'spærret før kaldet');
    assert.match(f, /btn\.disabled = true/);
    assert.match(f, /finally \{\s+bpOpretter = false;/);
    assert.match(f, /games: gamesData, sourceMatchId \}/);
    assert.match(adminScript, /preview\.dataset\.kilde\s+= data\.sourceMatchId \|\| '';/);
    assert.match(adminScript, /onclick="bpCreate\(\)" id="bpCreateBtn"/);
});

test('45: "Rediger kamp" i turneringen beholder det tastede, når listen tegnes forfra', () => {
    const fange = adminFunktion('captureTournamentDrafts');
    assert.match(fange, /\[data-tournament-edit\]/);
    assert.match(fange, /tournamentEditDrafts\.set\(id, draft\)/);
    const render = adminFunktion('renderTournaments');
    assert.ok(render.indexOf('captureTournamentDrafts()') < render.indexOf('container.innerHTML'));
    assert.match(render, /const editDraft = tournamentEditDrafts\.get\(m\.id\);/);
    assert.match(adminFunktion('cancelEditTournamentMatch'), /tournamentEditDrafts\.delete\(matchId\)/);
    assert.match(adminFunktion('saveEditTournamentMatch'), /tournamentEditDrafts\.delete\(matchId\)/);
});

// ======================= Nr. 46: bekræftelser med navne =======================

test('46: turnering, holdkamp, nøgler og kø navngiver det, der rammes', () => {
    assert.doesNotMatch(adminScript, /turneringen ""/);
    assert.match(adminFunktion('handleFinishTournament'), /Afslut turneringen "\$\{name\}"\?/);
    assert.match(adminFunktion('handleDeleteTournament'), /Slet turneringen "\$\{name\}" og alle dens kampe\?/);
    assert.match(adminFunktion('confirmDeleteTournamentMatch'), /Slet kampen \$\{turneringskampBetegnelse\(tournamentId, matchId\)\}\?/);
    assert.match(adminFunktion('finishHoldkamp'), /\$\{navn\} afsluttes og kan ikke genoptages/);
    assert.match(adminFunktion('deleteHoldkamp'), /\$\{holdkampBetegnelse\(id\)\} og alle dens delkampe/);
    assert.match(adminFunktion('handleRevokePlannerToken'), /Nøglen \$\{plannerNoegleNavn\(id\)\} tilbagekaldes/);
    assert.match(adminFunktion('handlePermanentDeletePlannerToken'), /Nøglen \$\{plannerNoegleNavn\(id\)\} slettes permanent/);
});

test('46: navnene slås op korrekt (vm)', () => {
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(`
        let sidsteHoldkampe = [{ id: 4, team1_name: 'Holte 1', team2_name: 'Lyngby 2' }];
        let sidsteTurneringer = [{ id: 1, matches: [
            { id: 10, label: 'HS1', side1_player1: 'Ane', side2_player1: 'Bo' },
            { id: 11, side1_player1: 'C', side1_player2: 'D', side2_player1: 'E', side2_player2: null } ] }];
        ${adminFunktion('holdkampBetegnelse')}
        ${adminFunktion('turneringskampBetegnelse')}
        this.h = holdkampBetegnelse; this.t = turneringskampBetegnelse;`, ctx);
    assert.equal(ctx.h(4), 'Holdkampen Holte 1 – Lyngby 2');
    assert.equal(ctx.h(5), 'Holdkampen');
    assert.equal(ctx.t(1, 10), '"HS1": Ane – Bo');
    assert.equal(ctx.t(1, 11), 'C / D – E');
    assert.equal(ctx.t(1, 99), 'på listen');
});

test('46: "Stop" på holdkamp-overvågningen og livestreamen spørger først', () => {
    const stopVagt = adminFunktion('bpStopWatcher');
    assert.ok(stopVagt.indexOf('confirmDialog') < stopVagt.indexOf('deleteHoldkampWatcher'), 'bekræftes før');
    assert.match(stopVagt, /Stop med at holde øje med \$\{hvad\}\?/);
    const stopBane = adminFunktion('stopLivestreamBane');
    assert.ok(stopBane.indexOf('confirmDialog') < stopBane.indexOf("method: 'DELETE'"));
    assert.match(stopBane, /Stop udsendelsen fra bane \$\{bane\}\?/);
    const stopHk = adminFunktion('stopLivestreamHoldkamp');
    assert.match(stopHk, /if \(stop && !await BadmintonUtils\.confirmDialog/, '"Send holdkampen igen" spørger ikke');
});

test('46: confirmDialog/showMessage viser navnene som tekst, ikke HTML', () => {
    const utils = laes('frontend/js/utils.js');
    assert.match(utils, /textElement\.textContent = text;/);
});

// ======================= Nr. 47: gendannelse =======================

test('47: backuppen bærer klubbens identitet, og en anden klubs backup opdages', async () => {
    const conn = { async query() { return [[]]; } };
    const b = await klubBackup.lavBackup(conn, { mappe: 'holte_db', clubSubdomain: 'holte', clubName: 'Holte', clubDbName: 'holte_db' });
    assert.equal(b.clubDbName, 'holte_db');

    const holte = { db_name: 'holte_db', subdomain: 'holte' };
    const lyngby = { db_name: 'lyngby_db', subdomain: 'lyngby' };
    assert.equal(klubBackup.backupFraAndenKlub(b, holte), null);
    assert.equal(klubBackup.backupFraAndenKlub(b, lyngby), 'Holte (holte)');
    // Subdomænet ændret, databasen den samme: samme klub
    assert.equal(klubBackup.backupFraAndenKlub(b, { db_name: 'holte_db', subdomain: 'holte-bk' }), null);
    // Ældre backups: kun subdomænet
    assert.equal(klubBackup.backupFraAndenKlub({ clubSubdomain: 'holte' }, holte), null);
    assert.equal(klubBackup.backupFraAndenKlub({ clubSubdomain: 'holte' }, lyngby), 'holte');
    // Demo/lokal (ingen klub) kan ikke tjekkes
    assert.equal(klubBackup.backupFraAndenKlub({ clubSubdomain: null }, lyngby), null);
    assert.equal(klubBackup.backupFraAndenKlub(b, null), null);
});

test('47: klubbens egen gendannelse afviser en anden klubs backup; super-admin kun med andenKlub=1', () => {
    const bk = laes('backend/routes/backup.js');
    const g = bk.slice(bk.indexOf('async function gendanOgSvar'));
    assert.ok(g.indexOf('backupFraAndenKlub(backup, klub)') < g.indexOf("tagBackup(conn, klub, 'foer-gendannelse')"),
        'tjekkes før noget gemmes eller ændres');
    assert.match(g, /status\(409\)\.json\(\{\s+code: 'anden_klub'/);
    assert.match(bk, /clubName: klub\.name, clubDbName: klub\.db_name/);

    const sa = laes('backend/routes/superAdmin.js');
    const r = sa.slice(sa.indexOf("router.post('/clubs/:id/restore'"));
    assert.match(r, /if \(fra && req\.query\.andenKlub !== '1'\)/);
    assert.ok(r.indexOf('backupFraAndenKlub') < r.indexOf("'foer-gendannelse'"));
    assert.match(sa, /clubName: club\.name, clubDbName: club\.db_name \}\);/);
    assert.match(laes('backend/config/autoBackup.js'), /clubDbName: club\.db_name/);

    const sas = laes('frontend/super-admin-script.js');
    assert.match(sas, /data\.code === 'anden_klub' && !andenKlub/);
    assert.match(sas, /return doClubRestore\(clubId, file, true\);/);
});

test('47: adgangslinkene bevares ved gendannelse', async () => {
    assert.ok(!klubBackup.BACKUP_TABLES.includes('device_tokens'));
    // En ældre backup med links: de røres ikke (hverken DELETE eller INSERT)
    const sqls = [];
    const conn = {
        async query(sql) { sqls.push(sql); return [[]]; },
        async beginTransaction() {}, async commit() {}, async rollback() {},
    };
    await klubBackup.gendanBackup(conn, {
        version: '1.0', tables: { settings: [], device_tokens: [{ id: 1, token: 'gammel', is_active: 1 }] }, files: {}
    }, 'holte_db');
    assert.ok(!sqls.some(s => /device_tokens/.test(s)), sqls.join('\n'));
});

test('47: teksterne siger, hvad der sker (kopi først, links bevares)', () => {
    const sas = laes('frontend/super-admin-script.js');
    assert.doesNotMatch(sas, /overskrevet\. Kan ikke fortrydes/);
    assert.match(sas, /Lige før gemmes en kopi af det nuværende \("Før gendannelse"\)/);
    assert.match(sas, /Adgangslinks og admin-logins røres ikke/);
    const ss = laes('frontend/settings-script.js');
    assert.match(ss, /så det kan fortrydes\. Adgangslinks og admin-logins røres ikke\./);
    assert.equal((ss.match(/adgangslinks og admin-logins bevares/g) || []).length, 2);
    assert.match(laes('frontend/settings.html'), /Adgangslinks og admin-logins røres ikke\./);
});

test('versioner er skruet op (cache)', () => {
    const v = (fil, script) => Number(new RegExp(`${script}\\?v=(\\d+)`).exec(laes(fil))[1]);
    assert.ok(v('frontend/admin.html', 'admin-script\\.js') >= 106);
    assert.ok(v('frontend/admin.html', 'admin-styles\\.css') >= 31);
    assert.ok(v('frontend/settings.html', 'settings-script\\.js') >= 25);
    assert.ok(v('frontend/super-admin.html', 'super-admin-script\\.js') >= 41);
});
