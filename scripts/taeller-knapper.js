#!/usr/bin/env node
// Knapperne på tablet-siden: tilfældige kampe spilles ved at KLIKKE på de rigtige
// knapper (+1, Start serv, Fortryd, Fortsæt kamp, Skift side, byt spillere, og
// "Ny kamp → Annuller" for at nå Fortryd efter en matchbold) — ikke ved at kalde
// funktionerne — og tilstanden sammenlignes med reglerne (backend/taeller/regler.js)
// efter hvert klik. Kun knapper, der kan nås på skærmen (ikke dækket af en besked
// eller pause-overlayet), bliver trykket, som en dommer ville gøre. Dobbelttryk-
// værnet (250 ms på samme side) respekteres: to tryk på samme side kommer med
// mindst 350 ms mellem.
//
// Kør mod den lokale installation (samme Docker-opskrift som taeller-e2e.js, uden token):
//   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" -w /repo \
//     -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -e CHROMIUM=/usr/bin/chromium -e NODE_PATH=/tmp/pw/node_modules \
//     -e BT_URL=http://host.docker.internal:8080 -e KAMPE=12 --add-host=host.docker.internal:host-gateway \
//     node:22-alpine sh -c "apk add -q chromium nss freetype harfbuzz ttf-freefont && mkdir -p /tmp/pw && cd /tmp/pw \
//       && npm i -s playwright && cd /repo && node scripts/taeller-knapper.js"
// KAMPE (standard 10) og SEED (standard 7) kan sættes. Bruger installationens sidste bane.
const { chromium } = require('playwright');
const regler = require('../backend/taeller/regler');

const URL = process.env.BT_URL || 'http://localhost:8080';
const KAMPE = Number(process.env.KAMPE || 10);
const sov = (ms) => new Promise(r => setTimeout(r, ms));

function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KNAP = { S1: '#startServPlayer1', S2: '#startServPlayer2', X1: '#swapPlayer1Btn', X2: '#swapPlayer2Btn', V: '#switchSidesCourtBtn',
    K: '#startMatchBtn', P1: '#addPointPlayer1', P2: '#addPointPlayer2', B: '#skipRestBreak', U: '#undoBtn' };

function naesteHandling(st, r, styrke) {
    if (st.matchCompleted) return r() < 0.4 ? 'U' : null;
    if (!st.servingPlayer) {
        const x = r();
        if (st.isDoubles && x < 0.25) return r() < 0.5 ? 'X1' : 'X2';
        if (x < 0.35) return 'V';
        return r() < 0.5 ? 'S1' : 'S2';
    }
    if (st.restBreakActive) return r() < 0.85 ? 'B' : 'U';
    if (st.isDoubles && st.betweenSets && r() < 0.25) return r() < 0.5 ? 'X1' : 'X2';
    if (!st.matchStartTime && r() < 0.2) return 'K';
    const x = r();
    if (x < 0.05) return 'U';
    return x < 0.05 + 0.95 * styrke ? 'P1' : 'P2';
}
function anvend(st, h) {
    switch (h) {
        case 'S1': case 'S2': return regler.vaelgServer(st, Number(h[1]));
        case 'X1': case 'X2': return regler.bytPladser(st, Number(h[1]));
        case 'V': return regler.skiftSide(st);
        case 'P1': case 'P2': return regler.point(st, Number(h[1]), 1);
        case 'K': return regler.startKamp(st, 1);
        case 'B': return regler.afslutPause(st);
        case 'U': return regler.fortryd(st);
    }
}

async function main() {
    const settings = await (await fetch(URL + '/api/settings')).json();
    const BANE = settings.courtCount;
    const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const fejl = [];
    page.on('pageerror', e => fejl.push(e.message));
    await page.goto(`${URL}/court-v3.html?court=${BANE}`, { waitUntil: 'networkidle' });
    await sov(1500);

    const sig = () => page.evaluate(() => TaellerRegler.signatur(gameState));
    // Kan knappen trykkes, som skærmen ser ud nu (synlig, ikke disabled, ikke dækket)?
    const kanNaas = (sel) => page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || el.disabled) return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === el || el.contains(top));
    }, sel);
    const beskedTitel = () => page.evaluate(() => {
        const o = document.getElementById('messageOverlay');
        return o && getComputedStyle(o).display !== 'none' ? document.getElementById('messageTitle').textContent : null;
    });
    const klikBesked = async (tekst) => {
        const knap = page.locator('#messageButtons button', { hasText: tekst }).first();
        await knap.click({ timeout: 2000 });
        await sov(80);
    };
    // Beskeder lukkes, som en dommer ville: Sæt vundet → Fortsæt (pausen vises);
    // kampen vundet → Ny kamp → Annuller (så Fortryd kan nås); ellers OK
    const lukBeskeder = async () => {
        for (let i = 0; i < 4; i++) {
            const t = await beskedTitel();
            if (!t) return;
            const knapper = await page.evaluate(() => [...document.querySelectorAll('#messageButtons button')].map(b => b.textContent.trim()));
            if (knapper.includes('Fortsæt')) await klikBesked('Fortsæt');
            else if (knapper.includes('Ny kamp')) { await klikBesked('Ny kamp'); await klikBesked('Annuller'); }
            else if (knapper.includes('Annuller')) await klikBesked('Annuller');
            else await klikBesked(knapper[0]);
        }
    };

    const r = rng(Number(process.env.SEED || 7));
    let forskelle = 0, klik = 0, sprunget = 0;
    const brugt = {};
    const sidstePoint = { 1: 0, 2: 0 };
    for (let i = 0; i < KAMPE; i++) {
        const isDoubles = r() < 0.5;
        const ops = { navne: isDoubles ? { p1: `Anna${i}`, p1b: `Bo${i}`, p2: `Carl${i}`, p2b: `Dorte${i}` } : { p1: `Emil${i}`, p2: `Frida${i}` },
            isDoubles, gameMode: r() < 0.5 ? '21' : '15', setsToWin: r() < 0.15 ? 1 : 2 };
        const styrke = 0.3 + r() * 0.4;
        const st = regler.nyKamp(ops);
        await page.evaluate(async (o) => {
            if (typeof hideMessage === 'function') hideMessage();
            await performClearCourtNow();
            gameState.gameMode = o.gameMode; gameState.isDoubles = o.isDoubles; gameState.setsToWin = o.setsToWin;
            gameState.player1.name = o.navne.p1; gameState.player2.name = o.navne.p2;
            gameState.player1.name2 = o.navne.p1b || 'Makker 1'; gameState.player2.name2 = o.navne.p2b || 'Makker 2';
            updateDisplay(); saveGameState();
        }, ops);
        await sov(700);
        if ((await sig()) !== regler.signatur(st)) { console.log(`Kamp ${i}: start-tilstand afviger\n  tablet: ${await sig()}\n  regler: ${regler.signatur(st)}`); forskelle++; continue; }

        const handlinger = [];
        for (let n = 0; n < 500; n++) {
            let h = naesteHandling(st, r, styrke);
            if (!h) break;
            await lukBeskeder();
            if (!(await kanNaas(KNAP[h]))) {
                // Knappen kan ikke nås (pause-overlay, skjult knap): som en dommer
                // trykker vi "Fortsæt kamp", hvis det er pausen, ellers lader vi være
                if (h !== 'B' && (await kanNaas(KNAP.B))) h = 'B';
                else { sprunget++; continue; }
            }
            if (h === 'P1' || h === 'P2') {   // dobbelttryk-værnet: 250 ms på samme side
                const v = 350 - (Date.now() - sidstePoint[h[1]]);
                if (v > 0) await sov(v);
            }
            await page.click(KNAP[h], { timeout: 2000 });
            if (h === 'P1' || h === 'P2') sidstePoint[h[1]] = Date.now();   // målt EFTER trykket
            klik++; brugt[h] = (brugt[h] || 0) + 1;
            anvend(st, h);
            handlinger.push(h);
            await sov(h === 'U' || h === 'B' ? 150 : 40);
            const a = await sig(), b = regler.signatur(st);
            if (a !== b) {
                forskelle++;
                console.log(`Kamp ${i} (${JSON.stringify(ops)}), klik ${n} (${handlinger.slice(-12).join(' ')}):\n  tablet: ${a}\n  regler: ${b}`);
                break;
            }
        }
        console.log(`kamp ${i + 1}: ${ops.isDoubles ? 'double' : 'single'} ${ops.gameMode}${ops.setsToWin === 1 ? ' golden set' : ''} — ${handlinger.length} klik, ${st.matchCompleted ? 'færdig ' + st.player1.games + '-' + st.player2.games : 'ikke færdig'}`);
    }
    await page.evaluate(async () => { if (typeof hideMessage === 'function') hideMessage(); await performClearCourtNow(); });
    await browser.close();
    console.log(`\n${KAMPE} kampe, ${klik} klik på rigtige knapper (${Object.entries(brugt).map(([k, v]) => k + ':' + v).join(' ')}), ${sprunget} sprunget over, ${forskelle} forskelle${fejl.length ? ', SIDEFEJL: ' + fejl.slice(0, 3).join(' | ') : ''}`);
    process.exit(forskelle || fejl.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
