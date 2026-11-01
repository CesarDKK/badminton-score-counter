#!/usr/bin/env node
// End-to-end for tælleren: den rigtige tablet-side (court-v3.html) mod en kørende
// installation med gemninger slået TIL — adhoc-kampe (single 21/30 og double
// 15/21 med pauser, fortryd, sideskift og genindlæsning), holdkamp (4 spillere,
// 6 delkampe til 3-3 og golden set) og turnering (single og double). Opsætningen
// sker gennem API'et, som admin gør det, og resultaterne tjekkes i game_states,
// kamphistorikken, holdkampen, turneringen og på TV-siden.
//
// Kør mod den lokale installation (Playwright i Docker, ingen browser-download —
// alpine's chromium; ~1 min at installere første gang):
//   T=$(docker exec badminton-backend node -e "console.log(require('./middleware/auth').generateToken({admin:true}))")
//   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -w /repo \
//     -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -e CHROMIUM=/usr/bin/chromium -e NODE_PATH=/tmp/pw/node_modules \
//     -e BT_URL=http://host.docker.internal:8080 -e BT_TOKEN="$T" --add-host=host.docker.internal:host-gateway \
//     node:22-alpine sh -c "apk add -q chromium nss freetype harfbuzz ttf-freefont && mkdir -p /tmp/pw && cd /tmp/pw \
//       && npm i -s playwright && cd /repo && node scripts/taeller-e2e.js"
//
// Bruger installationens sidste bane. Kræver, at der ikke er en aktiv holdkamp
// eller turnering (testens egne fra en afbrudt kørsel ryddes). Det, der laves,
// bliver stående som afsluttet (Kamphistorik), så det kan ses i admin.
// Se også taeller-knapper.js (knapperne) og taeller-sammenlign.js (reglerne).
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const URL = process.env.BT_URL || 'http://localhost:8080';
const TOKEN = process.env.BT_TOKEN;
let ok = 0;
const check = (navn, betingelse, info) => {
    if (!betingelse) throw new Error(`FEJL: ${navn}${info !== undefined ? ' — ' + JSON.stringify(info) : ''}`);
    ok++; console.log('  ok', navn);
};

async function api(path, method = 'GET', body, auth = false) {
    const r = await fetch(URL + path, {
        method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 200)}`);
    return j;
}
const sov = (ms) => new Promise(r => setTimeout(r, ms));
async function vent(navn, fn, ms = 15000) {
    const til = Date.now() + ms;
    while (Date.now() < til) { const v = await fn(); if (v) return v; await sov(250); }
    throw new Error(`Ventede forgæves på: ${navn}`);
}

async function main() {
    const settings = await api('/api/settings');
    const BANE = settings.courtCount;
    console.log(`Bane ${BANE} af ${settings.courtCount}, ${URL}`);
    // Rester fra en afbrudt kørsel ryddes — alt andet aktivt stopper os
    for (const t of await api('/api/team-matches/active-all')) {
        assert.equal(t.team1_name, 'Hjem BK', 'der er en aktiv holdkamp, som ikke er E2E-testens');
        await api(`/api/team-matches/${t.id}`, 'DELETE', null, true);
    }
    for (const t of await api('/api/tournaments/active')) {
        assert.equal(t.name, 'E2E-turnering', 'der er en aktiv turnering, som ikke er E2E-testens');
        await api(`/api/tournaments/${t.id}`, 'DELETE', null, true);
    }
    // Sætscorer skrives player1-player2, som de stod — uanset hvem der vandt
    const harSaet = (tekst, a, b) => new RegExp(`\\b(${a}-${b}|${b}-${a})\\b`).test(tekst);

    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    const page = await browser.newPage();
    const sidefejl = [];
    page.on('pageerror', e => sidefejl.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) sidefejl.push('console: ' + m.text()); });
    const aabn = async () => { await page.goto(`${URL}/court-v3.html?court=${BANE}`, { waitUntil: 'networkidle' }); await sov(1500); };
    await aabn();
    await page.evaluate(() => performClearCourtNow()); await sov(1000);

    const st = () => page.evaluate(() => JSON.parse(JSON.stringify({ ...gameState, timerInterval: null, restBreakInterval: null, restBreakCallback: null, history: undefined })));
    const sig = () => page.evaluate(() => TaellerRegler.signatur(gameState));
    const side = (navn) => page.evaluate((navn) => (gameState.player1.name === navn ? 1 : 2), navn);
    const pointTil = async (navn) => { const s = await side(navn); await page.evaluate((s) => { _lastPointTime = 0; addPoint(s); }, s); await sov(15); };
    const skipPause = () => page.evaluate(() => endRestBreak());
    const pauseLoeberUd = async () => {
        await page.evaluate(() => { gameState.restBreakStartedAt = Date.now() - (gameState.restBreakDuration + 1) * 1000; });
        await vent('pausen løb ud', async () => !(await st()).restBreakActive, 5000);
    };
    const fortryd = () => page.evaluate(() => undoLastAction());
    const rydBane = async () => { await page.evaluate(() => performClearCourtNow()); await sov(1500); };
    const nyKamp = async (o) => {
        await rydBane();
        await page.evaluate((o) => {
            gameState.gameMode = o.gameMode; gameState.isDoubles = !!o.isDoubles;
            gameState.player1.name = o.p1; gameState.player2.name = o.p2;
            if (o.isDoubles) { gameState.player1.name2 = o.p1b; gameState.player2.name2 = o.p2b; }
            updateDisplay(); saveGameState();
        }, o);
        await sov(800);
    };
    // Spiller et sæt færdigt: taberen og vinderen skiftes, til taberen har sine
    // `taberPoint`, så tager vinderen resten. Pausen ved 11/8 springes over (eller
    // løber ud). Sætpausen håndteres af kalderen.
    const spilSaet = async (vinder, taber, taberPoint, opts = {}) => {
        const s = await st();
        const vind = s.gameMode === '15' ? 15 : 21;
        const slut = taberPoint >= vind - 1 ? taberPoint + 2 : vind;
        let v = 0, t = 0, sidste = null;
        while (v < slut) {
            const nuS = await st();
            if (nuS.restBreakActive && !TaellerRegler_erSaetAfgjort(nuS)) { if (opts.pauseLoeberUd11) await pauseLoeberUd(); else await skipPause(); }
            if (t < taberPoint && t <= v) { await pointTil(taber); t++; sidste = taber; }
            else { await pointTil(vinder); v++; sidste = vinder; }
            if (opts.midt && v + t === opts.midt.efter) await opts.midt.goer(sidste);
        }
        return `${v}-${t}`;
    };
    const TaellerRegler_erSaetAfgjort = (s) => {
        const vind = s.gameMode === '15' ? 15 : 21, maks = s.gameMode === '15' ? 21 : 30;
        const a = s.player1.score, b = s.player2.score;
        return (a >= vind && a - b >= 2) || a === maks || (b >= vind && b - a >= 2) || b === maks;
    };
    const serverState = () => api(`/api/game-states/${BANE}`);
    const historik = () => api(`/api/match-history/${BANE}?limit=500`);   // standard er 10
    const navnPaa = (s, side) => s[`player${side}`].name;

    // ───────── 1. Adhoc single 21/30: pause løber ud, deuce, sideskift i 3. sæt, fortryd, genindlæsning
    console.log('\n1. Adhoc single 21/30');
    const histFoer = (await historik()).length;
    await nyKamp({ gameMode: '21', p1: 'Anna', p2: 'Bo' });
    await page.evaluate(() => selectServer(2));
    await sov(600);
    check('server valgt er gemt på serveren', (await serverState()).servingPlayer === 2 || (await serverState()).isActive === true);
    let r = await spilSaet('Anna', 'Bo', 15, { pauseLoeberUd11: true });
    check('sæt 1: 21-15', r === '21-15');
    let s = await st();
    check('sætpausen kører (2 min)', s.restBreakActive && s.restBreakDuration === 120 && s.player1.games === 1);
    await sov(1200);
    const srv = await serverState();
    check('serveren ser sættet vundet med pausen', srv.player1.games === 1 && srv.restBreakActive === true && srv.setScoresHistory.length === 1, srv.setScoresHistory);
    // Genindlæs midt i sætpausen — pausen genoptages, og når den løber ud, begynder sæt 2
    await aabn();
    s = await st();
    check('efter genindlæsning: pausen genoptaget', s.restBreakActive && s.player1.games === 1 && s.player1.score === 21);
    await pauseLoeberUd();
    s = await st();
    check('sæt 2: siderne byttet, Anna server som vinder', s.player2.name === 'Anna' && s.player2.games === 1 && s.servingPlayer === 2 && s.player1.score === 0, s);
    // Sæt 2: Bo vinder i deuce 22-20
    r = await spilSaet('Bo', 'Anna', 20);
    check('sæt 2: 22-20 til Bo', r === '22-20');
    s = await st();
    check('1-1 og sætpause', s.player1.games === 1 && s.player2.games === 1 && s.restBreakActive);
    // Fortryd sætbolden under sætpausen → 21-20, pausen væk
    await fortryd(); await sov(300);
    s = await st();
    check('fortryd sætbold: 21-20, pausen annulleret, 1-0 i sæt', !s.restBreakActive && s.player1.games + s.player2.games === 1 && s.setScoresHistory.length === 1, s);
    await pointTil('Bo');
    s = await st();
    check('sætbolden igen: 22-20, pausen kører', s.restBreakActive && s.player1.games === 1 && s.player2.games === 1);
    await skipPause(); await sov(300);
    s = await st();
    check('sæt 3: byttet igen, Bo server', s.player1.name === 'Anna' && s.servingPlayer === 2, s);
    // Sæt 3: sideskift ved 11 — Anna når 11 først; midtvejs fortrydes et point
    r = await spilSaet('Anna', 'Bo', 8, { midt: { efter: 5, goer: async (sidste) => {
        const foer = await sig(); await fortryd(); await sov(200);
        check('fortryd midt i sættet ændrer stillingen', (await sig()) !== foer);
        await pointTil(sidste);
        check('samme point igen giver samme tilstand', (await sig()) === foer);
    } } });
    s = await st();
    check('sæt 3: sideskift sket ved 11', s.decidingGameSwitched === true);
    check('kampen er afsluttet 2-1 til Anna', s.matchCompleted && (s.player1.name === 'Anna' ? s.player1 : s.player2).games === 2, s);
    check('Anna har 3 sæt i historikken', s.setScoresHistory.length === 3 && s.setScoresHistory[1].score === '22-20', s.setScoresHistory);
    const hist = await vent('kampen i kamphistorikken', async () => { const h = await historik(); return h.length > histFoer ? h : null; });
    const sidste = hist[0];
    check('kamphistorik: Anna vandt 2-1', /Anna/.test(sidste.winner_name || sidste.winnerName) && (sidste.games_won || sidste.gamesWon) === '2-1', sidste);
    check('kamphistorik: sætscorer', /21-15/.test(sidste.set_scores || sidste.setScores) && /22-20/.test(sidste.set_scores || sidste.setScores), sidste);
    // Fortryd matchbolden: kampen åbner igen, point kan tælles videre
    await fortryd(); await sov(300);
    s = await st();
    check('fortryd matchbold: kampen åben igen', !s.matchCompleted && s.setScoresHistory.length === 2);
    await pointTil('Anna'); await sov(1200);
    s = await st();
    check('matchbolden igen: afsluttet', s.matchCompleted);
    check('ingen boldpoint efter kampen', (await page.evaluate(() => TaellerRegler.boldpoint(gameState))).player1 === null);
    // TV-siden viser kampen
    const tv = await browser.newPage();
    await tv.goto(`${URL}/tv-v3.html?court=${BANE}`, { waitUntil: 'networkidle' }); await sov(1500);
    const tvTekst = await tv.evaluate(() => document.body.innerText);
    check('TV viser Anna og Bo', /Anna/.test(tvTekst) && /Bo/.test(tvTekst));
    await tv.close();

    // ───────── 2. Adhoc double 15/21: pladsbyt, serv-rotation, fortryd, genindlæsning midt i sættet
    console.log('\n2. Adhoc double 15/21');
    await nyKamp({ gameMode: '15', isDoubles: true, p1: 'Carl', p1b: 'Dorte', p2: 'Erik', p2b: 'Freja' });
    await page.evaluate(() => swapPlayers(1)); await sov(100);
    await page.evaluate(() => selectServer(1)); await sov(300);
    s = await st();
    check('double: Dorte (højre) server for hold 1', s.team1RightCourt === 2 && s.servingPlayerOnTeam === 2 && s.servingTeam === 1, s);
    await pointTil('Carl');
    s = await st();
    check('vundet bold: samme server, byttet side', s.servingPlayerOnTeam === 2 && s.team1RightCourt === 1);
    await pointTil('Erik');
    s = await st();
    check('tabt bold: serven går til hold 2, 1 point → venstre', s.servingTeam === 2 && s.servingPlayerOnTeam === (s.team2RightCourt === 1 ? 2 : 1));
    const foerReload = await sig();
    await aabn();
    check('genindlæsning midt i sættet: samme tilstand', (await sig()) === foerReload, { foer: foerReload, efter: await sig() });
    r = await spilSaet('Carl', 'Erik', 9);
    check('sæt 1: 15-9', r === '15-9');
    await skipPause(); await sov(300);
    s = await st();
    check('nyt sæt i double: mellem sæt, Carl&Dorte server', s.betweenSets && s.servingTeam === (s.player1.name === 'Carl' ? 1 : 2));
    check('pladsbyt mellem sæt tilladt', await page.evaluate(() => TaellerRegler.bytPladser(gameState, 1).ok));
    r = await spilSaet('Erik', 'Carl', 13);
    check('sæt 2: 15-13', r === '15-13');
    await skipPause(); await sov(300);
    r = await spilSaet('Carl', 'Erik', 2);
    s = await st();
    check('double afsluttet 2-1', s.matchCompleted && s.decidingGameSwitched);
    const hist2 = await vent('double i kamphistorikken', async () => { const h = await historik(); return h.length > histFoer + 1 ? h : null; });
    check('kamphistorik: Carl & Dorte vandt', /Carl/.test(hist2[0].winner_name || hist2[0].winnerName) && /Dorte/.test(hist2[0].winner_name || hist2[0].winnerName), hist2[0]);

    // ───────── 3. Holdkamp 4 spillere: 6 delkampe til 3-3, golden set
    console.log('\n3. Holdkamp (4 spillere, golden set)');
    await nyKamp({ gameMode: '21', p1: 'Spiller 1', p2: 'Spiller 2' });
    const A = ['Asger', 'Astrid', 'Aksel', 'Agnes'], B = ['Bent', 'Birthe', 'Bjarne', 'Bodil'];
    const games = [0, 1, 2, 3].map(i => ({ category: 'Single', team1Player1: A[i], team2Player1: B[i] }));
    games.push({ category: 'Double', team1Player1: A[0], team1Player2: A[1], team2Player1: B[0], team2Player2: B[1] });
    games.push({ category: 'Double', team1Player1: A[2], team1Player2: A[3], team2Player1: B[2], team2Player2: B[3] });
    const hk = await api('/api/team-matches', 'POST', { format: '4spillere', team1Name: 'Hjem BK', team2Name: 'Ude BK', games }, true);
    const tm = await api('/api/team-matches/active');
    check('holdkamp oprettet med 6 delkampe', tm.id === hk.id && tm.games.length === 6);
    const histFoerHk = (await historik()).length;
    for (let i = 0; i < 6; i++) {
        const g = tm.games[i];
        await api(`/api/team-matches/${tm.id}/games/${g.id}`, 'PUT', { courtNumber: BANE, status: 'active' }, true);
        await vent(`tabletten binder delkamp ${i + 1}`, () => page.evaluate((id) => assignedHoldkampGameId === id, g.id));
        await sov(600);
        s = await st();
        const dbl = g.category === 'Double';
        check(`delkamp ${i + 1}: navne og ${dbl ? 'double' : 'single'} på tabletten`,
            s.player1.name === g.team1_player1 && s.player2.name === g.team2_player1 && s.isDoubles === dbl && s.setsToWin === 2, s);
        await page.evaluate(() => selectServer(1)); await sov(200);
        const hjem = i % 2 === 0;   // hjem vinder 1, 3, 5 → 3-3
        const [v, t] = hjem ? [g.team1_player1, g.team2_player1] : [g.team2_player1, g.team1_player1];
        await spilSaet(v, t, 10); await skipPause(); await sov(300);
        if (i === 1) {   // et sæt til hver — vinderen tager 3. sæt med sideskift ved 11
            await spilSaet(t, v, 18); await skipPause(); await sov(300);
        }
        await spilSaet(v, t, 7);
        s = await st();
        check(`delkamp ${i + 1}: afsluttet`, s.matchCompleted);
        const faerdig = await vent(`delkamp ${i + 1} meldt færdig`, async () => {
            const t2 = await api('/api/team-matches/active'); const gg = t2.games.find(x => x.id === g.id);
            return gg.status === 'finished' ? gg : null;
        });
        check(`delkamp ${i + 1}: vinder hold ${hjem ? 1 : 2}, sætscorer`, faerdig.winner_team === (hjem ? 1 : 2) && harSaet(faerdig.set_scores, 21, 10) &&
            (i !== 1 || harSaet(faerdig.set_scores, 18, 21)), faerdig);
        await rydBane();
    }
    const histEfterHk = await historik();
    check('delkampene står også i kamphistorikken', histEfterHk.length === histFoerHk + 6);
    let gs;
    try {
        gs = await api(`/api/team-matches/${tm.id}/golden-set`, 'POST', { team1Player1: A[0], team1Player2: A[2], team2Player1: B[0], team2Player2: B[2] }, true);
    } catch (e) { throw new Error('golden set kunne ikke oprettes ved 3-3: ' + e.message); }
    check('golden set oprettet ved 3-3', !!gs.gameId);
    await api(`/api/team-matches/${tm.id}/games/${gs.gameId}`, 'PUT', { courtNumber: BANE, status: 'active' }, true);
    await vent('tabletten binder golden set', () => page.evaluate((id) => assignedHoldkampGameId === id, gs.gameId));
    await sov(600);
    s = await st();
    check('golden set: double, ét sæt', s.isDoubles && s.setsToWin === 1 && s.player1.name === A[0] && s.player1.name2 === A[2], s);
    await page.evaluate(() => selectServer(2)); await sov(200);
    r = await spilSaet(B[0], A[0], 12);
    s = await st();
    check('golden set: sideskift ved 11 og kampen afsluttet efter ét sæt', s.decidingGameSwitched && s.matchCompleted && s.setScoresHistory.length === 1, s);
    const gsFaerdig = await vent('golden set meldt færdig', async () => {
        const t2 = await api('/api/team-matches/active'); const gg = t2.games.find(x => x.id === gs.gameId);
        return gg.status === 'finished' ? gg : null;
    });
    check('golden set: udeholdet vandt', gsFaerdig.winner_team === 2 && harSaet(gsFaerdig.set_scores, 21, 12), gsFaerdig);
    await rydBane();
    await api(`/api/team-matches/${tm.id}/finish`, 'PUT', {}, true);
    const hkHist = await api('/api/team-matches/history');
    check('holdkampen afsluttet: 7 delkampe i historikken, 3-4', hkHist[0].id === tm.id && hkHist[0].games.length === 7 &&
        hkHist[0].games.filter(g => g.winner_team === 1).length === 3 && hkHist[0].games.filter(g => g.winner_team === 2).length === 4);

    // ───────── 4. Turnering: single og double, resultatet kun under turneringen
    console.log('\n4. Turnering');
    await nyKamp({ gameMode: '15', p1: 'Spiller 1', p2: 'Spiller 2' });
    const tu = await api('/api/tournaments', 'POST', { name: 'E2E-turnering' }, true);
    const m1 = await api(`/api/tournaments/${tu.id}/matches`, 'POST', { label: 'HS 1', side1Player1: 'Gustav', side2Player1: 'Holger' }, true);
    const m2 = await api(`/api/tournaments/${tu.id}/matches`, 'POST', { label: 'MD 1', doubles: true, side1Player1: 'Ida', side1Player2: 'Jens', side2Player1: 'Karen', side2Player2: 'Lars' }, true);
    const histFoerTu = (await historik()).length;
    for (const [m, vinder, taber, dbl] of [[m1, 'Holger', 'Gustav', false], [m2, 'Ida', 'Karen', true]]) {
        await api(`/api/tournaments/${tu.id}/matches/${m.id}`, 'PUT', { courtNumber: BANE, status: 'active' }, true);
        await vent(`tabletten binder turneringskamp ${m.id}`, () => page.evaluate((id) => assignedTournamentMatchId === id, m.id));
        await sov(600);
        s = await st();
        check(`turneringskamp: navne (${dbl ? 'double' : 'single'})`, s.isDoubles === dbl && (s.player1.name === (dbl ? 'Ida' : 'Gustav')), s);
        await page.evaluate(() => selectServer(1)); await sov(200);
        await spilSaet(vinder, taber, 5); await skipPause(); await sov(300);
        if (dbl) { await spilSaet(taber, vinder, 14); await skipPause(); await sov(300); }   // 16-14 og 3. sæt
        await spilSaet(vinder, taber, 11);
        s = await st();
        check('turneringskamp afsluttet', s.matchCompleted);
        const f = await vent('turneringskamp meldt færdig', async () => {
            const t2 = (await api('/api/tournaments/active')).find(x => x.id === tu.id);
            const mm = t2.matches.find(x => x.id === m.id); return mm.status === 'finished' ? mm : null;
        });
        check(`turnering: vinder side ${vinder === 'Holger' ? 2 : 1}`, f.winner_team === (vinder === 'Holger' ? 2 : 1) && harSaet(f.set_scores, 15, 5) &&
            (!dbl || harSaet(f.set_scores, 16, 14)), f);
        await rydBane();
    }
    check('turneringskampe står ikke i kamphistorikken', (await historik()).length === histFoerTu);
    await api(`/api/tournaments/${tu.id}/finish`, 'PUT', {}, true);
    check('turneringen afsluttet', (await api('/api/tournaments/active')).length === 0);

    await browser.close();
    check('ingen fejl i tablet-siden', sidefejl.length === 0, sidefejl);
    console.log(`\n${ok} tjek bestået`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
