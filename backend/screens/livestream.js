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
//   - en afgjort kamp sendes 2 minutter mere (admin: 0–10) — også hvis banen ryddes inden
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

const LogoMatch = require('../config/logoMatch');
const NameDisplay = require('../config/nameDisplay');

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
    // Kameraet på banen (migration 035) — undefined = uændret
    for (const [felt, kolonne] of [['vend', 'flip_180'], ['spejl', 'mirror'], ['autofokus', 'autofocus'], ['lyd', 'sound']]) {
        if (body[felt] !== undefined) ud[kolonne] = !!body[felt];
    }
    if (body.logo !== undefined) {
        if (!LOGOER.includes(body.logo)) return { fejl: 'Ugyldigt logo' };
        ud.logo = body.logo;
    }
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

// ---------- Indstillinger for streamen (admin → Livestream) ----------
//
// Fælles for klubben: settings 'livestream' (JSON). Pr. bane: court_streams
// (vend, spejl, autofokus, lyd, logo). PC'en får det hele i svaret og falder
// selv tilbage til det bedste, kameraet kan (fx 30 billeder i sekundet, når
// kameraet ikke kan 60) — og melder, hvad den faktisk sender (format).

const OPLOESNINGER = { 480: [854, 480], 720: [1280, 720], 1080: [1920, 1080] };
const BILLEDER = [25, 30, 50, 60];
const KVALITETER = ['lav', 'normal', 'hoej'];
const PLACERINGER = ['top-venstre', 'top-hoejre', 'bund-venstre', 'bund-hoejre'];
const STOERRELSER = ['lille', 'normal', 'stor'];
const LOGOER = ['ingen', 'sponsor', 'klub'];
const EFTER_MAX_MIN = 10;
// YouTube-udsendelserne (kun når kanalen er forbundet): synlighed og "lavet til
// børn" — Jespers standard er offentlig og lavet til børn (chat og kommentarer fra)
const SYNLIGHEDER = ['public', 'unlisted', 'private'];
const STANDARD_INDSTILLINGER = Object.freeze({
    oploesning: 720, billeder: 30, kvalitet: 'normal', placering: 'top-venstre',
    stoerrelse: 'normal', efterMin: 2, logo: null, ytSynlighed: 'public', ytBoern: true
});

// Klubbens logo: et filnavn i klubbens upload-mappe (routes: livestream-logo-….png)
const gyldigLogoFil = (v) => typeof v === 'string' && /^livestream-logo-[a-f0-9]{16,32}\.png$/.test(v);

// settings-værdien (JSON-tekst eller null) → indstillingerne; ukendte eller
// ugyldige felter bliver standard, så en ødelagt værdi aldrig stopper streamen
function laesIndstillinger(vaerdi) {
    let r = {};
    try { r = typeof vaerdi === 'string' ? JSON.parse(vaerdi) || {} : vaerdi || {}; } catch { r = {}; }
    const ud = { ...STANDARD_INDSTILLINGER };
    if (OPLOESNINGER[r.oploesning]) ud.oploesning = Number(r.oploesning);
    if (BILLEDER.includes(Number(r.billeder))) ud.billeder = Number(r.billeder);
    if (KVALITETER.includes(r.kvalitet)) ud.kvalitet = r.kvalitet;
    if (PLACERINGER.includes(r.placering)) ud.placering = r.placering;
    if (STOERRELSER.includes(r.stoerrelse)) ud.stoerrelse = r.stoerrelse;
    if (Number.isInteger(r.efterMin) && r.efterMin >= 0 && r.efterMin <= EFTER_MAX_MIN) ud.efterMin = r.efterMin;
    if (gyldigLogoFil(r.logo)) ud.logo = r.logo;
    if (SYNLIGHEDER.includes(r.ytSynlighed)) ud.ytSynlighed = r.ytSynlighed;
    if (typeof r.ytBoern === 'boolean') ud.ytBoern = r.ytBoern;
    return ud;
}

// Admins PUT /api/livestream/indstillinger: { fejl } eller de nye indstillinger
// (logoet ændres kun med upload/slet og bevares fra foer)
function rensIndstillinger(body, foer = STANDARD_INDSTILLINGER) {
    if (!body || typeof body !== 'object') return { fejl: 'Ugyldige data' };
    const ud = { ...laesIndstillinger(foer) };
    const efter = Number(body.efterMin);
    if (body.oploesning !== undefined) {
        if (!OPLOESNINGER[body.oploesning]) return { fejl: 'Ugyldig opløsning' };
        ud.oploesning = Number(body.oploesning);
    }
    if (body.billeder !== undefined) {
        if (!BILLEDER.includes(Number(body.billeder))) return { fejl: 'Ugyldigt antal billeder i sekundet' };
        ud.billeder = Number(body.billeder);
    }
    if (body.kvalitet !== undefined) {
        if (!KVALITETER.includes(body.kvalitet)) return { fejl: 'Ugyldig kvalitet' };
        ud.kvalitet = body.kvalitet;
    }
    if (body.placering !== undefined) {
        if (!PLACERINGER.includes(body.placering)) return { fejl: 'Ugyldig placering' };
        ud.placering = body.placering;
    }
    if (body.stoerrelse !== undefined) {
        if (!STOERRELSER.includes(body.stoerrelse)) return { fejl: 'Ugyldig størrelse' };
        ud.stoerrelse = body.stoerrelse;
    }
    if (body.efterMin !== undefined) {
        if (!Number.isInteger(efter) || efter < 0 || efter > EFTER_MAX_MIN) {
            return { fejl: `Minutter efter kampen skal være 0–${EFTER_MAX_MIN}` };
        }
        ud.efterMin = efter;
    }
    if (body.ytSynlighed !== undefined) {
        if (!SYNLIGHEDER.includes(body.ytSynlighed)) return { fejl: 'Ugyldig synlighed' };
        ud.ytSynlighed = body.ytSynlighed;
    }
    if (body.ytBoern !== undefined) {
        if (typeof body.ytBoern !== 'boolean') return { fejl: 'Ugyldigt valg for "lavet til børn"' };
        ud.ytBoern = body.ytBoern;
    }
    return ud;
}

// Til PC'en, når der skal sendes: hvad den skal sende, og hvordan kameraet sidder
function videoTilPc(indst, o) {
    const [bredde, hoejde] = OPLOESNINGER[indst.oploesning] || OPLOESNINGER[720];
    return {
        bredde, hoejde,
        billeder: indst.billeder,
        kvalitet: indst.kvalitet,
        placering: indst.placering,
        stoerrelse: indst.stoerrelse,
        vend: !!(o && o.flip_180),
        spejl: !!(o && o.mirror),
        autofokus: !!(o && o.autofocus),
        lyd: !!(o && o.sound)
    };
}

// Banens sponsor-banner i streamen: bannerne roterer som på TV'et (varighed i
// sekunder), så PC'en får det, der står nu. bannere: { filename } i visningsrækkefølge
function sponsorNu(bannere, varighed, nu = Date.now()) {
    if (!Array.isArray(bannere) || !bannere.length) return null;
    const ms = Math.max(5, Number(varighed) || 20) * 1000;
    return bannere[Math.floor(nu / ms) % bannere.length].filename || null;
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
// (se holdkampNu); senderNu: PC'en sender allerede; efterMs: så længe sendes der
// efter kampen (admin, standard 2 minutter). Tiden efter en afgjort
// kamp er kun en forlængelse — en stream startes aldrig på en afgjort kamp
// (fx en badmintonplanner-kamp, hvis tildeling forsvinder, når banen ryddes).
// youtube: klubbens YouTube-kanal er forbundet (nøglen kommer derfra).
// Returnerer { send, grund, kilde } — kilde: hvis kamp der står i billedet
// ('gs', 'sidste' eller null). vaelg: tablettens "klar" bliver til kampen på
// banen; glem: den valgte kamp er forbi, så den næste ikke sendes.
function beslutning({ opsaetning, gs, sidste, planner, holdkamp = null, senderNu = false,
    efterMs = EFTER_MS, youtube = false, nu = Date.now() }) {
    if (!opsaetning || !opsaetning.enabled) return { send: false, grund: 'slaaet-fra' };
    if (!opsaetning.stream_key && !youtube) return { send: false, grund: 'mangler-noegle' };
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
    if (hk.slut !== null && senderNu && nu - hk.slut < efterMs) return { send: true, grund: 'afgjort', kilde, ...glem };
    if (k.tilstand === 'afgjort') {
        return senderNu && k.slut !== null && nu - k.slut < efterMs
            ? { send: true, grund: 'afgjort', kilde: k.ryddet ? 'sidste' : 'gs', ...glem }
            : { send: false, grund: k.ryddet ? 'ingen-kamp' : 'afsluttet', ...glem };
    }
    return { send: false, grund: k.tilstand, ...glem };
}

// Til tabletten: kan banen sendes, og hvad er startet? kamera: et adgangslink
// har kameraet på banen; pc: dets status (statusFor). kameraKlar: PC'en er
// tændt og finder et USB-kamera — ellers skjuler tabletten knappen.
// efterMin: hvor længe der sendes efter kampen (indstillingerne)
function tabletStatus({ opsaetning, kamera, pc, holdkamp = null, planner = false, youtube = false,
    efterMin = EFTER_MS / 60000, nu = Date.now() }) {
    const kan = !!(opsaetning && opsaetning.enabled && (opsaetning.stream_key || youtube) && kamera);
    const s = kan ? startet(opsaetning, nu) : null;
    return {
        kan,
        start: s ? s.start : null,
        til: s && s.til ? new Date(s.til).toISOString() : null,
        holdkamp: holdkampNu(holdkamp, nu).koerer,
        planner: !!planner,
        sender: !!(pc && pc.online && pc.sender),
        kameraKlar: !!(pc && pc.online && pc.kamera),
        efterMin
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

// Navnet pr. side. Double: fornavne med forbogstav ved sammenfald — som TV'et
// og oversigten (name-display.js) — så begge makkere kan stå der. Single: hele navnet.
function sideNavne(rk, double) {
    const makker = (n, std) => { const b = tekst(n, 60); return double && b && b !== std ? b : ''; };
    const fulde = [tekst(rk.player1_name, 60), makker(rk.player1_name2, 'Makker 1'),
        tekst(rk.player2_name, 60), makker(rk.player2_name2, 'Makker 2')];
    const vis = double ? NameDisplay.visningsnavne(fulde) : fulde;
    const side = (a, b) => {
        const fuld = b ? `${a} / ${b}` : a;
        return fuld.length > NAVN_MAX ? fuld.slice(0, NAVN_MAX - 1) + '…' : fuld;
    };
    return [side(vis[0], vis[1]), side(vis[2], vis[3])];
}

// Scoreboardet i billedet (PC'en tegner det): én række pr. side med navn,
// afsluttede sæt, stillingen i det igangværende sæt og hvem der server.
// Rækkerne står som i 1. sæt — spillerne hopper ikke, når de bytter side
// (som oversigten). Tallene er orienteret til rækkerne.
// rk: game_states- eller last_finished_matches-række; double: banen er double;
// logoer: [player1-sidens, player2-sidens] klublogo (spillerLogoer) eller null.
function overlayTavle(rk, double, bane = null, logoer = null) {
    if (!rk) return null;
    const navne = sideNavne(rk, double);
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
    if (logoer) t.logoer = logoer;
    // Stod siderne omvendt i 1. sæt? Så vendes det hele tilbage
    const f = historik[0] && typeof historik[0] === 'object' ? historik[0] : null;
    if (f && f.player1Name && f.player1Name === rk.player2_name && f.player2Name === rk.player1_name) {
        const vend = (par) => [par[1], par[0]];
        t.navne = vend(navne);
        t.saet = saet.map(vend);
        t.nu = nu && vend(nu);
        t.serve = serve && 3 - serve;
        if (logoer) t.logoer = vend(logoer);
    }
    return t;
}

// Hvilket hold (1/2) i holdkampens delkamp spiller en side med disse navne for?
function holdFor(navne, game) {
    const n = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const hold1 = [game.team1_player1, game.team1_player2].map(n).filter(Boolean);
    const hold2 = [game.team2_player1, game.team2_player2].map(n).filter(Boolean);
    for (const navn of navne.map(n).filter(Boolean)) {
        if (hold1.includes(navn)) return 1;
        if (hold2.includes(navn)) return 2;
    }
    return null;
}

// Klublogoerne ud for navnene i streamen — samme regler som TV'et
// (tv-script-v3.js, updateTvTeamLogos): i en holdkamp holdenes logoer, ellers
// spillernes (player_logos vinder, ellers spillerens klub). I double tages
// makkerens, hvis spilleren ingen har. Returnerer [player1-sidens,
// player2-sidens] adresse (null: intet logo), eller null uden nogen logoer.
// holdkamp: team_matches-rækken med .game (delkampen på banen); logos: de
// centrale logoer med url; clubByName: normaliseret spillernavn → klub.
function spillerLogoer(rk, double, { holdkamp = null, logos = [], playerLogos = [], clubByName = {} } = {}) {
    if (!rk || !logos.length) return null;
    const sider = [1, 2].map(i => [rk[`player${i}_name`], double ? rk[`player${i}_name2`] : null]);
    const url = (l) => (l && l.url) || null;
    let ud;
    const hold = holdkamp && holdkamp.game ? sider.map(navne => holdFor(navne, holdkamp.game)) : [null, null];
    // Kun når mindst én side spiller i holdkampen — ellers er det en anden kamp
    // på banen (holdkampen havde banen tidligere), og spillernes logoer gælder
    if (hold[0] || hold[1]) {
        if (!hold[1]) hold[1] = 3 - hold[0];
        if (!hold[0]) hold[0] = 3 - hold[1];
        ud = hold.map(n => url(LogoMatch.resolveTeamLogo(holdkamp, n, logos)));
    } else {
        const o = { playerLogos, clubByName, logos };
        ud = sider.map(([a, b]) => url(LogoMatch.resolvePlayerLogo(a, o) || (b ? LogoMatch.resolvePlayerLogo(b, o) : null)));
    }
    return ud.some(Boolean) ? ud : null;
}

// Klubbens eget logo i logo-databasen (klubnavnet fra master-databasen), eller null
function klubLogoFraDatabase(klubnavn, logos) {
    const l = klubnavn ? LogoMatch.matchLogo(klubnavn, logos) : null;
    return l ? { url: l.url, navn: l.club_name } : null;
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
        // Det, PC'en faktisk sender (kameraet kan måske ikke det valgte): 1280x720@30
        format: typeof b.format === 'string' && /^\d{3,4}x\d{3,4}@\d{1,3}$/.test(b.format) ? b.format : null,
        // Kameraets mikrofon, når lyden er slået til (null: ingen fundet eller lyd fra)
        mikrofon: b.mikrofon ? tekst(b.mikrofon, 100) : null,
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

// ---------- YouTube-udsendelserne (kanalen forbundet med API'et) ----------
//
// Én udsendelse pr. "send-periode": fra beslutning() siger send, til den ikke
// gør længere — en hel holdkamp, en dag ("Send hele dagen") eller én kamp
// startet på tabletten. Routes (routes/livestream.js) gør det, ytHandling siger.

const YT_TJEK_MS = 5 * 60 * 1000;        // udsendelsen tjekkes så tit, mens der sendes (afsluttet i Studio?)
const YT_FEJL_PAUSE_MS = 2 * 60 * 1000;  // efter en fejl hos YouTube prøves der igen efter så længe

// send: beslutningen; udsendelse: banens yt_broadcast_id; tjek: sidste tjek;
// fejlTid: sidste fejl. → 'opret', 'tjek', 'afslut' eller null
function ytHandling({ send, udsendelse, tjek = null, fejlTid = null, nu = Date.now() }) {
    const pause = tid(fejlTid) !== null && nu - tid(fejlTid) < YT_FEJL_PAUSE_MS;
    if (!send) return udsendelse && !pause ? 'afslut' : null;
    if (!udsendelse) return pause ? null : 'opret';
    return tid(tjek) === null || nu - tid(tjek) >= YT_TJEK_MS ? 'tjek' : null;
}

const datoTekst = (nu = Date.now()) => new Intl.DateTimeFormat('da-DK',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Copenhagen' }).format(nu);

// Udsendelsens titel (højst 100 tegn, uden < og >, som YouTube kræver):
// holdkampens hold, ellers navnene i scoreboardet, ellers klubben og banen
function ytTitel({ grund, bane, hold = null, navne = null, klubnavn = null, nu = Date.now() }) {
    const ren = (s) => tekst(s, 100).replace(/[<>]/g, '');
    const hvor = `bane ${bane}, ${datoTekst(nu)}`;
    let titel;
    if (grund === 'holdkamp' && hold && hold[0] && hold[1]) titel = `${ren(hold[0])} – ${ren(hold[1])} (${hvor})`;
    else if (grund !== 'hele-dagen' && navne && navne[0] && navne[1]) titel = `${ren(navne[0])} – ${ren(navne[1])} (${hvor})`;
    else titel = `${klubnavn ? `${ren(klubnavn)} – ` : ''}Bane ${bane} (${datoTekst(nu)})`;
    return titel.length > 100 ? titel.slice(0, 99) + '…' : titel;
}

function ytBeskrivelse(klubnavn = null) {
    return `${klubnavn ? `${tekst(klubnavn, 100).replace(/[<>]/g, '')}. ` : ''}` +
        'Sendt automatisk fra banen med Badmintonapp — https://badmintonapp.dk';
}

module.exports = {
    STANDARD_URL, EFTER_MS, STILLE_MS, KLAR_MS, YT_TJEK_MS, YT_FEJL_PAUSE_MS,
    ytHandling, ytTitel, ytBeskrivelse,
    gyldigUrl, gyldigNoegle, rensOpsaetning, noegleSlut,
    STANDARD_INDSTILLINGER, laesIndstillinger, rensIndstillinger, videoTilPc, sponsorNu, gyldigLogoFil,
    beslutning, startet, holdkampNu, tabletStatus, dagensSlut, overlayTavle, overlayLinjer,
    spillerLogoer, klubLogoFraDatabase,
    rensStatus, registrer, statusFor, senderBane
};
