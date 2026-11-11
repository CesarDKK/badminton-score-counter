/**
 * Unit-tests af pakke G (anden gennemgang, november 2026):
 *
 *  - nr. 59: en tablet må ikke genåbne en færdig delkamp eller trække en, der
 *    spilles på en anden bane, over til sig (config/delkampRegler.js)
 *  - nr. 60: "Antal baner" skjuler baner i stedet for at slette dem (og dermed
 *    kamphistorikken); 409, når en bane, der skjules, er i brug (config/baner.js)
 *  - nr. 61: kamphistorikkens varighed/resultat og holdkampens format valideres
 *    og escapes i admin
 *  - nr. 65: api.js' tidsgrænse gælder, til kroppen er læst (falsk browser, vm)
 *  - nr. 67 og 68: tjekkes på kildeteksten som live-events.test.js
 *
 * Nr. 63 og 64 ligger hos deres forgængere (ur-og-tablet-pakke-b.test.js og
 * klub-backup.test.js). Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rod = path.join(__dirname, '..', '..', '..');
const laes = (fil) => fs.readFileSync(path.join(rod, fil), 'utf8');

// ---------------- nr. 59 ----------------

const { banenErIGang, delkampAendringAfvist } = require('../../config/delkampRegler');

test('nr. 59: banen er i gang ved point, vundne sæt eller et startet ur', () => {
    assert.equal(banenErIGang(null), false);
    assert.equal(banenErIGang({ player1_score: 0, player2_score: 0, player1_games: 0, player2_games: 0, timer_seconds: 0 }), false);
    assert.equal(banenErIGang({ player1_score: 3 }), true);
    assert.equal(banenErIGang({ player2_games: 1 }), true);
    assert.equal(banenErIGang({ timer_seconds: 12 }), true);
});

test('nr. 59: en tablet kan ikke genåbne en færdig delkamp', () => {
    const delkamp = { status: 'finished', court_number: 2 };
    for (const status of ['active', 'pending']) {
        const fejl = delkampAendringAfvist({ erEnhed: true, delkamp, status, courtNumber: 3 });
        assert.match(fejl, /færdigspillet/);
    }
    // "Ryd banen" på den færdige delkamps bane sender pending + null — også afvist
    assert.match(delkampAendringAfvist({ erEnhed: true, delkamp, status: 'pending', courtNumber: null }), /genåbnes/);
    // Flytning alene
    assert.match(delkampAendringAfvist({ erEnhed: true, delkamp, courtNumber: 4 }), /flyttes/);
    // Uændret bane, navne eller resultatet igen: tilladt
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp, courtNumber: 2 }), null);
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp, courtNumber: '2' }), null);
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp, status: 'finished' }), null);
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp }), null);
});

test('nr. 59: en tablet kan ikke trække en igangværende delkamp fra en anden bane', () => {
    const delkamp = { status: 'active', court_number: 2 };
    assert.match(
        delkampAendringAfvist({ erEnhed: true, delkamp, status: 'active', courtNumber: 5, egenBaneIGang: true }),
        /spilles allerede på bane 2/);
    // Ingen point på bane 2 endnu: må gerne flyttes (som før)
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp, status: 'active', courtNumber: 5, egenBaneIGang: false }), null);
    // Samme bane (tabletten på bane 2 tildeler igen) og frigivelse fra banen selv: tilladt
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp, status: 'active', courtNumber: 2, egenBaneIGang: true }), null);
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp, status: 'pending', courtNumber: null, egenBaneIGang: true }), null);
    // En ventende delkamp kan tildeles
    assert.equal(delkampAendringAfvist({ erEnhed: true, delkamp: { status: 'pending', court_number: null }, status: 'active', courtNumber: 5 }), null);
});

test('nr. 59: admin (ikke et adgangslink) må stadig alt', () => {
    assert.equal(delkampAendringAfvist({ erEnhed: false, delkamp: { status: 'finished', court_number: 2 }, status: 'active', courtNumber: 4 }), null);
    assert.equal(delkampAendringAfvist({ erEnhed: false, delkamp: { status: 'active', court_number: 2 }, courtNumber: 4, egenBaneIGang: true }), null);
});

test('nr. 59: ruten læser delkampens status og bruger reglen kun for adgangslinks; tabletten henter listen igen', () => {
    const rute = laes('backend/routes/teamMatches.js');
    assert.match(rute, /SELECT id, court_number, started_at, status FROM team_match_games/);
    assert.match(rute, /const erEnhed = req\.user\?\.role === 'device';/);
    assert.match(rute, /delkampAendringAfvist\(\{ erEnhed, delkamp: game, status, courtNumber, egenBaneIGang \}\)/);
    const court = laes('frontend/court-script-v3.js');
    // Ét holdkamp-valg, som koden selv har sat, tæller ikke som brugerens valg
    assert.match(court, /const holdkampValgt = matchSel && matchSel\.style\.display !== 'none' && matchSel\.value;/);
    // assignHoldkampGame henter listen, før den tildeler
    assert.match(court, /async function assignHoldkampGame\(\) \{[\s\S]{0,900}await api\.getActiveTeamMatches\(\)[\s\S]{0,900}api\.updateTeamMatchGame\(matchId, gameId/);
    assert.match(court, /showMessage\('Kan ikke tildele delkampen', error\.message\)/);
});

// ---------------- nr. 60 ----------------

const { synligBane, nedsaettelseAfvist } = require('../../config/baner');

test('nr. 60: 409-teksten nævner banerne over det nye antal og hvorfor', () => {
    assert.equal(nedsaettelseAfvist(4, []), null);
    assert.equal(nedsaettelseAfvist(4, [{ court_number: 3, grund: 'kamp i gang' }]), null, 'bane 3 bliver');
    assert.equal(nedsaettelseAfvist(4, [{ court_number: 5, grund: 'kamp i gang' }]),
        'Bane 5 er i brug (kamp i gang). Afslut eller ryd banen, før antallet sættes ned til 4.');
    const flere = nedsaettelseAfvist(3, [
        { court_number: 6, grund: 'turneringskamp' },
        { court_number: 4, grund: 'kamp i gang' },
        { court_number: 4, grund: 'delkamp fra en holdkamp' }
    ]);
    assert.match(flere, /^Bane 4 og 6 er i brug \(turneringskamp, kamp i gang, delkamp fra en holdkamp\)\. Afslut eller ryd banerne/);
});

test('nr. 60: synlige baner er dem inden for court_count', () => {
    assert.match(synligBane(), /^court_number <= COALESCE\(\(SELECT CAST\(bs\.setting_value AS UNSIGNED\) FROM settings bs\s+WHERE bs\.setting_key = 'court_count'\), 20\)$/);
    assert.match(synligBane('c'), /^c\.court_number <= /);
});

test('nr. 60: ruten sletter ikke banerne (og dermed kamphistorikken), og listerne viser kun synlige baner', () => {
    const settings = laes('backend/routes/settings.js');
    assert.doesNotMatch(settings, /DELETE FROM courts/);
    assert.match(settings, /const afvist = nedsaettelseAfvist\(courtCount, optaget\);\s*\n\s*if \(afvist\) return res\.status\(409\)/);
    // Lister
    assert.match(laes('backend/routes/courts.js'), /FROM courts WHERE \$\{synligBane\(\)\} ORDER BY court_number/);
    assert.match(laes('backend/routes/gameStates.js'), /LEFT JOIN game_states gs ON c\.id = gs\.court_id\s*\n\s*WHERE \$\{synligBane\('c'\)\}/);
    assert.match(laes('backend/routes/livestream.js'), /SELECT court_number FROM courts WHERE \$\{synligBane\(\)\} ORDER BY court_number/);
    assert.match(laes('backend/scheduler.js'), /WHERE c\.is_active = TRUE AND \$\{synligBane\('c'\)\}/);
    // Enkeltopslag fra tablet, ur, planner og livestream: en skjult bane = ikke fundet
    for (const fil of ['gameStates', 'urTaeller', 'plannerIntegration', 'livestream', 'courts']) {
        const src = laes(`backend/routes/${fil}.js`);
        const opslag = src.match(/FROM courts WHERE court_number = \?[^`'\n]*/g) || [];
        assert.ok(opslag.length > 0, fil);
        for (const o of opslag) assert.match(o, /synligBane/, `${fil}: ${o}`);
    }
    // Indstillingssiden spørger, før antallet sænkes
    assert.match(laes('frontend/settings-script.js'), /if \(gemtAntalBaner && courtCount < gemtAntalBaner\) \{[\s\S]{0,600}await showConfirm\('Færre baner'/);
});

// ---------------- nr. 61 ----------------

const { historikFelterFejl } = require('../../config/historikFelter');
const holdkampFormater = require('../../config/holdkampFormater');

test('nr. 61: kamphistorikken tager kun imod sæt og varighed i de formater, der sendes', () => {
    for (const [gamesWon, duration] of [['2-1', '34:07'], ['2-0', '00:00'], ['1-0', '125:59'], ['W.O.', '00:00'], ['10-9', '9:05']]) {
        assert.equal(historikFelterFejl({ gamesWon, duration }), null, `${gamesWon} ${duration}`);
    }
    for (const gamesWon of ['<img src=x onerror=alert(1)>', '2-1 ', '2–1', '123-1', '', 2, null]) {
        assert.match(historikFelterFejl({ gamesWon, duration: '10:00' }), /Ugyldigt resultat/, String(gamesWon));
    }
    for (const duration of ['<b>1</b>', '10:60', '-1:-5', '10', '10:5', '12345:00', 600, undefined]) {
        assert.match(historikFelterFejl({ gamesWon: '2-0', duration }), /Ugyldig varighed/, String(duration));
    }
    // Tabletten sender aldrig en negativ varighed (skævt ur)
    assert.match(laes('frontend/court-script-v3.js'), /function formatDuration\(seconds\) \{[\s\S]{0,300}seconds = Math\.max\(0, Math\.floor\(Number\(seconds\) \|\| 0\)\);/);
});

test('nr. 61: holdkamp-formatet skal være et kendt format (eller "imported" fra en holdseddel)', () => {
    for (const f of Object.keys(holdkampFormater.FORMATER)) assert.equal(holdkampFormater.kendtFormat(f), true, f);
    assert.equal(holdkampFormater.kendtFormat('imported'), true);
    // Alt, detectFormat (importen fra badmintonplayer) kan give, er kendt
    for (const games of [[], Array(11).fill({ category: 'MD' }), [{ category: 'Single' }]]) {
        assert.equal(holdkampFormater.kendtFormat(holdkampFormater.detectFormat(games)), true);
    }
    for (const f of ['<script>', 'toString', '__proto__', '', null, 5]) {
        assert.equal(holdkampFormater.kendtFormat(f), false, String(f));
    }
    assert.match(laes('backend/routes/teamMatches.js'), /if \(!holdkampFormater\.kendtFormat\(format\)\) \{\s*\n\s*return res\.status\(400\)/);
    assert.match(laes('backend/routes/matchHistory.js'), /const feltFejl = historikFelterFejl\(\{ gamesWon, duration \}\);\s*\n\s*if \(feltFejl\) return res\.status\(400\)/);
});

test('nr. 61: admin escaper varigheden og holdkampens format', () => {
    const admin = laes('frontend/admin-script.js');
    assert.match(admin, /\$\{Ikon\('ur'\)\} \$\{escapeHtml\(match\.duration \|\| ''\)\}/);
    assert.match(admin, /\$\{escapeHtml\(formatLabel \|\| ''\)\}/);
    assert.doesNotMatch(admin, /\$\{match\.duration\}|\$\{formatLabel\}|\$\{match\.games_won\}/);
});

// ---------------- nr. 65 ----------------

// api.js i en lille falsk browser, hvor fetch svarer med headerne med det samme,
// men kroppen først bliver færdig, når kaldet afbrydes
function apiMedHaengendeKrop({ ok = true, status = 200 } = {}) {
    let afbrudt = 0;
    const lager = {};
    const window = {
        location: { search: '', pathname: '/', origin: 'https://x.dk' },
        history: { replaceState() {} }
    };
    const sandbox = {
        window, console: { log() {}, warn() {}, error() {} },
        sessionStorage: { getItem: (k) => lager[k] ?? null, setItem: (k, v) => { lager[k] = v; }, removeItem: (k) => { delete lager[k]; } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        URLSearchParams, AbortController, setTimeout, clearTimeout, atob,
        fetch: async (url, opt) => ({
            ok, status, statusText: 'x', headers: { get: () => null },
            json: () => new Promise((resolve, reject) => {
                opt.signal.addEventListener('abort', () => {
                    afbrudt++;
                    const e = new Error('The operation was aborted'); e.name = 'AbortError';
                    reject(e);
                });
            })
        })
    };
    vm.runInNewContext(laes('frontend/js/api.js'), sandbox);
    return { api: window.BadmintonAPI, afbrudt: () => afbrudt };
}

test('nr. 65: et svar, der går i stå efter headerne, afbrydes af tidsgrænsen', async () => {
    const { api, afbrudt } = apiMedHaengendeKrop();
    const start = Date.now();
    await assert.rejects(api.request('/game-states', { timeout: 50 }, 1), (e) => e.name === 'AbortError' && /timeout/.test(e.message));
    assert.equal(afbrudt(), 1);
    assert.ok(Date.now() - start < 2000);
});

test('nr. 65: også fejl-grenen (et 500, hvis krop går i stå) har en tidsgrænse', async () => {
    const { api, afbrudt } = apiMedHaengendeKrop({ ok: false, status: 500 });
    await assert.rejects(api.request('/game-states', { timeout: 50 }, 1), (e) => e.status === 500);
    assert.equal(afbrudt(), 1);
});

test('nr. 65: oversigten opgiver en hængende opdatering som TV\'et; versionerne er hævet', () => {
    const src = laes('frontend/oversigt-script.js');
    assert.match(src, /if \(_refreshRunning && Date\.now\(\) - _refreshStartedAt < REFRESH_STUCK_MS\) \{/);
    assert.match(src, /if \(generation !== _refreshGeneration\) return;\s*\n\s*_refreshRunning = false;/);
    // Alle sider, der loader api.js, henter den nye (TV'ets auto-opdatering sammenligner ?v=)
    const sider = fs.readdirSync(path.join(rod, 'frontend')).filter(f => f.endsWith('.html'));
    for (const s of sider) {
        const m = laes(`frontend/${s}`).match(/js\/api\.js\?v=(\d+)/);
        if (m) assert.ok(Number(m[1]) >= 41, `${s} henter api.js?v=${m[1]}`);
    }
});

// ---------------- nr. 67 og 68 ----------------

test('nr. 67: "ingen handlinger at fortryde" fører tilbage til kampslut-dialogen', () => {
    const src = laes('frontend/court-script-v3.js');
    assert.match(src, /showMessage\('Fortryd', 'Der er ingen handlinger at fortryde\.', \[\{\s*\n\s*text: 'OK',\s*\n\s*callback: \(\) => \{ if \(gameState\.matchCompleted\) showMatchWonMessage\(_kampSlutRapporteret\); \}/);
});

test('nr. 68: TV\'et skjuler kun QR-koden ved et skift af tilstand eller et 404 — ellers skiftes billedet, når det nye er hentet', () => {
    const src = laes('frontend/tv-script-v3.js');
    assert.match(src, /if \(qrCounterMode === tilstand && !qrGenhent\) return;/);
    assert.match(src, /const iBaggrunden = qrCounterMode === tilstand && qrCounterVisible;/);
    assert.match(src, /if \(!iBaggrunden\) \{\s*\n\s*container\.style\.display = 'none';/);
    // Ur-koden skiftes sammen med billedet, ikke når headerne kommer
    assert.match(src, /if \(hentNr !== qrHentNr \|\| qrCounterMode !== tilstand\) return;\s*\n\s*qrUrKode = urKode;/);
    assert.doesNotMatch(src, /qrCounterMode = null;\s*\/\/ og QR-koden/);
});
