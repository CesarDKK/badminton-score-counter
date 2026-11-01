#!/usr/bin/env node
// Tablettens nulstil- og genindlæsningsveje mod en kørende installation: alt
// det, der ikke er et tryk i en kamp — genindlæsning midt i pausen ved 8/11
// (pausen taget læses fra serveren), "Skift side" før kampen, admin rydder
// banen mens tabletten står med en kamp (adoptServerReset), "Start ny kamp" i
// samme session og "Ryd banen" fra tabletten. Bruger bane courtCount-1, så den
// kan køre ved siden af taeller-e2e.js (sidste bane).
//
//   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -w /repo \
//     -e BT_URL=http://host.docker.internal:8080 --add-host=host.docker.internal:host-gateway \
//     node:22-alpine sh -c "apk add --no-cache chromium nss freetype harfbuzz ttf-freefont && \
//       mkdir -p /tmp/pw && cd /tmp/pw && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright && cd /repo && \
//       CHROMIUM=/usr/bin/chromium NODE_PATH=/tmp/pw/node_modules node scripts/taeller-nulstil-e2e.js"
const URL = process.env.BT_URL || 'http://localhost:8080';
const { chromium } = require('playwright');
const sov = (ms) => new Promise(r => setTimeout(r, ms));
let ok = 0, fejl = 0;
const tjek = (navn, betingelse, info = '') => {
    if (betingelse) { ok++; console.log(`  ok  ${navn}`); }
    else { fejl++; console.log(`  FEJL ${navn} ${info}`); }
};

(async () => {
    const settings = await (await fetch(`${URL}/api/settings`)).json();
    const BANE = settings.courtCount - 1;
    console.log(`Bane ${BANE}, ${URL}`);
    const api = async (p, m = 'GET', body) => {
        const r = await fetch(`${URL}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return r.status === 204 ? null : r.json().catch(() => null);
    };
    const server = () => api(`/api/game-states/${BANE}`);
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    const page = await browser.newPage();
    const sidefejl = [];
    page.on('pageerror', e => sidefejl.push(e.message));
    const aabn = async () => { await page.goto(`${URL}/court-v3.html?court=${BANE}`, { waitUntil: 'networkidle' }); await sov(1500); };
    const st = () => page.evaluate(() => JSON.parse(JSON.stringify({ ...gameState, timerInterval: null, restBreakInterval: null, restBreakCallback: null })));
    const tryk = (h, n = 1) => page.evaluate(async ({ h, n }) => {
        for (let i = 0; i < n; i++) { _lastPointTime = 0; await ({ S1: () => selectServer(1), P1: () => addPoint(1), P2: () => addPoint(2), V: () => switchSides(), B: () => endRestBreak() }[h])(); await new Promise(r => setTimeout(r, 30)); }
    }, { h, n });
    const ryd = async () => { await api(`/api/game-states/${BANE}`, 'DELETE'); await aabn(); };

    console.log('A) Genindlæsning midt i pausen ved 8/11: pausen taget kommer fra serveren');
    await ryd();
    const midt = await page.evaluate(() => TaellerRegler.midtpunkt(gameState));
    await tryk('S1'); await tryk('P1', midt); await sov(1200);
    let s = await server();
    tjek('serveren har pausen aktiv og taget', s.restBreakActive === true && s.restBreakTaken === true, JSON.stringify({ a: s.restBreakActive, t: s.restBreakTaken }));
    tjek('serveren har pausens start og længde', typeof s.restBreakStartedAt === 'number' && s.restBreakDuration === 60, JSON.stringify({ s: s.restBreakStartedAt, d: s.restBreakDuration }));
    await aabn();
    let g = await st();
    tjek('efter genindlæsning: pausen kører igen, taget', g.restBreakActive && g.restBreakTaken, JSON.stringify({ a: g.restBreakActive, t: g.restBreakTaken }));
    tjek('pause-overlay vises', await page.evaluate(() => getComputedStyle(document.getElementById('restBreakOverlay')).display !== 'none'));
    await tryk('B'); await sov(300);
    await tryk('P2', midt); await sov(300);
    g = await st();
    tjek(`ingen ny pause når modstanderen når ${midt}`, !g.restBreakActive && g.player2.score === midt, JSON.stringify({ a: g.restBreakActive, p2: g.player2.score }));

    console.log('B) "Skift side" før kampen overlever genindlæsning');
    await ryd();
    await api(`/api/game-states/${BANE}`, 'PUT', { player1: { name: 'Anna' }, player2: { name: 'Bo' } });
    await aabn();
    await tryk('V'); await sov(1200);
    s = await server();
    tjek('serveren: Bo står som player1 og siderne er byttet', s.player1.name === 'Bo' && s.sidesManuallySwitched === true, JSON.stringify({ n: s.player1.name, m: s.sidesManuallySwitched }));
    await aabn();
    g = await st();
    tjek('efter genindlæsning: Bo står stadig som player1, flaget sat', g.player1.name === 'Bo' && g.sidesManuallySwitched === true, JSON.stringify({ n: g.player1.name, m: g.sidesManuallySwitched }));

    console.log('C) Admin rydder banen, mens tabletten står med en kamp (adoptServerReset)');
    await tryk('S1'); await tryk('P1', 5); await tryk('P2', 3); await sov(1200);
    s = await server();
    tjek('kampen er på serveren', s.player1.score === 5 && s.player2.score === 3);
    await api(`/api/game-states/${BANE}`, 'DELETE');
    await sov(4000);
    g = await st();
    tjek('tabletten er nulstillet', g.player1.score === 0 && g.player2.score === 0 && g.player1.games === 0 && !g.servingPlayer && !g.matchStartTime && !g.matchCompleted,
        JSON.stringify({ p: [g.player1.score, g.player2.score], s: g.servingPlayer, st: g.matchStartTime }));
    tjek('sæt, fortryd og pladser nulstillet', g.setScoresHistory.length === 0 && g.history.length === 0 && g.team1RightCourt === 1 && g.betweenSets === false && g.sidesManuallySwitched === false);
    tjek('navnene er serverens tomme', g.player1.name === 'Spiller 1' && g.player1.name2 === 'Makker 1' && g.player2.name === 'Spiller 2');
    tjek('spilletype og single/double beholdt', (g.gameMode === '15' || g.gameMode === '21') && typeof g.isDoubles === 'boolean');
    tjek('et point kan gives igen (ny kamp)', await page.evaluate(async () => { selectServer(2); _lastPointTime = 0; await addPoint(2); return gameState.player2.score === 1 && gameState.servingPlayer === 2; }));

    console.log('D) "Start ny kamp" i samme session (startFreshMatchInSession)');
    await tryk('P2', 4); await sov(800);
    await page.evaluate(() => startFreshMatchInSession()); await sov(1200);
    g = await st(); s = await server();
    tjek('tabletten: rent scoreboard uden navne', g.player1.score === 0 && g.player2.score === 0 && !g.servingPlayer && g.player1.name === 'Spiller 1' && g.history.length === 0);
    tjek('serveren: samme', s.player1.score === 0 && s.player2.score === 0 && s.player1.name === 'Spiller 1' && !s.servingPlayer, JSON.stringify({ p: [s.player1.score, s.player2.score], n: s.player1.name }));
    tjek('ingen 409 (version fulgte med)', g.version === s.version, JSON.stringify({ g: g.version, s: s.version }));

    console.log('E) Ryd banen fra tabletten (performClearCourtNow)');
    await tryk('S1'); await tryk('P1', 3); await sov(800);
    await page.evaluate(() => performClearCourtNow()); await sov(1500);
    g = await st(); s = await server();
    tjek('tabletten nulstillet, version 0', g.player1.score === 0 && !g.servingPlayer && g.version === 0 && g.setsToWin === 2);
    tjek('serveren: rækken slettet (tom tilstand)', s.player1.score === 0 && !s.servingPlayer && s.version === 0, JSON.stringify({ v: s.version, p: s.player1.score }));

    tjek('ingen JavaScript-fejl på siden', sidefejl.length === 0, sidefejl.slice(0, 3).join(' | '));
    await api(`/api/game-states/${BANE}`, 'DELETE');
    await browser.close();
    console.log(`\n${ok} ok, ${fejl} fejl`);
    process.exit(fejl ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
