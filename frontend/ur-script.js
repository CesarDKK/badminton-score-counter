// Tæl fra uret (ur.html) — en lille side til Apple Watch.
//
// Uret kobles til en bane med ur-koden fra TV'et (eller linket fra telefonens
// QR-side, ?k=<kode>) og sender tryk til serveren (backend/routes/urTaeller.js),
// som regner med de fælles pointregler. Uret regner selv med de samme regler
// (js/taeller-regler.js), så et tryk vises med det samme — nedtonet, indtil
// serveren har svaret. Trykkene har løbenumre og sendes i rækkefølge; går
// svaret tabt, sendes trykket igen, og serveren tæller det ikke to gange.
//
// Spillerne står fast på skærmen hele kampen (som på TV'et), også når de
// skifter side på banen — et tryk på en spiller giver den spiller pointet.

const R = window.TaellerRegler;
const LAGER = 'ur-taeller';
const POLL_MS = 3000;
const IKKE_SENDT_MS = 3000;

// Det, uret husker mellem åbningerne: sessionen, enhedens id, løbenummeret og
// tryk, der ikke er nået frem endnu
let gemt = { token: null, bane: null, taeller: null, nr: 0, ko: [] };
try { gemt = { ...gemt, ...JSON.parse(localStorage.getItem(LAGER) || '{}') }; } catch { /* privat visning */ }
if (!gemt.taeller) {
    gemt.taeller = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
}
function gem() {
    try { localStorage.setItem(LAGER, JSON.stringify(gemt)); } catch { /* ikke vigtigt */ }
}

let server = null;          // serverens seneste svar
let tidsforskel = 0;        // serverens ur minus urets eget
let raekkefoelge = null;    // [navn øverst, navn nederst]
let sender = false;
let senderSiden = 0;
let spaerret = false;
let pauseSendt = false;

const $ = (id) => document.getElementById(id);

async function kald(sti, opt = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (gemt.token) headers.Authorization = 'Bearer ' + gemt.token;
    const res = await fetch('/api' + sti, { ...opt, headers, cache: 'no-store' });
    let data = null;
    try { data = await res.json(); } catch { /* tomt svar */ }
    return { status: res.status, data };
}

// ?maal: viser skærmens mål på uret (til at tilpasse siden)
if (/[?&]maal\b/.test(location.search)) {
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;left:0;right:0;bottom:0;font-size:10px;background:#000c;color:#ffb02e;text-align:center;z-index:9;pointer-events:none';
    const proeve = (h) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;visibility:hidden;height:${h}`; document.body.appendChild(d); const v = d.offsetHeight; d.remove(); return v; };
    document.body.appendChild(m);
    setInterval(() => {
        m.textContent = `${innerWidth}×${innerHeight} rul ${Math.round(scrollY)}/${document.documentElement.scrollHeight} ` +
            `lvh ${proeve('100lvh')} svh ${proeve('100svh')} dvh ${proeve('100dvh')}`;
    }, 500);
}

// ---- Koden ----
let kode = '';
function visKode(fejl = '') {
    $('kampSide').classList.add('skjult');
    $('kodeSide').classList.remove('skjult');
    kodeTekst(fejl);
    kode = '';
    tegnKode();
}
// Linjen over koden: vejledningen, eller hvad der gik galt
function kodeTekst(fejl = '') {
    $('kodeTekst').textContent = fejl || 'Tast koden fra banens TV';
    $('kodeTekst').classList.toggle('fejl', !!fejl);
}
function tegnKode() {
    $('kodeVisning').textContent = (kode + '······').slice(0, 6).replace(/(...)(...)/, '$1 $2');
}
function byggTastatur() {
    const t = $('tastatur');
    // 4 × 3: tastaturet skal passe under urets adresselinje
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫', 'OK'].forEach(k => {
        const b = document.createElement('button');
        b.textContent = k;
        if (k === 'OK') b.className = 'ok';
        b.addEventListener('click', () => {
            if (k === '⌫') kode = kode.slice(0, -1);
            else if (k === 'OK') { if (kode.length === 6) kobl(kode); }
            else if (kode.length < 6) kode += k;
            tegnKode();
            if (kode.length === 6 && k !== 'OK' && k !== '⌫') kobl(kode);
        });
        t.appendChild(b);
    });
}

async function kobl(k) {
    kodeTekst('Kobler på …');
    try {
        const { status, data } = await kald('/ur/kobl', { method: 'POST', body: JSON.stringify({ kode: k }) });
        if (status !== 200) {
            visKode((data && data.error) || 'Koden virker ikke');
            return;
        }
        // Ny bane: trykkene til den forrige bane hører ikke til her
        gemt = { ...gemt, token: data.token, bane: data.bane, ko: [] };
        gem();
        raekkefoelge = null;
        visKamp();
        hent();
    } catch {
        visKode('Ingen forbindelse — prøv igen');
    }
}

function sessionSlut(tekst) {
    gemt = { ...gemt, token: null, bane: null, ko: [] };
    gem();
    server = null;
    visKode(tekst);
}

// ---- Kampen ----
function visKamp() {
    $('kodeSide').classList.add('skjult');
    $('kampSide').classList.remove('skjult');
}

function modtag(data) {
    server = data;
    tidsforskel = (data.nu || Date.now()) - Date.now();
    tegn();
}

// Serveren har logget uret ud (15 min uden tryk) eller ryddet banen
const udTekst = (data) => (data && data.loggetUd && data.error) || 'Banen er ryddet — tast koden igen';

async function hent() {
    if (!gemt.token || sender || gemt.ko.length) return;
    try {
        const { status, data } = await kald(`/ur/bane?taellerId=${gemt.taeller}`);
        if (status === 401 || status === 403) return sessionSlut(udTekst(data));
        if (status !== 200) return;
        spaerret = !!data.spaerret;
        modtag(data);
    } catch { /* intet net: prøv igen ved næste poll */ }
}

// Stillingen, som den bliver, når trykkene i køen er nået frem
function forventet() {
    if (!server) return null;
    const st = JSON.parse(JSON.stringify(server.tilstand));
    st.history = [];
    for (const t of gemt.ko) {
        const n = Number(t.handling[1]);
        if (t.handling[0] === 'P') pointLokalt(st, n);
        else if (t.handling[0] === 'S') R.vaelgServer(st, n);
        else if (t.handling === 'B') R.afslutPause(st);
        else if (t.handling === 'K') R.startKamp(st, Date.now() + tidsforskel);
        else if (t.handling === 'N' && st.matchCompleted) {
            Object.assign(st, R.nyKamp({ isDoubles: st.isDoubles, gameMode: st.gameMode }));
        }
        // Fortryd vises først, når serveren har svaret (uret har ikke historikken)
    }
    return st;
}

// Et point, som serveren regner det: et point i pausen ved 11 (8) afslutter
// pausen først — spillerne er i gang igen (backend/routes/urTaeller.js)
function pointLokalt(st, side) {
    if (st.restBreakActive && !R.erSaetAfgjort(st)) R.afslutPause(st);
    return R.point(st, side, Date.now() + tidsforskel);
}

// Kampen er ikke begyndt: uret viser kun "Start kamp"
const klarTilStart = (st) => !st.matchStartTime && !st.matchCompleted;

// "Start kamp": uret vælger ikke server — den venstre side server første bold,
// og derefter server den, der vinder bolden (reglerne), så tællingen retter sig
// selv efter første point. Kampen begynder (TV'et skifter fra "banen er ledig")
function startKamp() {
    const st = forventet();
    if (!st || !raekkefoelge || spaerret || !klarTilStart(st)) return;
    if (!st.servingPlayer) tryk('S' + sideFor(st, raekkefoelge[0]));
    tryk('K');
}

// Hvilken side (1/2) står spilleren på nu
const sideFor = (st, navn) => (st.player1.name === navn ? 1 : 2);
// Double: kun fornavnene ("Anders & Carl") — to fulde navne er for lange til
// urets halve skærm; de fulde navne står på TV'et
const fornavn = (n) => String(n || '').trim().split(/\s+/)[0];
const visNavn = (st, p) => (st.isDoubles && p.name2 && !/^Makker [12]$/.test(p.name2)
    ? `${fornavn(p.name)} & ${fornavn(p.name2)}` : p.name);

function tryk(handling) {
    gemt.nr += 1;
    gemt.ko.push({ nr: gemt.nr, handling });
    gem();
    tegn();
    send();
}

function trykPaaSpiller(i) {
    const st = forventet();
    if (!st || !raekkefoelge || spaerret) return;
    const side = sideFor(st, raekkefoelge[i]);
    // Før kampen tælles intet — kampen begynder med "Start kamp"
    if (klarTilStart(st)) return;
    // Afvises reglerne trykket (afgjort kamp, sætpause), sendes det ikke
    const proeve = JSON.parse(JSON.stringify(st));
    proeve.history = [];
    if (!pointLokalt(proeve, side).ok) return;
    tryk('P' + side);
}

async function send() {
    if (sender || !gemt.ko.length || !gemt.token) return;
    sender = true;
    senderSiden = Date.now();
    tegn();
    while (gemt.ko.length) {
        const t = gemt.ko[0];
        let svar;
        try {
            svar = await kald('/ur/tryk', { method: 'POST',
                body: JSON.stringify({ handling: t.handling, nr: t.nr, taellerId: gemt.taeller }) });
        } catch {
            // Intet svar: prøv igen om lidt — trykket tæller kun én gang
            sender = false;
            tegn();
            setTimeout(send, 2000);
            return;
        }
        const { status, data } = svar;
        if (status === 401 || status === 403) { sender = false; return sessionSlut(udTekst(data)); }
        if (status === 423) {
            // En anden enhed tæller kampen: trykkene her tælles ikke
            spaerret = true;
            gemt.ko = [];
            gem();
            break;
        }
        if (status === 409 && data && data.hul) {
            // Serveren mangler et tidligere nummer: nummerér køen forfra efter dens
            gemt.ko.forEach((x, i) => { x.nr = data.nr + 1 + i; });
            gemt.nr = data.nr + gemt.ko.length;
            gem();
            modtag(data);
            continue;
        }
        if (status !== 200) {
            sender = false;
            tegn();
            setTimeout(send, 2000);
            return;
        }
        // "Færdig": uret er logget ud (banen er nulstillet, hvis kampen var slut)
        if (t.handling === 'F') { sender = false; return sessionSlut('Tak for kampen — tast koden fra TV\'et for at tælle igen'); }
        gemt.ko.shift();
        gem();
        spaerret = false;
        modtag(data);
        if (data.haendelser && data.haendelser.includes('sideskift')) visBesked('Skift side!');
        if (data.haendelser && data.haendelser.includes('kamp')) pauseSendt = false;
        // Ny kamp afvist: badmintonplanner-banens resultat står til næste runde
        if (t.handling === 'N' && data.afvist && data.slut) visBesked('Resultatet bliver stående til næste runde');
    }
    sender = false;
    tegn();
}

let beskedTil = 0;
let besked = '';
function visBesked(tekst) {
    besked = tekst;
    beskedTil = Date.now() + 4000;
}

function mmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tegn() {
    if (!server) return;
    const st = forventet();
    // Rækkefølgen: som i 1. sæt (eller som nu, før første sæt), og den står
    // fast resten af kampen
    const par = [st.player1.name, st.player2.name];
    if (!raekkefoelge || !par.includes(raekkefoelge[0]) || !par.includes(raekkefoelge[1])) {
        const f = (st.setScoresHistory || [])[0];
        raekkefoelge = f && par.includes(f.player1Name) && par.includes(f.player2Name)
            ? [f.player1Name, f.player2Name] : par;
    }
    const serv = st.isDoubles ? st.servingTeam : st.servingPlayer;
    const pause = st.restBreakActive;
    const saetPause = pause && R.erSaetAfgjort(st);

    raekkefoelge.forEach((navn, i) => {
        const side = sideFor(st, navn);
        const p = st['player' + side];
        const a = st['player' + (3 - side)];
        const el = $('side' + i);
        el.querySelector('.navn').textContent = visNavn(st, p);
        el.querySelector('.point').textContent = p.score || 0;
        el.classList.toggle('serv', !!serv && serv === side && !st.matchCompleted);
        el.classList.toggle('vinder', st.matchCompleted && p.games > a.games);
        el.disabled = spaerret || st.matchCompleted || saetPause;
    });

    $('overskrift').textContent = spaerret ? `Bane ${server.bane}`
        : klarTilStart(st) ? `Bane ${server.bane} · tryk Start kamp`
        : st.matchCompleted ? 'Kampen er slut'
        : `Bane ${server.bane} · ${(st.player1.games || 0) + (st.player2.games || 0) + 1}. sæt`;

    // Pausen (ved 11/8 og mellem sæt) og kampslut: stillingen står på TV'et, så
    // spillerne skjules, og store knapper fylder skærmen
    const iPause = pause && !st.matchCompleted && !spaerret;
    const slut = st.matchCompleted && !spaerret;
    $('kampSide').classList.toggle('i-pause', iPause);
    $('kampSide').classList.toggle('slut', slut);
    if (iPause) $('overskrift').textContent = saetPause ? 'Sæt vundet · pause' : 'Pause';

    // "Fortsæt" med nedtællingen. Pausen ved 11 (8) slutter også ved næste
    // point; er nedtællingen slut, sender uret selv "Fortsæt" (én gang, kun mens
    // siden er åben) — efter sætpausen begynder næste sæt
    const tid = $('naeste').querySelector('.tid');
    if (pause && server.pause && server.pause.slutter) {
        const tilbage = server.pause.slutter - (Date.now() + tidsforskel);
        tid.textContent = saetPause ? `Næste sæt om ${mmss(tilbage)}` : `Pause ${mmss(tilbage)}`;
        if (tilbage <= 0 && !pauseSendt && !gemt.ko.length && !spaerret) { pauseSendt = true; tryk('B'); }
    } else {
        tid.textContent = saetPause ? 'Næste sæt' : '';
        pauseSendt = false;
    }
    $('naeste').classList.toggle('skjult', !iPause);
    // Kampen er slut: "Ny kamp" giver banen et rent scoreboard (TV'et viser
    // resultatet et par minutter), og uret bliver koblet på banen. "Færdig" gør
    // det samme og logger uret ud — også når en anden enhed har taget over
    $('nyKamp').classList.toggle('skjult', !slut);
    $('faerdig').classList.toggle('skjult', !slut);
    $('faerdigLille').classList.toggle('skjult', !spaerret);
    $('overtag').classList.toggle('skjult', !spaerret);
    $('fortryd').classList.toggle('skjult', spaerret || klarTilStart(st));   // intet at fortryde før kampen
    // Kampen er ikke begyndt: kun "Start kamp" (TV'et skifter fra "banen er
    // ledig" til kampen)
    $('startKamp').classList.toggle('skjult', !klarTilStart(st) || spaerret);
    // Status: sendes, ikke nået frem, eller en besked
    const s = $('status');
    if (spaerret) {
        s.textContent = 'En anden enhed tæller kampen';
        s.className = 'lille fejl';
    } else if (gemt.ko.length) {
        const laenge = Date.now() - senderSiden > IKKE_SENDT_MS;
        s.textContent = laenge ? 'Ikke sendt endnu — prøver igen' : 'Sender …';
        s.className = 'lille ' + (laenge ? 'fejl' : 'venter');
    } else if (Date.now() < beskedTil) {
        s.textContent = besked;
        s.className = 'lille';
    } else {
        s.textContent = '';
        s.className = 'lille';
    }
}

async function overtag() {
    try {
        await kald(`/game-states/${gemt.bane}/taeller`, { method: 'POST',
            body: JSON.stringify({ taellerId: gemt.taeller, taellerNavn: 'Ur', handling: 'overtag' }) });
    } catch { return; }
    spaerret = false;
    hent();
}

// ---- Start ----
byggTastatur();
$('side0').addEventListener('click', () => trykPaaSpiller(0));
$('side1').addEventListener('click', () => trykPaaSpiller(1));
$('fortryd').addEventListener('click', () => { if (!spaerret) tryk('U'); });
$('naeste').addEventListener('click', () => tryk('B'));
$('startKamp').addEventListener('click', startKamp);
$('nyKamp').addEventListener('click', () => { if (!spaerret) tryk('N'); });
$('faerdig').addEventListener('click', () => tryk('F'));
$('faerdigLille').addEventListener('click', () => tryk('F'));
$('overtag').addEventListener('click', overtag);

const k = new URLSearchParams(location.search).get('k');
if (k && /^\d{6}$/.test(k)) {
    history.replaceState(null, '', location.pathname);
    kobl(k);
} else if (gemt.token) {
    visKamp();
    hent();
    send();
} else {
    visKode();
}
setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (gemt.ko.length) send(); else hent();
}, POLL_MS);
setInterval(tegn, 1000);   // pausens nedtælling og "ikke sendt endnu"
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { hent(); send(); } });
