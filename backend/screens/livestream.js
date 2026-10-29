// Livestream fra TV-PC'ens USB-kamera (kiosk: /usr/lib/badminton-tv/stream).
//
// Klubben indtaster en stream-nøgle pr. bane (court_streams), og adgangslinket
// til TV-PC'en med kameraet får "kameraet filmer bane N" (device_tokens.
// camera_court). PC'en spørger hvert par sekunder med sit adgangslink, og
// serveren afgør, om der skal sendes — så reglen ligger ét sted:
//
//   - holdkampe sendes af sig selv og uden afbrydelser (Jespers valg
//     2026-10-29): fra første delkamp sættes på banen, også mellem
//     delkampene, til 2 minutter efter holdkampens sidste delkamp er afgjort
//     — også når den sidste spilles på en anden bane
//   - en afgjort kamp sendes 2 minutter mere — også hvis banen ryddes inden
//     (sidste afsluttede kamp)
//   - andre kampe kun, når nogen har trykket "Start livestream" på tabletten:
//     kampen på banen, eller den næste, hvis den starter inden 5 minutter —
//     og kun den ene kamp (Jespers valg 2026-10-29)
//   - "Send hele dagen" i admin: alt på banen, også mellem kampene, til
//     PC'en slukker om aftenen (en turnering med mange kampe i træk)
//   - badmintonplanner-kampe sendes aldrig (Jespers valg 2026-10-28)
//   - en kamp, ingen har rørt i 30 minutter, er glemt på banen — ingen stream
//
// Ren logik (validering, beslutning, overlay, PC'ernes status) — ruterne ligger
// i routes/livestream.js.

const STANDARD_URL = 'rtmps://a.rtmps.youtube.com:443/live2';
const EFTER_MS = 2 * 60 * 1000;
const STILLE_MS = 30 * 60 * 1000;
const KLAR_MS = 5 * 60 * 1000;           // "Start livestream" venter så længe på en kamp
const VALGT_MAX_MS = 4 * 60 * 60 * 1000; // en valgt kamp glemmes senest efter 4 timer
const SIDSTE_MS = 5 * 60 * 1000;         // hele dagen: den sidste kamp i billedet så længe (som TV'et)
const HOLDKAMP_PAUSE_MS = 45 * 60 * 1000; // holdkamp uden delkamp i gang så længe: forladt
const NAVN_MAX = 26;

const tekst = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

function tid(v) {
    if (v == null) return null;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
}

// ---------- Opsætning (admin) ----------

// rtmp:// eller rtmps:// med en vært — YouTube, Facebook og andre RTMP-tjenester
function gyldigUrl(url) {
    if (typeof url !== 'string' || url.length > 255 || /\s/.test(url)) return false;
    try {
        const u = new URL(url);
        return (u.protocol === 'rtmp:' || u.protocol === 'rtmps:') && !!u.hostname && !u.username && !u.password;
    } catch {
        return false;
    }
}

// Nøglen sættes efter adressen (…/live2/<nøgle>). Facebooks nøgler har
// ?s_bl=…&a=… med, så synlige ASCII-tegn er tilladt — men ingen skråstreg
function gyldigNoegle(n) {
    return typeof n === 'string' && /^[\x21-\x2e\x30-\x7e]{4,300}$/.test(n);
}

// Admins PUT /api/livestream/baner/:bane. Returnerer { fejl } eller felterne
// der skal gemmes. stream_key: undefined = uændret, null = fjern.
function rensOpsaetning(body) {
    if (!body || typeof body !== 'object') return { fejl: 'Ugyldige data' };
    const ud = {
        enabled: !!body.enabled,
        overlay: body.overlay === undefined ? true : !!body.overlay,
        stream_url: body.streamUrl ? tekst(body.streamUrl, 255) : STANDARD_URL
    };
    if (!gyldigUrl(ud.stream_url)) return { fejl: 'Stream-adressen skal starte med rtmp:// eller rtmps://' };
    if (body.fjernNoegle) {
        ud.stream_key = null;
    } else if (body.streamKey !== undefined && body.streamKey !== '') {
        const n = String(body.streamKey).trim();
        if (!gyldigNoegle(n)) return { fejl: 'Stream-nøglen ser forkert ud — kopiér den igen fra YouTube Studio' };
        ud.stream_key = n;
    }
    return ud;
}

// Til admin: kun slutningen af nøglen, så den kan genkendes
function noegleSlut(n) {
    return n ? '…' + String(n).slice(-4) : null;
}

// ---------- Skal banen sendes nu? ----------

function rigtigeNavne(gs) {
    return (gs.player1_name && gs.player1_name !== 'Spiller 1') ||
        (gs.player2_name && gs.player2_name !== 'Spiller 2');
}

function aktivitet(gs) {
    return gs.player1_score > 0 || gs.player2_score > 0 || gs.player1_games > 0 ||
        gs.player2_games > 0 || gs.match_start_time != null;
}

// Banens kamp lige nu: 'kamp' (i gang eller sat på), 'afgjort' (med slut og
// om det er den ryddede, sidste kamp), 'stille' eller 'ingen-kamp'
function kampNu(gs, sidste, nu) {
    if (gs) {
        if (gs.match_completed || gs.match_end_time) {
            return { tilstand: 'afgjort', slut: tid(gs.match_end_time) ?? tid(gs.updated_at) };
        }
        if (!rigtigeNavne(gs) && !aktivitet(gs)) return { tilstand: 'ingen-kamp' };
        const sidstRoert = tid(gs.updated_at);
        if (sidstRoert !== null && nu - sidstRoert > STILLE_MS) return { tilstand: 'stille' };
        return { tilstand: 'kamp' };
    }
    const slut = sidste ? tid(sidste.match_end_time) : null;
    return slut !== null ? { tilstand: 'afgjort', slut, ryddet: true } : { tilstand: 'ingen-kamp' };
}

// Hvad der er startet med en knap: 'hele-dagen' (admin), 'valgt' (kampen på
// banen, fra tabletten) eller 'klar' (tabletten venter på næste kamp) — eller null
function startet(o, nu = Date.now()) {
    if (!o) return null;
    const dag = tid(o.all_day_until);
    if (dag !== null && dag > nu) return { start: 'hele-dagen', til: dag };
    const valgt = tid(o.manual_since);
    if (valgt !== null && nu - valgt < VALGT_MAX_MS) return { start: 'valgt' };
    const klar = tid(o.armed_until);
    if (klar !== null && klar > nu) return { start: 'klar', til: klar };
    return null;
}

// Holdkampen, banen er med i (routes: holdkampPaaBane): { mangler, igang,
// slut, start } — delkampe der ikke er færdige, delkampe i gang, og hvornår
// den seneste sluttede og startede. koerer: der er delkampe tilbage, og
// holdkampen er ikke forladt; slut: alle delkampe er færdige, den sidste da
function holdkampNu(h, nu = Date.now()) {
    if (!h) return { koerer: false, slut: null };
    if (Number(h.mangler) > 0) {
        const sidst = Math.max(tid(h.slut) ?? 0, tid(h.start) ?? 0);
        return { koerer: Number(h.igang) > 0 || nu - sidst < HOLDKAMP_PAUSE_MS, slut: null };
    }
    return { koerer: false, slut: tid(h.slut) };
}

// opsaetning: court_streams-rækken; gs: banens game_states-række; sidste:
// last_finished_matches (banen er ryddet); planner: banen har en
// badmintonplanner-tildeling; holdkamp: holdkampen, banen er med i
// (se holdkampNu); senderNu: PC'en sender allerede. De 2 minutter efter en afgjort
// kamp er kun en forlængelse — en stream startes aldrig på en afgjort kamp
// (fx en badmintonplanner-kamp, hvis tildeling forsvinder, når banen ryddes).
// Returnerer { send, grund, kilde } — kilde: hvis kamp der står i billedet
// ('gs', 'sidste' eller null). vaelg: tablettens "klar" bliver til kampen på
// banen; glem: den valgte kamp er forbi, så den næste ikke sendes.
function beslutning({ opsaetning, gs, sidste, planner, holdkamp = null, senderNu = false, nu = Date.now() }) {
    if (!opsaetning || !opsaetning.enabled) return { send: false, grund: 'slaaet-fra' };
    if (!opsaetning.stream_key) return { send: false, grund: 'mangler-noegle' };
    if (planner) return { send: false, grund: 'badmintonplanner' };
    const k = kampNu(gs, sidste, nu);
    const s = startet(opsaetning, nu);
    const hk = holdkampNu(holdkamp, nu);
    const glem = s && s.start === 'valgt' && k.tilstand !== 'kamp' ? { glem: true } : {};
    // Sendes hele banen (også mellem kampene): kampen på banen i billedet,
    // ellers den ryddede i 5 minutter, ellers et tomt scoreboard
    const kilde = k.tilstand === 'kamp' || (k.tilstand === 'afgjort' && !k.ryddet) ? 'gs'
        : k.tilstand === 'afgjort' && nu - k.slut < SIDSTE_MS ? 'sidste' : null;

    if (s && s.start === 'hele-dagen') return { send: true, grund: 'hele-dagen', kilde, ...glem };
    if (hk.koerer) return { send: true, grund: 'holdkamp', kilde, ...glem };
    if (k.tilstand === 'kamp') {
        if (s && s.start === 'valgt') return { send: true, grund: 'valgt', kilde: 'gs' };
        if (s && s.start === 'klar') return { send: true, grund: 'valgt', kilde: 'gs', vaelg: true };
        return { send: false, grund: 'ikke-startet' };
    }
    // Holdkampens sidste delkamp er afgjort — måske på en anden bane
    if (hk.slut !== null && senderNu && nu - hk.slut < EFTER_MS) return { send: true, grund: 'afgjort', kilde, ...glem };
    if (k.tilstand === 'afgjort') {
        return senderNu && k.slut !== null && nu - k.slut < EFTER_MS
            ? { send: true, grund: 'afgjort', kilde: k.ryddet ? 'sidste' : 'gs', ...glem }
            : { send: false, grund: k.ryddet ? 'ingen-kamp' : 'afsluttet', ...glem };
    }
    return { send: false, grund: k.tilstand, ...glem };
}

// Til tabletten: kan banen sendes, og hvad er startet? kamera: et adgangslink
// har kameraet på banen; pc: dets status (statusFor)
function tabletStatus({ opsaetning, kamera, pc, holdkamp = null, planner = false, nu = Date.now() }) {
    const kan = !!(opsaetning && opsaetning.enabled && opsaetning.stream_key && kamera);
    const s = kan ? startet(opsaetning, nu) : null;
    return {
        kan,
        start: s ? s.start : null,
        til: s && s.til ? new Date(s.til).toISOString() : null,
        holdkamp: holdkampNu(holdkamp, nu).koerer,
        planner: !!planner,
        sender: !!(pc && pc.online && pc.sender)
    };
}

// Slutningen af dagen i dansk tid (kl. 23:59, når TV-PC'en slukker) som ms
function dagensSlut(nu = Date.now(), tz = 'Europe/Copenhagen') {
    const dele = (t) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(t).map(p => [p.type, p.value]));
    const d = dele(nu);
    const slut = Date.UTC(+d.year, +d.month - 1, +d.day, 23, 59);
    // slut er 23:59 UTC — træk tidszonens forskydning på det tidspunkt fra
    const x = dele(slut);
    return slut - (Date.UTC(+x.year, +x.month - 1, +x.day, +x.hour, +x.minute) - slut);
}

// ---------- Overlay i billedet ----------

function parseSaet(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw) || []; } catch { return []; }
}

function sideNavn(navn, makker, standardMakker, double) {
    const a = tekst(navn, 60);
    const b = tekst(makker, 60);
    const fuld = double && b && b !== standardMakker ? `${a} / ${b}` : a;
    return fuld.length > NAVN_MAX ? fuld.slice(0, NAVN_MAX - 1) + '…' : fuld;
}

// Scoreboardet i billedet (PC'en tegner det): én række pr. side med navn,
// afsluttede sæt, stillingen i det igangværende sæt og hvem der server.
// Rækkerne står som i 1. sæt — spillerne hopper ikke, når de bytter side
// (som oversigten). Tallene er orienteret til rækkerne.
// rk: game_states- eller last_finished_matches-række; double: banen er double.
function overlayTavle(rk, double, bane = null) {
    if (!rk) return null;
    const navne = [sideNavn(rk.player1_name, rk.player1_name2, 'Makker 1', double),
        sideNavn(rk.player2_name, rk.player2_name2, 'Makker 2', double)];
    const historik = parseSaet(rk.set_scores_history);
    const saet = [];
    for (const s of historik) {
        const score = typeof s === 'string' ? s : s && s.score;
        const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(score || ''));
        if (!m) continue;
        // Sæt-historikken gemmer player1 først — men siderne kan være byttet siden
        const byttet = s && typeof s === 'object' && s.player1Name &&
            s.player1Name === rk.player2_name && s.player1Name !== rk.player1_name;
        saet.push(byttet ? [+m[2], +m[1]] : [+m[1], +m[2]]);
    }
    const iGang = rk.player1_score !== undefined && !rk.match_completed && !rk.match_end_time;
    const nu = iGang ? [Number(rk.player1_score) || 0, Number(rk.player2_score) || 0] : null;
    const s = double ? rk.serving_team : rk.serving_player;
    const serve = iGang && (s === 1 || s === 2) ? s : null;
    const t = { bane, navne, saet, nu, serve };
    // Stod siderne omvendt i 1. sæt? Så vendes det hele tilbage
    const f = historik[0] && typeof historik[0] === 'object' ? historik[0] : null;
    if (f && f.player1Name && f.player1Name === rk.player2_name && f.player2Name === rk.player1_name) {
        const vend = (par) => [par[1], par[0]];
        t.navne = vend(navne);
        t.saet = saet.map(vend);
        t.nu = nu && vend(nu);
        t.serve = serve && 3 - serve;
    }
    return t;
}

// Den gamle tekstudgave (Badminton TV 2026.10.28 tegner ikke scoreboardet):
// to linjer i en fast-bredde skrift, så tallene står under hinanden.
//   Hansen / Berg     21 11
//   Jensen / Olsen    15  8
function overlayLinjer(rk, double) {
    const t = overlayTavle(rk, double);
    if (!t) return [];
    const kol = t.nu ? [...t.saet, t.nu] : t.saet;
    const bredde = Math.max(t.navne[0].length, t.navne[1].length);
    const linje = (i) => t.navne[i].padEnd(bredde) + kol.map(k => ' ' + String(k[i]).padStart(2)).join('');
    return [linje(0), linje(1)];
}

// ---------- PC'ernes status (til admin) ----------

const status = new Map();   // tenant -> Map(tokenId -> status)
const TABT_MS = 60 * 1000;  // ingen forespørgsel i et minut: PC'en er væk

// Det PC'en fortæller i sin forespørgsel
function rensStatus(body) {
    const b = body && typeof body === 'object' ? body : {};
    const navn = tekst(b.navn, 60);
    return {
        navn: /^[a-z0-9][a-z0-9-]{0,59}$/i.test(navn) ? navn : '',
        kioskVersion: tekst(b.kioskVersion, 30),
        kamera: b.kamera ? tekst(b.kamera, 100) : null,
        sender: !!b.sender,
        koder: ['vaapi', 'x264'].includes(b.koder) ? b.koder : null,
        fejl: b.fejl ? tekst(b.fejl, 300) : null
    };
}

function registrer(tenant, tokenId, data, ip, nu = Date.now()) {
    if (!status.has(tenant)) status.set(tenant, new Map());
    const klub = status.get(tenant);
    const foer = klub.get(tokenId);
    const ny = { ...data, ip: ip || null, sidst: nu,
        senderSiden: data.sender ? (foer && foer.sender ? foer.senderSiden : nu) : null };
    klub.set(tokenId, ny);
    return { foer, ny };
}

function statusFor(tenant, nu = Date.now()) {
    const ud = {};
    for (const [tokenId, s] of status.get(tenant) || []) {
        ud[tokenId] = { ...s, online: nu - s.sidst < TABT_MS };
    }
    return ud;
}

// Sender en TV-PC banen lige nu? Til TV'ets LIVE-mærke — kun det, PC'en selv
// har meldt (ikke bare at banen er sat op til det), og uden databaseopslag
function senderBane(tenant, bane, nu = Date.now()) {
    for (const s of (status.get(tenant) || new Map()).values()) {
        if (s.bane === bane && s.sender && nu - s.sidst < TABT_MS) return true;
    }
    return false;
}

module.exports = {
    STANDARD_URL, EFTER_MS, STILLE_MS, KLAR_MS,
    gyldigUrl, gyldigNoegle, rensOpsaetning, noegleSlut,
    beslutning, startet, holdkampNu, tabletStatus, dagensSlut, overlayTavle, overlayLinjer,
    rensStatus, registrer, statusFor, senderBane
};
