/**
 * Pakke U — tre turneringsfejl før Lyngby (kun server og admin; tabletten er urørt).
 *   104  ny turneringskamp på en bane, hvor forrige kamp er slut, men ikke ryddet
 *   105  tabletten er bundet til en kamp, admin har byttet ud
 *   106  "Ret resultat" fra historikken kunne rydde den kamp, der spilles nu
 *
 * Forløbene gennem databasen ligger i tests/integration/90-turnering-bane.test.js.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-pakke-u';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('os').tmpdir();

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');
function udsnit(tekst, fra, til) {
    const i = tekst.indexOf(fra);
    assert.ok(i >= 0, `${fra} findes`);
    const j = tekst.indexOf(til, i + fra.length);
    return tekst.slice(i, j < 0 ? undefined : j);
}

// ---------- Falsk database (før modulerne indlæses — de destrukturerer query) ----------
const db = require('../../config/database');
let svar = async () => [];
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };
const skrevet = (re) => kald.filter(k => re.test(k.sql));

const haendelser = [];
require('../../events/gameStateEvents').subscribeGameStateChanges({}, (e) => haendelser.push(e));

const baneTildeling = require('../../config/baneTildeling');
const tournaments = require('../../routes/tournaments');

function lag(router, metode, sti) {
    const l = router.stack.find(x => x.route && x.route.path === sti && x.route.methods[metode]);
    assert.ok(l, `${metode.toUpperCase()} ${sti} findes`);
    return l;
}
const rute = (router, metode, sti) => { const h = lag(router, metode, sti).route.stack; return h[h.length - 1].handle; };
async function koer(handler, req) {
    const res = {
        statusKode: 200, krop: null,
        status(s) { this.statusKode = s; return this; },
        json(j) { this.krop = j; return this; }
    };
    let fejl = null;
    await handler({ params: {}, query: {}, body: {}, ...req }, res, (e) => { fejl = e; });
    if (fejl) throw fejl;
    return res;
}

// Bane 3 (courts.id 7) med en afsluttet kamp: Anna vandt 2-0 over Berit
const afsluttet = (o = {}) => ({
    court_id: 7, player1_name: 'Anna', player1_name2: 'Makker 1', player2_name: 'Berit', player2_name2: 'Makker 2',
    player1_score: 21, player2_score: 15, player1_games: 2, player2_games: 0, timer_seconds: 900,
    match_completed: 1, match_start_time: new Date('2026-11-21T09:00:00Z'), match_end_time: new Date('2026-11-21T09:20:00Z'),
    set_scores_history: JSON.stringify(['Anna 21-10 Berit', 'Anna 21-15 Berit']), result_outcome: null,
    bane_double: 0, ...o
});

/**
 * Banen og turneringskampene som en lille verden.
 *  gs        banens game_states-række (null = tom bane)
 *  aktive    turneringskampe, der står 'active' på bane 3
 */
function verden({ gs = null, aktive = [] } = {}) {
    const v = { gs, aktive };
    haendelser.length = 0;
    nulstil(async (sql, params) => {
        if (/FROM courts c JOIN game_states gs/.test(sql)) return v.gs ? [v.gs] : [];
        if (/SELECT id FROM courts WHERE court_number/.test(sql)) return [{ id: 7 }];
        if (/SELECT is_doubles FROM courts/.test(sql)) return [{ is_doubles: v.gs ? v.gs.bane_double : 0 }];
        if (/SELECT \* FROM game_states WHERE court_id/.test(sql)) return v.gs ? [v.gs] : [];
        if (/DELETE FROM game_states/.test(sql)) { v.gs = null; return { affectedRows: 1 }; }
        if (/FROM team_match_games/.test(sql)) return [];
        // resultatMelding.meldAfgjortKamp
        if (/SELECT m\.id, m\.doubles, m\.started_at/.test(sql)) return v.aktive.slice(0, 1);
        if (/UPDATE tournament_matches\s+SET status = 'finished'/.test(sql)) {
            const m = v.aktive.find(x => x.id === params[params.length - 1]);
            if (!m) return { affectedRows: 0 };
            v.aktive = v.aktive.filter(x => x !== m);
            return { affectedRows: 1 };
        }
        // baneTildeling.uindmeldtResultat
        if (/m\.id != \?/.test(sql)) return v.aktive.filter(x => x.id !== params[1]).slice(0, 1);
        if (/^\s*(UPDATE|INSERT|DELETE)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
    return v;
}
const kamp = (o = {}) => ({
    id: 11, doubles: 0, started_at: new Date('2026-11-21T08:55:00Z'),
    side1_player1: 'Anna', side1_player2: null, side2_player1: 'Berit', side2_player2: null, ...o
});

// ======================= Nr. 104 =======================

test('104: stillingErKampens — én side på hver plads, uanset hvilken side der står til venstre', () => {
    const { stillingErKampens } = baneTildeling;
    assert.equal(stillingErKampens({ player1_name: 'Anna', player2_name: 'Berit' }, ['Anna'], ['Berit']), true);
    assert.equal(stillingErKampens({ player1_name: 'Berit', player2_name: 'Anna' }, ['Anna'], ['Berit']), true);
    assert.equal(stillingErKampens({ player1_name: 'Anna', player2_name: 'Spiller 2' }, ['Anna'], ['Berit']), false);
    assert.equal(stillingErKampens({ player1_name: 'Carl', player2_name: 'Dorte' }, ['Anna'], ['Berit']), false);
    assert.equal(stillingErKampens({ player1_name: 'Anna', player2_name: 'Anna' }, ['Anna'], ['Berit']), false);
});

test('104: tom bane eller en kamp i gang — intet ryddes her (tjekOgRydBane tager kampen i gang)', async () => {
    verden();
    assert.equal(await baneTildeling.rydAfsluttetFoerTildeling(3, {}, 12), null);
    verden({ gs: afsluttet({ match_completed: 0, player1_games: 1 }) });
    assert.equal(await baneTildeling.rydAfsluttetFoerTildeling(3, {}, 12), null);
    assert.deepEqual(skrevet(/^\s*(UPDATE|INSERT|DELETE)/), []);
    assert.deepEqual(haendelser, []);
});

test('104: forrige kamp er slut og meldt ind — banen ryddes: resultatet til TV, tilstanden væk, reset til tablet/TV', async () => {
    const v = verden({ gs: afsluttet() });
    assert.equal(await baneTildeling.rydAfsluttetFoerTildeling(3, {}, 12), null);
    assert.equal(v.gs, null, 'game_states er slettet');
    assert.equal(skrevet(/INSERT INTO last_finished_matches/).length, 1, 'TV-et viser stadig seneste resultat');
    assert.equal(skrevet(/DELETE FROM frigivne_kampe/).length, 1, 'ingen "Fortsæt kampen?" om den gamle kamp');
    assert.deepEqual(haendelser, [{ courtId: 3, type: 'reset' }]);
});

test('104: slutstillingen er en aktiv turneringskamps, som serveren endnu ikke har meldt ind — den meldes ind, så ryddes banen', async () => {
    const v = verden({ gs: afsluttet(), aktive: [kamp()] });
    assert.equal(await baneTildeling.rydAfsluttetFoerTildeling(3, {}, 12), null);
    assert.equal(skrevet(/UPDATE tournament_matches\s+SET status = 'finished'/).length, 1, 'meldt ind som "Ryd banen" gør');
    assert.deepEqual(v.aktive, []);
    assert.equal(v.gs, null);
});

test('104: slutstillingen hører til en aktiv kamp, der ikke kan meldes ind — 409, intet ryddes, resultatet bevares', async () => {
    // Kampen er double, banen stod i single → serveren genkender den ikke
    const v = verden({ gs: afsluttet(), aktive: [kamp({ doubles: 1, side1_player2: 'Cille', side2_player2: 'Dina' })] });
    const r = await baneTildeling.rydAfsluttetFoerTildeling(3, {}, 12);
    assert.equal(r.code, 'bane_resultat_mangler');
    assert.match(r.error, /^Kampen på bane 3 \(Anna \/ Cille – Berit \/ Dina\) er slut, men resultatet er ikke meldt ind\. Indtast resultatet i turneringslisten først/);
    assert.ok(v.gs, 'stillingen står');
    assert.equal(v.aktive.length, 1, 'kampen står stadig som i gang');
    assert.deepEqual(skrevet(/DELETE/), []);
    assert.deepEqual(haendelser, []);
});

test('104: en aktiv, ikke-startet kamp med andre navne end slutstillingen — slutstillingen er en anden kamps, banen ryddes', async () => {
    const v = verden({ gs: afsluttet(), aktive: [kamp({ side1_player1: 'Carl', side2_player1: 'Dorte' })] });
    assert.equal(await baneTildeling.rydAfsluttetFoerTildeling(3, {}, 12), null);
    assert.equal(v.gs, null);
});

test('104: PUT /:id/matches/:matchId — admins tildeling svarer 409 og ændrer ingen kamp, når et resultat ville gå tabt', async () => {
    const v = verden({ gs: afsluttet(), aktive: [kamp({ doubles: 1, side1_player2: 'Cille', side2_player2: 'Dina' })] });
    const svarFoer = svar;
    nulstil(async (sql, params) => {
        if (/SELECT id, court_number, started_at/.test(sql) || /FROM tournament_matches WHERE id = \? AND tournament_id = \?/.test(sql)) {
            return [{ id: 12, court_number: null, started_at: null, status: 'pending' }];
        }
        return svarFoer(sql, params);
    });
    const r = await koer(rute(tournaments, 'put', '/:id/matches/:matchId'), {
        params: { id: '1', matchId: '12' }, user: { role: 'club_admin' }, body: { courtNumber: 3, status: 'active' }
    });
    assert.equal(r.statusKode, 409);
    assert.equal(r.krop.code, 'bane_resultat_mangler');
    assert.deepEqual(skrevet(/UPDATE tournament_matches/), []);
    assert.ok(v.gs);
});

test('104: en turneringskamp, der sættes tilbage til afventer, mister sin starttid — alle steder i backenden', () => {
    const t = laes('backend/routes/tournaments.js');
    const put = udsnit(t, "router.put('/:id/matches/:matchId'", '\n});');
    // Frigørelsen, når en anden kamp tager banen
    assert.match(put, /SET court_number = NULL, status = 'pending', started_at = NULL/);
    // Tabletten eller admin frigiver selv kampen (status 'pending')
    assert.match(put, /if \(status === 'pending'\) fields\.push\('started_at = NULL'\)/);
    // Ryd banen (DELETE) og planneren gjorde det allerede
    assert.match(laes('backend/routes/gameStates.js'), /UPDATE tournament_matches\s+SET status = 'pending', court_number = NULL, started_at = NULL/);
    assert.match(laes('backend/routes/plannerIntegration.js'), /UPDATE tournament_matches SET status = 'pending', court_number = NULL, started_at = NULL/);
    // Ingen andre steder sætter en turneringskamp til afventer
    const alle = ['backend/routes', 'backend/config', 'backend/taeller'].flatMap(d =>
        fs.readdirSync(path.join(ROD, d)).filter(f => f.endsWith('.js')).map(f => laes(`${d}/${f}`)));
    // (status = 'pending' i SET-delen — ikke som vagt i WHERE)
    const steder = alle.join('\n').match(/UPDATE tournament_matches\s+SET (?:(?!WHERE)[^`])*status = 'pending'[^`]*`/g) || [];
    assert.ok(steder.length >= 3, `fandt ${steder.length}`);
    for (const s of steder) assert.match(s, /started_at = NULL/, s);
    // Rydningen kommer efter tjekket for en kamp i gang og før frigørelsen
    const i = put.indexOf('tjekOgRydBane'), j = put.indexOf('rydAfsluttetFoerTildeling'), k = put.indexOf("status = 'pending', started_at = NULL");
    assert.ok(i > 0 && j > i && k > j);
});

test('104: admin viser serverens forklaring, når banen ikke kan tages (begge veje til at sætte en kamp på banen)', () => {
    const a = laes('frontend/admin-script.js');
    assert.match(a, /function baneAfvistTekst\(error\)[\s\S]*?'bane_resultat_mangler'/);
    assert.match(udsnit(a, 'async function tildelTurneringskampBane(', '\n}'), /baneAfvistTekst\(error\) \|\| 'Kampen kunne ikke sættes på banen/);
    assert.match(a, /baneAfvistTekst\(e\) \|\| 'Turneringskampen kunne ikke tildeles banen/);
    assert.ok(Number(/admin-script\.js\?v=(\d+)/.exec(laes('frontend/admin.html'))[1]) >= 123);
});

// ======================= Nr. 105 =======================

const turneringEnhed = require('../../config/turneringEnhed');

test('105: erEnhed — adgangslinket er en enhed; uden token kun på en lokal installation, aldrig i klub-mode', () => {
    const { erEnhed } = turneringEnhed;
    assert.equal(erEnhed({ accessMode: 'club', user: { role: 'device', destination: 'court/3' }, headers: {} }), true);
    assert.equal(erEnhed({ accessMode: 'club', user: { role: 'club_admin' }, headers: {} }), false);
    assert.equal(erEnhed({ accessMode: 'club', headers: {} }), false);
    // Lokal installation: tabletten har intet token, admin sender sit login
    assert.equal(erEnhed({ accessMode: 'direct', headers: {} }), true);
    assert.equal(erEnhed({ accessMode: 'direct', headers: { authorization: 'Bearer abc' } }), false);
});

test('105: egenBane — kun et LÅST adgangslinks court/N; "Fri navigation" kan tælle enhver bane', () => {
    const { egenBane } = turneringEnhed;
    assert.equal(egenBane({ user: { role: 'device', destination: 'court/3', locked: 1 } }), 3);
    assert.equal(egenBane({ user: { role: 'device', destination: 'court/3', locked: true } }), 3);
    assert.equal(egenBane({ user: { role: 'device', destination: 'court/3', locked: 0 } }), null);
    assert.equal(egenBane({ user: { role: 'device', destination: 'court/3' } }), null);
    assert.equal(egenBane({ user: { role: 'device', destination: 'tv/3', locked: 1 } }), null);
    assert.equal(egenBane({ user: { role: 'device', destination: 'oversigt', locked: 1 } }), null);
    assert.equal(egenBane({ headers: {} }), null);
});

test('105: begge udstedere af enhedens session skriver locked med, og enhedssessioner fornyes ikke', () => {
    assert.match(laes('backend/middleware/adgangslinkSession.js'), /role: 'device',[\s\S]*?locked: deviceToken\.locked,/);
    assert.match(laes('backend/routes/deviceTokens.js'), /role: 'device',[\s\S]*?locked: deviceToken\.locked,/);
    assert.match(laes('backend/routes/session.js'), /device-tokens kan ikke fornyes/);
});

test('105: reglen — kun kampen, der står active på enhedens egen bane', () => {
    const { enhedsAendringAfvist: afvist } = turneringEnhed;
    const m = (o = {}) => ({ status: 'active', court_number: 3, side1_player1: 'Anna', side2_player1: 'Berit', ...o });
    // Normalforløbet: serveren har allerede meldt kampen færdig
    assert.ok(afvist({ match: m({ status: 'finished' }), bane: 3, status: 'finished' }));
    // Skubbet af banen (afventer), W.O. tastet (færdig), flyttet til en anden bane
    assert.ok(afvist({ match: m({ status: 'pending', court_number: null }), bane: 3, status: 'finished' }));
    assert.ok(afvist({ match: m({ court_number: 5 }), bane: 3, status: 'finished' }));
    assert.ok(afvist({ match: m({ court_number: 5 }), bane: 3, status: 'pending' }), 'en gammel binding trækker ikke kampen af en anden bane');
    // Reserven: serverens melding sprang over, kampen står stadig på banen
    assert.equal(afvist({ match: m(), bane: 3, status: 'finished' }), null);
    assert.equal(afvist({ match: m(), bane: 3, status: 'pending' }), null, 'tabletten frigiver sin egen kamp');
    // Ukendt bane (lokal installation): resultatet gælder kun med kampens afsluttede stilling
    const st = (o = {}) => ({ player1_name: 'Berit', player2_name: 'Anna', match_completed: 1, ...o });
    assert.equal(afvist({ match: m(), bane: null, status: 'finished', stilling: st() }), null);
    assert.ok(afvist({ match: m(), bane: null, status: 'finished', stilling: st({ match_completed: 0 }) }));
    assert.ok(afvist({ match: m(), bane: null, status: 'finished', stilling: st({ player1_name: 'Carl', player2_name: 'Dorte' }) }));
    assert.ok(afvist({ match: m(), bane: null, status: 'finished', stilling: null }));
    assert.equal(afvist({ match: m(), bane: null, status: 'pending' }), null);
});

function rutenMed(kampen, gs = null) {
    nulstil(async (sql) => {
        if (/FROM tournament_matches WHERE id = \? AND tournament_id = \?/.test(sql)) return kampen ? [kampen] : [];
        if (/FROM courts c JOIN game_states gs/.test(sql)) return gs ? [gs] : [];
        if (/^\s*(UPDATE|INSERT|DELETE)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
    return (req) => koer(rute(tournaments, 'put', '/:id/matches/:matchId'), { params: { id: '1', matchId: '12' }, headers: {}, ...req });
}
const tablet3 = { accessMode: 'club', user: { role: 'device', destination: 'court/3', locked: 1 } };
const adminKlubU = { accessMode: 'club', user: { role: 'club_admin' } };
const friTablet = { accessMode: 'club', user: { role: 'device', destination: 'court/1', locked: 0 } };
const resultat = { status: 'finished', winnerTeam: 2, setScores: 'Carl 21-10 Dorte, Carl 21-12 Dorte' };

test('105: PUT — tablettens resultat på en kamp, der ikke står på dens bane, giver 200 og ændrer intet', async () => {
    for (const kampen of [
        { id: 12, status: 'pending', court_number: null },     // skubbet af banen
        { id: 12, status: 'finished', court_number: 3 },       // W.O. tastet, eller serveren meldte den ind
        { id: 12, status: 'active', court_number: 5 }          // sat på en anden bane
    ]) {
        const put = rutenMed(kampen);
        const r = await put({ ...tablet3, body: resultat });
        assert.equal(r.statusKode, 200, JSON.stringify(kampen));
        assert.deepEqual(r.krop, { success: true, uaendret: true });
        assert.deepEqual(skrevet(/^\s*(UPDATE|INSERT|DELETE)/), [], JSON.stringify(kampen));
    }
});

test('105: PUT — reserven: kampen står active på tablettens bane, så gælder tablettens resultat', async () => {
    const put = rutenMed({ id: 12, status: 'active', court_number: 3, started_at: null });
    const r = await put({ ...tablet3, body: resultat });
    assert.equal(r.statusKode, 200);
    assert.deepEqual(r.krop, { success: true });
    const u = skrevet(/UPDATE tournament_matches SET/);
    assert.equal(u.length, 1);
    assert.match(u[0].sql, /status = \?.*finished_at = CURRENT_TIMESTAMP.*winner_team = \?/s);
});

test('105: PUT — et ulåst court/1-link, der tæller bane 7: reserven gælder med kampens afsluttede stilling; en gammel binding ændrer intet', async () => {
    const kampen = { id: 12, status: 'active', court_number: 7, side1_player1: 'Carl', side2_player1: 'Dorte' };
    let put = rutenMed(kampen, { player1_name: 'Dorte', player2_name: 'Carl', match_completed: 1 });
    let r = await put({ ...friTablet, body: resultat });
    assert.deepEqual(r.krop, { success: true }, 'før: "kampen står på bane 7" — tablettens resultat blev droppet');
    assert.equal(skrevet(/UPDATE tournament_matches SET/).length, 1);
    // Stillingen på bane 7 er ikke kampens (eller ikke afsluttet) → intet
    put = rutenMed(kampen, { player1_name: 'Anna', player2_name: 'Berit', match_completed: 1 });
    r = await put({ ...friTablet, body: resultat });
    assert.deepEqual(r.krop, { success: true, uaendret: true });
    // Hovedfejlen: en gammel binding til en kamp, der er skubbet af banen
    put = rutenMed({ id: 12, status: 'pending', court_number: null });
    r = await put({ ...friTablet, body: resultat });
    assert.deepEqual(r.krop, { success: true, uaendret: true });
    assert.deepEqual(skrevet(/^\s*(UPDATE|INSERT|DELETE)/), []);
    // Det LÅSTE court/3-link kan ikke melde en kamp på bane 7 ind
    put = rutenMed(kampen, { player1_name: 'Dorte', player2_name: 'Carl', match_completed: 1 });
    r = await put({ ...tablet3, body: resultat });
    assert.deepEqual(r.krop, { success: true, uaendret: true });
});

test('104: en ny tildeling får altid en frisk started_at — COALESCE kun, når kampen allerede står på samme bane', async () => {
    const sql = async (kampen, body) => {
        const put = rutenMed(kampen);
        await put({ ...adminKlubU, body });
        return skrevet(/UPDATE tournament_matches SET/).pop().sql;
    };
    // Afventer med en gammel started_at fra før rettelsen
    assert.match(await sql({ id: 12, status: 'pending', court_number: null, started_at: new Date('2026-11-01T08:00:00Z') },
        { courtNumber: 3, status: 'active' }), /started_at = CURRENT_TIMESTAMP/);
    // Admin gemmer bane-dialogen igen for kampen på samme bane
    assert.match(await sql({ id: 12, status: 'active', court_number: 3, started_at: new Date() },
        { courtNumber: 3, status: 'active' }), /started_at = COALESCE\(started_at, CURRENT_TIMESTAMP\)/);
    // Flyttet til en anden bane: ny tildeling
    assert.match(await sql({ id: 12, status: 'active', court_number: 5, started_at: new Date() },
        { courtNumber: 3, status: 'active' }), /started_at = CURRENT_TIMESTAMP(?!\))/);
    assert.doesNotMatch(await sql({ id: 12, status: 'active', court_number: 5 }, { courtNumber: 3, status: 'active' }), /COALESCE/);
});

test('104: en afsluttet stilling, der begyndte FØR kampen på banen blev sat på, er ikke dens — hverken meldt ind eller 409; banen ryddes', async () => {
    // Bane 3 står med B (aktiv, B's navne) over A's slutstilling, som begyndte kl. 09:00; B blev sat på kl. 09:10
    const v = verden({ gs: afsluttet(), aktive: [kamp({ started_at: new Date('2026-11-21T09:10:00Z') })] });
    assert.equal(await baneTildeling.rydAfsluttetFoerTildeling(3, {}, 12), null);
    assert.equal(skrevet(/UPDATE tournament_matches\s+SET status = 'finished'/).length, 0, 'B meldes ikke færdig med A\'s resultat');
    assert.equal(v.aktive.length, 1);
    assert.equal(v.gs, null, 'banen ryddes');
});

test('105: PUT — admin og den lokale tablet', async () => {
    // Admin (klub-mode) må stadig rette en kamp, der ikke står på en bane
    let put = rutenMed({ id: 12, status: 'pending', court_number: null });
    let r = await put({ accessMode: 'club', user: { role: 'club_admin' }, body: { label: 'HS U11' } });
    assert.deepEqual(r.krop, { success: true });
    assert.equal(skrevet(/UPDATE tournament_matches SET/).length, 1);
    // Lokal tablet uden token: resultatet kun, når banen står med kampens afsluttede stilling
    const kampen = { id: 12, status: 'active', court_number: 3, side1_player1: 'Carl', side2_player1: 'Dorte' };
    put = rutenMed(kampen, { player1_name: 'Anna', player2_name: 'Berit', match_completed: 1 });
    r = await put({ accessMode: 'direct', body: resultat });
    assert.deepEqual(r.krop, { success: true, uaendret: true });
    put = rutenMed(kampen, { player1_name: 'Carl', player2_name: 'Dorte', match_completed: 1 });
    r = await put({ accessMode: 'direct', body: resultat });
    assert.deepEqual(r.krop, { success: true });
    // Lokal admin (med login) som før
    put = rutenMed({ id: 12, status: 'finished', court_number: null });
    r = await put({ accessMode: 'direct', headers: { authorization: 'Bearer x' }, body: { winnerTeam: 1 } });
    assert.deepEqual(r.krop, { success: true });
});

test('105: tabletten sluger stadig svaret stille (reportTournamentResult)', () => {
    const c = laes('frontend/court-script-v3.js');
    const f = udsnit(c, 'async function reportTournamentResult(', '\n}');
    assert.match(f, /try \{\s*await api\.updateTournamentMatch[\s\S]*\} catch \(error\) \{\s*console\.error/);
    // Tabletten binder selv om ved et bytte (tablet-ombinding.test.js) — admin
    // beder ikke længere om at genindlæse den
    const a = udsnit(laes('frontend/admin-script.js'), 'async function tildelTurneringskampBane(', '\n}');
    assert.doesNotMatch(a, /Genindlæs tabletten/);
    assert.match(a, /Den kommer tilbage på listen som ventende/);
});

// ======================= Nr. 106 =======================

function resultatRute(kampen, gs = afsluttet()) {
    const v = { gs };
    haendelser.length = 0;
    nulstil(async (sql) => {
        if (/FROM tournament_matches WHERE id = \? AND tournament_id = \?/.test(sql)) return [kampen];
        if (/SELECT id FROM courts WHERE court_number/.test(sql)) return [{ id: 7 }];
        if (/SELECT is_doubles FROM courts/.test(sql)) return [{ is_doubles: 0 }];
        if (/SELECT \* FROM game_states WHERE court_id/.test(sql)) return v.gs ? [v.gs] : [];
        if (/DELETE FROM game_states/.test(sql)) { v.gs = null; return { affectedRows: 1 }; }
        if (/^\s*(UPDATE|INSERT|DELETE)/.test(sql)) return { affectedRows: 1 };
        return [];
    });
    const put = (req) => koer(rute(tournaments, 'put', '/:id/matches/:matchId'), { params: { id: '1', matchId: '12' }, headers: {}, ...req });
    return { v, put };
}
const adminKlub = { accessMode: 'club', user: { role: 'club_admin' } };
const manuelt = { status: 'finished', winnerTeam: 1, setScores: 'Anna 21-10 Berit, Anna 21-15 Berit' };

test('106: manuelt resultat fra Turnering-siden — serveren rydder banen, når kampen stadig står på netop den bane', async () => {
    const { v, put } = resultatRute({ id: 12, status: 'active', court_number: 3, started_at: null });
    const r = await put({ ...adminKlub, body: { ...manuelt, rydBane: 3 } });
    assert.deepEqual(r.krop, { success: true, ryddet: true });
    assert.equal(v.gs, null);
    assert.equal(skrevet(/INSERT INTO last_finished_matches/).length, 1, 'et afgjort resultat på banen vises stadig på TV');
    assert.ok(haendelser.some(e => e.courtId === 3 && e.type === 'reset'));
    const u = skrevet(/UPDATE tournament_matches SET/)[0];
    assert.match(u.sql, /finished_at = CURRENT_TIMESTAMP/);
    // Rydningen kommer efter, at resultatet er gemt
    assert.ok(kald.indexOf(u) < kald.findIndex(k => /DELETE FROM game_states/.test(k.sql)));
});

test('106: kampen står ikke (længere) på den bane — banen røres ikke', async () => {
    for (const kampen of [
        { id: 12, status: 'active', court_number: 5 },          // flyttet til en anden bane
        { id: 12, status: 'finished', court_number: 3 },        // tabletten/serveren meldte den ind imens
        { id: 12, status: 'pending', court_number: null }       // skubbet af banen
    ]) {
        const { v, put } = resultatRute(kampen);
        const r = await put({ ...adminKlub, body: { ...manuelt, rydBane: 3 } });
        assert.deepEqual(r.krop, { success: true, ryddet: false }, JSON.stringify(kampen));
        assert.ok(v.gs, JSON.stringify(kampen));
        assert.deepEqual(skrevet(/DELETE/), []);
    }
    // En enhed kan ikke rydde banen med rydBane
    const { v, put } = resultatRute({ id: 12, status: 'active', court_number: 3 });
    await put({ ...tablet3, body: { ...manuelt, rydBane: 3 } });
    assert.ok(v.gs);
});

test('106: en rettelse af en færdig kamp flytter ikke finished_at eller started_at', async () => {
    const { put } = resultatRute({ id: 12, status: 'finished', court_number: null, started_at: new Date('2026-11-21T09:00:00Z') });
    // Også når en forældet kopi sender status 'finished' igen
    await put({ ...adminKlub, body: manuelt });
    const u = skrevet(/UPDATE tournament_matches SET/);
    assert.equal(u.length, 1);
    assert.doesNotMatch(u[0].sql, /finished_at|started_at/);
    assert.match(u[0].sql, /winner_team = \?.*set_scores = \?/s);
});

test('106: admin — historikken slår kun op i sin egen liste og sender aldrig status eller bane; intet separat "Ryd banen"', () => {
    const a = laes('frontend/admin-script.js');
    const find = udsnit(a, 'function findTurneringskamp(', '\n}');
    assert.match(find, /hvor === 'historik' \? sidsteTurneringHistorik : sidsteTurneringer/);
    assert.doesNotMatch(find, /for \(const liste of/);
    const gem = udsnit(a, 'async function gemTurneringResultat(', '\n}');
    assert.match(gem, /const hvor = turneringResultatAaben\.get\(matchId\) \|\| 'turnering';\s*const m = findTurneringskamp\(tournamentId, matchId, hvor\)/);
    assert.match(gem, /const bane = !fraHistorik && m\.status === 'active'/);
    assert.match(gem, /\.\.\.\(!fraHistorik && m\.status !== 'finished' \? \{ status: 'finished' \} : \{\}\)/);
    assert.match(gem, /\.\.\.\(bane \? \{ rydBane: bane \} : \{\}\)/);
    assert.doesNotMatch(gem, /resetGameState/);
    assert.ok(Number(/admin-script\.js\?v=(\d+)/.exec(laes('frontend/admin.html'))[1]) >= 125);
});
