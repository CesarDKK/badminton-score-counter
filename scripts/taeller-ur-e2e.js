#!/usr/bin/env node
// End-to-end for tælling fra uret (backend/routes/urTaeller.js) mod en kørende
// installation i club-mode: kobling med ur-koden, et tryk sendt to gange, hul i
// løbenumrene, en anden enhed der tæller (423) og overtagelse, en hel kamp
// sammenlignet med reglerne, kamphistorikken, fortryd af matchbolden, slået
// fra, ryddet bane og bremsen på gæt. Rydder banen til sidst.
//
// Kræver en klub med "Tæl fra uret" slået til og en aktiv ur-kode på banen
// (TV'et for banen skal have vist QR-koden):
//   BT_HOST=klub.badmintonapp.dk BT_KODE=123456 BT_ADMIN_TOKEN=<klub-admins token> \
//     [BT_ADRESSE=127.0.0.1] [BT_PORT=80] [BT_BANE=3] node scripts/taeller-ur-e2e.js
// NB: bremsen på gæt bruger IP'ens forsøg i 10 minutter — genstart backend
// for at køre igen med det samme.

const http = require('http');
const path = require('path');
const regler = require(path.join(__dirname, '../backend/taeller/regler'));
const HOST = process.env.BT_HOST;
const BANE = Number(process.env.BT_BANE || 3);
if (!HOST || !process.env.BT_KODE || !process.env.BT_ADMIN_TOKEN) {
    console.error('Mangler BT_HOST, BT_KODE eller BT_ADMIN_TOKEN — se toppen af filen');
    process.exit(2);
}
function kald(metode, sti, krop, token) {
    return new Promise((ok, fejl) => {
        const data = krop ? JSON.stringify(krop) : null;
        const req = http.request({ host: process.env.BT_ADRESSE || '127.0.0.1', port: Number(process.env.BT_PORT || 80), method: metode, path: '/api' + sti,
            headers: { Host: HOST, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, res => {
            let b = ''; res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, data: j }); });
        });
        req.on('error', fejl); if (data) req.write(data); req.end();
    });
}
let antalFejl = 0;
const tjek = (navn, betingelse, info = '') => { if (!betingelse) antalFejl++; console.log(`${betingelse ? 'OK  ' : 'FEJL'} ${navn}${info ? ' — ' + info : ''}`); };
(async () => {
    const kode = process.env.BT_KODE;
    const CA = process.env.BT_ADMIN_TOKEN;
    const k = await kald('POST', '/ur/kobl', { kode });
    tjek('kobl med koden', k.status === 200 && k.data.bane === BANE, `bane ${k.data && k.data.bane}`);
    const T = k.data.token;
    const ur = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    await kald('POST', `/game-states/${BANE}/taeller`, { taellerId: ur, taellerNavn: 'Ur', handling: 'overtag' }, k.data.token);
    let st = (await kald('GET', '/ur/bane?taellerId=' + ur, null, T)).data;
    let nr = (st.taeller === ur ? st.nr : 1000) ;
    const tryk = async (h, n) => kald('POST', '/ur/tryk', { handling: h, nr: n, taellerId: ur }, T);

    if (!st.tilstand.servingPlayer) st = (await tryk('S1', ++nr)).data;
    // a) Samme tryk to gange
    const foer = st.tilstand.player1.score;
    const r1 = await tryk('P1', ++nr), r2 = await tryk('P1', nr);
    tjek('samme tryk to gange tæller én gang', r1.status === 200 && r2.data.dublet && r2.data.tilstand.player1.score === foer + 1,
        `${foer} → ${r2.data.tilstand.player1.score}, dublet=${r2.data.dublet}`);
    // e) Hul i numrene
    const r3 = await tryk('P1', nr + 5);
    tjek('hul i løbenumrene afvises med serverens nummer', r3.status === 409 && r3.data.hul && r3.data.nr === nr, `nr ${r3.data.nr}`);

    // c) En tablet tæller: uret afvises (423), og kan overtage
    const tablet = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    await kald('POST', `/game-states/${BANE}/taeller`, { taellerId: tablet, taellerNavn: 'Tablet', handling: 'overtag' }, T);
    const sp = await tryk('P1', ++nr);
    tjek('en anden enhed tæller: uret afvises', sp.status === 423, `status ${sp.status}`);
    const ov = await kald('POST', `/game-states/${BANE}/taeller`, { taellerId: ur, taellerNavn: 'Ur', handling: 'overtag' }, T);
    const efter = await tryk('P1', nr);   // samme nummer igen efter afvisningen
    tjek('uret overtager og kan tælle igen', ov.status === 200 && efter.status === 200, `overtag ${ov.status}, tryk ${efter.status}`);

    // b) Spil kampen færdig og sammenlign med reglerne lokalt
    const start = (await kald('GET', '/ur/bane?taellerId=' + ur, null, T)).data;
    const lokal = JSON.parse(JSON.stringify(start.tilstand)); lokal.history = [];
    let sidste = start, i = 0;
    while (!sidste.tilstand.matchCompleted && i < 400) {
        const pause = sidste.tilstand.restBreakActive;
        const h = pause ? 'B' : (Math.random() < 0.55 ? 'P1' : 'P2');
        const n = Number(h[1]);
        if (h === 'B') regler.afslutPause(lokal); else regler.point(lokal, n, Date.now());
        const r = await tryk(h, ++nr);
        if (r.status !== 200) { tjek('tryk under kampen', false, `${r.status} ${JSON.stringify(r.data)}`); break; }
        sidste = r.data; i++;
    }
    tjek('hele kampen: serveren = reglerne lokalt', regler.signatur(sidste.tilstand) === regler.signatur(lokal), regler.signatur(sidste.tilstand).slice(0, 60));
    tjek('kampen er slut', sidste.slut && sidste.haendelser.includes('kamp'));
    const hist = (await kald('GET', `/match-history/${BANE}/latest`, null, CA)).data;
    tjek('kamphistorikken har kampen', hist && (hist.winner_name || hist.winnerName), JSON.stringify(hist).slice(0, 120));
    // Fortryd matchbolden: kampen genåbnes
    const u = await tryk('U', ++nr);
    tjek('fortryd matchbolden genåbner kampen', u.status === 200 && !u.data.slut, `slut=${u.data.slut}`);
    const p = await tryk(sidste.tilstand.player1.games > sidste.tilstand.player2.games ? 'P1' : 'P2', ++nr);
    tjek('vind kampen igen', p.data.slut === true);
    // i) Ny kamp: rent scoreboard, uret er stadig koblet, og TV'et viser resultatet
    const ny = await tryk('N', ++nr);
    const tv = (await kald('GET', `/game-states/${BANE}`, null, CA)).data;
    tjek('ny kamp efter kampslut: rent scoreboard', ny.status === 200 && !ny.data.slut && ny.data.sider[0].point === 0 && ny.data.sider[0].saet === 0,
        `status ${ny.status}`);
    tjek('ny kamp: TV\'et viser resultatet', tv && !tv.matchCompleted && !!tv.lastFinishedMatch);

    // f) Udløbet sætpause: næste tryk begynder næste sæt først — via ny kamp
    // g) Slået fra
    await kald('PUT', '/settings/ur-taelling', { urTaelling: false }, CA);
    const fra1 = await kald('POST', '/ur/kobl', { kode });
    const fra2 = await tryk('U', ++nr);
    tjek('slået fra: kobl og tryk afvises', fra1.status === 404 && fra2.status === 404, `${fra1.status}/${fra2.status}`);
    await kald('PUT', '/settings/ur-taelling', { urTaelling: true }, CA);

    // d) Banen ryddes: sessionen og koden ophører
    const ryd = await kald('DELETE', `/game-states/${BANE}`, null, CA);
    const efterRyd = await tryk('P1', ++nr);
    const kodeIgen = await kald('POST', '/ur/kobl', { kode });
    tjek('ryddet bane: urets adgang ophører', efterRyd.status === 401 || efterRyd.status === 403, `ryd ${ryd.status}, tryk ${efterRyd.status}`);
    tjek('ryddet bane: den gamle kode virker ikke', kodeIgen.status === 404, `${kodeIgen.status}`);

    // h) Gæt på koder bremses
    let s429 = 0;
    for (let j = 0; j < 35; j++) { const g = await kald('POST', '/ur/kobl', { kode: String(100000 + j) }); if (g.status === 429) s429++; }
    tjek('gæt på koder bremses', s429 > 0, `${s429} af 35 afvist med 429`);
    process.exit(antalFejl ? 1 : 0);
})();
