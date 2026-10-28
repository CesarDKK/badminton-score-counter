// Livestream fra TV-PC'ens USB-kamera (kiosk: /usr/lib/badminton-tv/stream).
//
// Klubben indtaster en stream-nøgle pr. bane (court_streams), og adgangslinket
// til TV-PC'en med kameraet får "kameraet filmer bane N" (device_tokens.
// camera_court). PC'en spørger hvert par sekunder med sit adgangslink, og
// serveren afgør, om der skal sendes — så reglen ligger ét sted:
//
//   - der sendes, fra kampen er sat på banen (rigtige navne eller første
//     point), til 2 minutter efter den er afgjort — også hvis banen ryddes
//     inden (sidste afsluttede kamp)
//   - badmintonplanner-kampe sendes aldrig (Jespers valg 2026-10-28)
//   - en kamp, ingen har rørt i 30 minutter, er glemt på banen — ingen stream
//
// Ren logik (validering, beslutning, overlay, PC'ernes status) — ruterne ligger
// i routes/livestream.js.

const STANDARD_URL = 'rtmps://a.rtmps.youtube.com:443/live2';
const EFTER_MS = 2 * 60 * 1000;
const STILLE_MS = 30 * 60 * 1000;
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

// opsaetning: court_streams-rækken; gs: banens game_states-række; sidste:
// last_finished_matches (banen er ryddet); planner: banen har en
// badmintonplanner-tildeling; senderNu: PC'en sender allerede. De 2 minutter
// efter en afgjort kamp er kun en forlængelse — en stream startes aldrig på
// en afgjort kamp (fx en badmintonplanner-kamp, hvis tildeling forsvinder,
// når banen ryddes). Returnerer { send, grund, kilde }.
function beslutning({ opsaetning, gs, sidste, planner, senderNu = false, nu = Date.now() }) {
    if (!opsaetning || !opsaetning.enabled) return { send: false, grund: 'slaaet-fra' };
    if (!opsaetning.stream_key) return { send: false, grund: 'mangler-noegle' };
    if (planner) return { send: false, grund: 'badmintonplanner' };
    if (gs) {
        if (gs.match_completed || gs.match_end_time) {
            const slut = tid(gs.match_end_time) ?? tid(gs.updated_at);
            return senderNu && slut !== null && nu - slut < EFTER_MS
                ? { send: true, grund: 'afgjort', kilde: 'gs' }
                : { send: false, grund: 'afsluttet' };
        }
        if (!rigtigeNavne(gs) && !aktivitet(gs)) return { send: false, grund: 'ingen-kamp' };
        const sidstRoert = tid(gs.updated_at);
        if (sidstRoert !== null && nu - sidstRoert > STILLE_MS) return { send: false, grund: 'stille' };
        return { send: true, grund: 'kamp', kilde: 'gs' };
    }
    const slut = sidste ? tid(sidste.match_end_time) : null;
    if (senderNu && slut !== null && nu - slut < EFTER_MS) return { send: true, grund: 'afgjort', kilde: 'sidste' };
    return { send: false, grund: 'ingen-kamp' };
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

// To linjer, én pr. side: navn, så sættene, så stillingen i det igangværende
// sæt. Skrives med en fast-bredde skrift, så tallene står under hinanden.
//   Hansen / Berg     21 11
//   Jensen / Olsen    15  8
// rk: game_states- eller last_finished_matches-række; double: banen er double.
function overlayLinjer(rk, double) {
    if (!rk) return [];
    const n1 = sideNavn(rk.player1_name, rk.player1_name2, 'Makker 1', double);
    const n2 = sideNavn(rk.player2_name, rk.player2_name2, 'Makker 2', double);
    const kol = [];
    for (const s of parseSaet(rk.set_scores_history)) {
        const score = typeof s === 'string' ? s : s && s.score;
        const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(score || ''));
        if (!m) continue;
        // Sæt-historikken gemmer player1 først — men siderne kan være byttet siden
        const byttet = s && typeof s === 'object' && s.player1Name &&
            s.player1Name === rk.player2_name && s.player1Name !== rk.player1_name;
        kol.push(byttet ? [m[2], m[1]] : [m[1], m[2]]);
    }
    const iGang = rk.player1_score !== undefined && !rk.match_completed && !rk.match_end_time;
    if (iGang) kol.push([String(rk.player1_score || 0), String(rk.player2_score || 0)]);
    const bredde = Math.max(n1.length, n2.length);
    const linje = (navn, i) => navn.padEnd(bredde) + kol.map(k => ' ' + k[i].padStart(2)).join('');
    return [linje(n1, 0), linje(n2, 1)];
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

module.exports = {
    STANDARD_URL, EFTER_MS, STILLE_MS,
    gyldigUrl, gyldigNoegle, rensOpsaetning, noegleSlut,
    beslutning, overlayLinjer,
    rensStatus, registrer, statusFor
};
