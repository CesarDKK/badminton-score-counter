#!/usr/bin/env node
// Sammenligner serverens pointregler (backend/taeller/regler.js) med den rigtige
// tablet-side (frontend/court-script-v3.js): mange tilfældige kampe spilles på
// begge, og tilstanden skal være den samme efter hvert tryk. Kampene og
// tablettens tilstand efter hvert tryk gemmes i
// backend/tests/unit/data/taeller-kampe.json, som unit-testen afspiller — kør
// scriptet igen, når tablettens regler ændres.
//
// Kræver en kørende installation (fx scripts/cloud-test-deploy.sh) og
// Playwright med Chromium:
//   node scripts/taeller-sammenlign.js [--url http://localhost:8080] [--bane 5] [--kampe 80] [--seed 1]
// Banen bruges kun i browseren — intet gemmes på serveren (gemningerne er slået fra).

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const regler = require('../backend/taeller/regler');

const arg = (navn, standard) => {
    const i = process.argv.indexOf(`--${navn}`);
    return i > 0 ? process.argv[i + 1] : standard;
};
const URL = arg('url', 'http://localhost:8080');
const BANE = Number(arg('bane', 5));
const KAMPE = Number(arg('kampe', 80));
const SEED = Number(arg('seed', 1));
const UD = path.join(__dirname, '../backend/tests/unit/data/taeller-kampe.json');

// Deterministisk tilfældighed, så de samme kampe kan spilles igen
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Kampens opsætning: single/double, 21/30 eller 15/21, og nogle golden set
function opsaetning(r, i) {
    const isDoubles = r() < 0.5;
    return {
        navne: isDoubles
            ? { p1: `Anna${i}`, p1b: `Bo${i}`, p2: `Carl${i}`, p2b: `Dorte${i}` }
            : { p1: `Emil${i}`, p2: `Frida${i}` },
        isDoubles,
        gameMode: r() < 0.5 ? '21' : '15',
        setsToWin: r() < 0.12 ? 1 : 2
    };
}

const fingeraftryk = (sig) => crypto.createHash('sha1').update(sig).digest('hex').slice(0, 8);

// Næste tryk ud fra tilstanden (som en dommer kunne finde på), også fejltryk
function naesteHandling(st, r, styrke) {
    if (st.matchCompleted) return r() < 0.3 ? 'U' : null;   // fortryd matchbolden — eller færdig
    if (!st.servingPlayer) {
        if (st.isDoubles && r() < 0.3) return r() < 0.5 ? 'X1' : 'X2';
        return r() < 0.5 ? 'S1' : 'S2';
    }
    if (st.restBreakActive) {
        const saetPause = regler.erSaetAfgjort(st);
        const x = r();
        if (saetPause) return x < 0.85 ? 'B' : x < 0.95 ? 'U' : 'P1';   // P1 afvises i sætpausen
        if (x < 0.7) return 'B';
    }
    if (st.isDoubles && st.betweenSets && r() < 0.25) return r() < 0.5 ? 'X1' : 'X2';
    if (!st.matchStartTime && r() < 0.2) return 'K';
    const x = r();
    if (x < 0.05) return 'U';
    return x < 0.05 + 0.95 * styrke ? 'P1' : 'P2';
}

function anvend(st, h, nu) {
    switch (h) {
        case 'S1': case 'S2': return regler.vaelgServer(st, Number(h[1]));
        case 'X1': case 'X2': return regler.bytPladser(st, Number(h[1]));
        case 'P1': case 'P2': return regler.point(st, Number(h[1]), nu);
        case 'K': return regler.startKamp(st, nu);
        case 'B': return regler.afslutPause(st);
        case 'U': return regler.fortryd(st);
        default: throw new Error('Ukendt handling ' + h);
    }
}

async function main() {
    let chromium;
    try { ({ chromium } = require('playwright')); } catch {
        console.error('Playwright mangler: npm i playwright (eller NODE_PATH til en installation)');
        process.exit(2);
    }
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    const page = await browser.newPage();
    const fejl = [];
    page.on('pageerror', e => fejl.push(e.message));
    // Ingen live-opdateringer fra serveren — de kunne skrive over den lokale kamp
    await page.addInitScript(() => {
        window.EventSource = class { constructor() {} addEventListener() {} close() {} };
    });
    await page.goto(`${URL}/court-v3.html?court=${BANE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Tabletten tæller lokalt: gemninger, resultat-indmelding og sync slås fra
    await page.evaluate(() => {
        for (let i = 1; i < 100000; i++) { clearInterval(i); clearTimeout(i); }
        window.performSave = async () => {};
        window.saveGameState = () => {};
        window.saveMatchResult = async () => {};
        window.taellerPing = async () => ({ ejer: true });
        window.acquireWakeLock = () => {};
        window.releaseWakeLock = () => {};
    });

    const r = rng(SEED);
    const kampe = [];
    let forskelle = 0;
    for (let i = 0; i < KAMPE; i++) {
        const ops = opsaetning(r, i);
        const styrke = 0.3 + r() * 0.4;
        const st = regler.nyKamp(ops);
        await page.evaluate((o) => {
            if (gameState.restBreakInterval) clearInterval(gameState.restBreakInterval);
            if (gameState.timerInterval) clearInterval(gameState.timerInterval);
            Object.assign(gameState, {
                player1: { name: o.navne.p1, name2: o.navne.p1b || 'Makker 1', score: 0, games: 0 },
                player2: { name: o.navne.p2, name2: o.navne.p2b || 'Makker 2', score: 0, games: 0 },
                isDoubles: o.isDoubles, gameMode: o.gameMode, setsToWin: o.setsToWin,
                isActive: false, matchStartTime: null, matchEndTime: null, matchCompleted: false,
                decidingGameSwitched: false, sidesManuallySwitched: false, setScoresHistory: [],
                restBreakTaken: false, restBreakActive: false, restBreakInterval: null, restBreakCallback: null,
                restBreakSecondsLeft: 0, restBreakTitle: '', restBreakDuration: 60, restBreakStartedAt: null,
                servingPlayer: null, initialServer: null, servingTeam: null, servingPlayerOnTeam: null,
                team1RightCourt: 1, team2RightCourt: 1, betweenSets: false, timerSeconds: 0,
                timerInterval: null, resultOutcome: null, resultWinner: null, history: []
            });
            hideMessage && hideMessage();
        }, ops);

        const handlinger = [];
        const sig = [];
        for (let n = 0; n < 600; n++) {
            const h = naesteHandling(st, r, styrke);
            if (!h) break;
            anvend(st, h, 1_800_000_000_000 + n * 1000);
            const tablet = await page.evaluate(async (h) => {
                _lastPointTime = 0;
                const kald = { S1: () => selectServer(1), S2: () => selectServer(2),
                    X1: () => swapPlayers(1), X2: () => swapPlayers(2),
                    P1: () => addPoint(1), P2: () => addPoint(2),
                    K: () => startMatch(), B: () => endRestBreak(), U: () => undoLastAction() }[h];
                await kald();
                await new Promise(res => setTimeout(res, 0));
                if (gameState.restBreakInterval) { clearInterval(gameState.restBreakInterval); gameState.restBreakInterval = null; }
                return JSON.parse(JSON.stringify({ ...gameState, timerInterval: null, restBreakInterval: null, restBreakCallback: null }));
            }, h);
            const a = regler.signatur(tablet), b = regler.signatur(st);
            handlinger.push(h);
            sig.push(a);
            if (a !== b) {
                forskelle++;
                console.log(`Kamp ${i} (${JSON.stringify(ops)}), tryk ${n} (${handlinger.join(' ')}):\n  tablet: ${a}\n  server: ${b}`);
                break;
            }
        }
        // Et kort fingeraftryk pr. tryk (så filen ikke fylder megabytes) og
        // tilstanden læselig til sidst
        kampe.push({ opsaetning: ops, handlinger: handlinger.join(' '),
            aftryk: sig.map(fingeraftryk).join(' '), slut: sig[sig.length - 1] || null });
    }
    await browser.close();

    const tryk = kampe.reduce((s, k) => s + k.aftryk.split(' ').length, 0);
    console.log(`${KAMPE} kampe, ${tryk} tryk, ${forskelle} forskelle${fejl.length ? `, sidefejl: ${fejl.slice(0, 3).join(' | ')}` : ''}`);
    if (forskelle === 0) {
        fs.mkdirSync(path.dirname(UD), { recursive: true });
        fs.writeFileSync(UD, JSON.stringify({ seed: SEED, kampe }, null, 1) + '\n');
        console.log(`Gemt: ${path.relative(process.cwd(), UD)}`);
    }
    process.exit(forskelle ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
