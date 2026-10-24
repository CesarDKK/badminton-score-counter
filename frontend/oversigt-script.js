// Overview Page Script - Display all active matches
const api = window.BadmintonAPI;

let courtCount = 5;
let allCourtData = [];
let activeCourts = [];
let currentPage = 0;
const COURTS_PER_PAGE = 6;
const REFRESH_INTERVAL = 2000; // 2 seconds - fast updates with batch API
const SCROLL_INTERVAL = 10000; // 10 seconds between page changes
let scrollTimer = null;
let refreshTimer = null;
let localTimerInterval = null;
let liveUpdatesHandle = null; // SSE-forbindelse til live game-state opdateringer

// Store match start times for each court (courtId -> {matchStartTime, matchEndTime})
let courtMatchTimes = {};

// Recently finished matches — shown for 5 minutes after a match ends.
// courtId -> { snapshot, finishedAt, matchStartTime }
const finishedCourts = new Map();
const FINISHED_DISPLAY_MS = 5 * 60 * 1000;

// Snapshot af sidst kendte aktive tilstand pr. bane — bruges som fallback
// når en bane forsvinder fra API'et før oversigten når at se matchCompleted=true.
// courtId -> court data snapshot
const lastKnownActiveState = new Map();

// Local pause countdown state — avoids relying on 2s API interval for accuracy
// courtId -> { receivedAt: timestamp, secondsLeft: number }
let pauseCountdownState = {};

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    await initialize();
    startAutoRefresh();
    startAutoScroll();
    startLocalTimers();
    startSkaermStatus();
});

// ==================== SKÆRM-STATUS ====================
// Livstegn hvert 20. sekund til admin → Adgangslinks, som TV-siden sender, så
// en kiosk-PC med oversigten kan ses dér med navn og Badminton TV-version.
// Kun fra en kiosk-PC (startsiden sætter ?skaerm= og ?kioskversion=) — en
// oversigt åbnet i en almindelig browser melder sig ikke.
function startSkaermStatus() {
    const p = new URLSearchParams(location.search);
    const navn = (p.get('skaerm') || '').slice(0, 60);
    const kioskVersion = (p.get('kioskversion') || '').slice(0, 30);
    if (!navn && !kioskVersion) return;
    let klientId = 'ov-' + Math.random().toString(36).slice(2, 10);
    try {
        const gemt = localStorage.getItem('btOversigtId');
        if (gemt && /^ov-[a-z0-9]{6,12}$/.test(gemt)) klientId = gemt;
        else localStorage.setItem('btOversigtId', klientId);
    } catch { /* privat vindue — nyt id pr. indlæsning */ }
    const version = document.querySelector('script[src*="oversigt-script.js"]')?.src.split('v=')[1] || '';
    const send = () => api.sendScreenHeartbeat({ klientId, navn, side: 'oversigt', version, kioskVersion })
        .catch(() => { /* intet net — næste livstegn prøver igen */ });
    send();
    setInterval(send, 20000);
}

// ==================== HOLDKAMP ====================

let activeTeamMatches = []; // alle aktive holdkampe (multi-holdkamp)
let _overviewLogos = []; // central logo-liste, hentet én gang ved init
let _overviewPlayerLogos = []; // player_logos overrides
let _overviewClubByName = {};  // normaliseret spillernavn -> klub
// Bane-sponsorbannere vises ikke på Oversigten — de fyldte for meget på et
// kort der i forvejen skal rumme fire navne og en stilling. Sponsorerne kører
// i stedet som fuldskærms-slideshow når ingen kampe er i gang (se idleScreen),
// og som roterende banner i footeren på TV-visningen.

// Nulstil + genhent logo-listerne (efter et 'logos'-config-event / sikkerhedsnet)
async function refreshOverviewLogos() {
    try { _overviewLogos = await api.getPublicLogos() || []; } catch (e) { _overviewLogos = []; }
    try {
        _overviewPlayerLogos = await api.getPlayerLogos() || [];
        const clubs = await api.getPlayerClubs() || [];
        _overviewClubByName = {};
        clubs.forEach(c => { if (c && c.name) _overviewClubByName[LogoMatch.normalizeName(c.name)] = c.club; });
    } catch (e) {
        _overviewPlayerLogos = [];
        _overviewClubByName = {};
    }
}

let _hkRenderedKey = ''; // signatur af struktur (side + match-ids + game-ids + status)
const HK_DOUBLES = HoldkampFormater.DOUBLE_KATEGORIER; // inkl. GS = golden set
const HK_PAGE_SIZE = 1;       // én holdkamp pr. side (fylder hele skærmen)
const HK_ROTATE_MS = 15000;   // hver holdkamp vises 15 sek, så roteres der

// En færdigspillet holdkamp (alle delkampe afsluttet) vises i 10 min efter den
// sidste delkamp og skjules så — ellers optager den en fuld side i rotationen,
// indtil nogen husker at trykke "Afslut Holdkamp". Den forbliver "aktiv" i
// admin; backend'en lukker den selv efter 30 min (se autoAfslutHoldkampe).
// Bevidst højere end de 5 min for en enkelt bane (FINISHED_DISPLAY_MS).
const HK_FINISHED_DISPLAY_MS = 10 * 60 * 1000;

// Millisekunder siden holdkampens sidste delkamp blev afsluttet — eller null
// hvis den ikke er færdigspillet (ingen delkampe, en delkamp der ikke er
// 'finished', eller en uden finished_at). null = skal vises som hidtil.
function hkFaerdigSiden(tm, nu = Date.now()) {
    // 3–3 i 4 spillere / 4 piger: golden set mangler — holdkampen er ikke færdig
    if (HoldkampFormater.goldenSetStatus(tm).kraeves) return null;
    const games = tm.games || [];
    if (!games.length) return null;
    let sidst = 0;
    for (const g of games) {
        if (g.status !== 'finished' || !g.finished_at) return null;
        const t = new Date(g.finished_at).getTime();
        if (!Number.isFinite(t)) return null;
        if (t > sidst) sidst = t;
    }
    return nu - sidst;
}

function hkSkalVises(tm) {
    const siden = hkFaerdigSiden(tm);
    return siden === null || siden < HK_FINISHED_DISPLAY_MS;
}

// En delkamp, der lige er afgjort, bliver stående under "spilles nu" i 1 minut
// med slutresultatet og en løber rundt om kortet, der tømmes (som nedtællingen
// mellem holdkampe). Tiden går fra det øjeblik, oversigten så delkampen blive
// afgjort, på skærmens eget ur; ved en frisk indlæsning regnes fra finished_at.
// Varigheden skal matche hkLoeber i oversigt-styles.css.
const HK_RESULTAT_MS = 60 * 1000;
const hkSetIGang = new Set();       // delkampe set med status 'active'
const hkResultatStart = new Map();  // game-id → starttidspunkt (0 = vises ikke)

function hkNoterResultater(matches, nu = Date.now()) {
    for (const tm of matches) {
        for (const g of tm.games || []) {
            if (g.status === 'active') { hkSetIGang.add(g.id); continue; }
            if (g.status !== 'finished' || hkResultatStart.has(g.id)) continue;
            if (hkSetIGang.has(g.id)) { hkResultatStart.set(g.id, nu); continue; }
            const alder = nu - new Date(g.finished_at).getTime();
            hkResultatStart.set(g.id, alder >= 0 && alder < HK_RESULTAT_MS ? nu - alder : 0);
        }
    }
}

// Millisekunder tilbage af resultatvisningen (0 = vises ikke)
function hkResultatTilbage(g, nu = Date.now()) {
    if (g.status !== 'finished') return 0;
    const start = hkResultatStart.get(g.id);
    return start ? Math.max(0, HK_RESULTAT_MS - (nu - start)) : 0;
}

// Delkampens sæt set fra hjemmeholdet: [[hold1, hold2], ...]
function hkSaetFraHold1(g) {
    const side1Key = HK_DOUBLES.includes(g.category) && g.team1_player2
        ? `${g.team1_player1 || ''} / ${g.team1_player2}` : (g.team1_player1 || '');
    const saet = g.set_scores ? orientHistorySetScoreNumbers(g.set_scores, side1Key) : [];
    return saet.map(x => x.split('-').map(Number));
}
let hkPage = 0;
let hkRotateTimer = null;

function hkPageCount() {
    return Math.max(1, Math.ceil(activeTeamMatches.length / HK_PAGE_SIZE));
}

// "Holdkamp 1 af 2" står i holdkampvisningens undertitel (renderHoldkampCards) —
// den gamle faste sideindikator øverst til højre holdes skjult.
function updateHkPageIndicator() {
    const el = document.getElementById('hkPageIndicator');
    if (!el) return;
    el.style.display = 'none';
}

function visibleHkMatches() {
    if (hkPage >= hkPageCount()) hkPage = 0;
    const start = hkPage * HK_PAGE_SIZE;
    return activeTeamMatches.slice(start, start + HK_PAGE_SIZE);
}

function hkKey(matches) {
    return hkPage + '#' + matches.map(tm =>
        `${tm.id}:${(tm.games || []).map(g => g.id + g.status + (hkResultatTilbage(g) ? 'r' : '')).join(',')}`
    ).join('|');
}

// Nedtællings-løber i toppen: genstarter CSS-animationen så den tømmes på 15 sek.
function startHkRotationBar() {
    const bar = document.getElementById('hkRotationBar');
    if (!bar) return;
    const fill = bar.querySelector('.hk-rotation-fill');
    bar.style.display = 'block';
    bar.classList.remove('run');
    void fill.offsetWidth; // tving reflow så animationen starter forfra
    bar.classList.add('run');
}

function stopHkRotationBar() {
    const bar = document.getElementById('hkRotationBar');
    if (!bar) return;
    bar.classList.remove('run');
    bar.style.display = 'none';
}

// Roterer mellem holdkampe hvert 15. sek når der er mere end én.
function ensureHkRotation() {
    if (activeTeamMatches.length > HK_PAGE_SIZE) {
        if (!hkRotateTimer) {
            startHkRotationBar(); // nedtælling for den første side
            hkRotateTimer = setInterval(() => {
                hkPage = (hkPage + 1) % hkPageCount();
                const visible = visibleHkMatches();
                renderHoldkampCards(visible);
                _hkRenderedKey = hkKey(visible);
                updateHkPageIndicator();
                startHkRotationBar(); // nulstil nedtælling ved sideskift
            }, HK_ROTATE_MS);
        }
    } else {
        if (hkRotateTimer) { clearInterval(hkRotateTimer); hkRotateTimer = null; hkPage = 0; }
        stopHkRotationBar();
    }
}

async function loadHoldkamp() {
    try {
        const matches = await api.getActiveTeamMatches();
        hkNoterResultater(matches || []);
        // Skjul færdigspillede holdkampe efter HK_FINISHED_DISPLAY_MS
        activeTeamMatches = (matches || []).filter(hkSkalVises);
        const grid = document.getElementById('holdkampCardsGrid');
        const container = document.querySelector('.overview-container');

        if (!activeTeamMatches.length) {
            grid.style.display = 'none';
            grid.innerHTML = '';
            _hkRenderedKey = '';
            if (hkRotateTimer) { clearInterval(hkRotateTimer); hkRotateTimer = null; }
            hkPage = 0;
            updateHkPageIndicator();
            stopHkRotationBar();
            if (container) container.classList.remove('has-holdkamp');
            updateIdleState();
            return;
        }

        grid.style.display = 'flex';
        if (container) container.classList.add('has-holdkamp');

        ensureHkRotation();

        // Fuld re-render kun når synlig side/struktur ændrer sig (undgår flicker).
        // Live score-ændringer patches uden at genskabe DOM (bevarer scroll).
        const visible = visibleHkMatches();
        const key = hkKey(visible);
        if (key !== _hkRenderedKey) {
            renderHoldkampCards(visible);
            _hkRenderedKey = key;
        } else {
            patchHoldkampCards(visible);
        }
        updateHkPageIndicator();
        updateIdleState();
    } catch (error) {
        console.error('Failed to load holdkamp:', error);
    }
}

// ==================== HOLDKAMP (G2: enkel holdkampvisning) ====================
// Tre ting, læst ovenfra og ned:
//  1) Holdstillingen med klublogoer — det største på skærmen.
//  2) Delkampene, der spilles nu — som små TV-kort med navne, sæt og point.
//     Feltet deler sig efter antal: 1–2 side om side, 3–4 i 2 × 2, 5–6 i 3 × 2,
//     flere i 5 kolonner (13 på én gang = 5 × 3).
//  3) Alle delkampe som en række nederst: kategori, vinderens farve og hvert
//     sæt set fra hjemmeholdet. Udelades, så længe alle delkampe er i gang.
// Strukturen tegnes kun igen, når hkKey ændrer sig; point, sæt, status og
// rækken nederst opdateres på stedet (patchHoldkampCards).

// Fornavn = første ord i navnet (bruges når kampen er i gang for at spare plads).
function firstName(full) {
    return (full || '').trim().split(/\s+/)[0] || '';
}

// Hvilken bane-spiller hører til team1 hhv. team2 (sider kan være byttet under spil).
function holdkampCourtSides(cd, g) {
    if (!cd) return null;
    const t1 = [g.team1_player1, g.team1_player2].filter(Boolean);
    const p1IsT1 = [cd.player1.name, cd.player1.name2].some(n => n && t1.includes(n));
    const p2IsT1 = [cd.player2.name, cd.player2.name2].some(n => n && t1.includes(n));
    if (p2IsT1 && !p1IsT1) return { team1: cd.player2, team2: cd.player1, byttet: true };
    return { team1: cd.player1, team2: cd.player2, byttet: false };
}

// Delkampene nummereret pr. kategori ("HS 1", "HS 2" …) i formatets rækkefølge
function hkNummererede(tm) {
    const counts = {};
    return (tm.games || []).map(g => {
        counts[g.category] = (counts[g.category] || 0) + 1;
        return { g, navn: HoldkampFormater.kategoriNavn(g.category, counts[g.category]) };
    });
}

// Kolonner × rækker og størrelse for "spilles nu"-feltet
function hkLiveLayout(n) {
    if (n <= 2) return { cols: Math.max(n, 1), rows: 1, s: 1.15 };
    if (n <= 4) return { cols: 2, rows: 2, s: 1 };
    if (n <= 6) return { cols: 3, rows: 2, s: 0.8 };
    return { cols: 5, rows: Math.ceil(n / 5), s: 0.66 };
}

// Navne på et "spilles nu"-kort: fornavne, forbogstav ved sammenfald (som på TV'et) — HTML
function hkHoldNavn(g, hold) {
    const dbl = HK_DOUBLES.includes(g.category);
    const fulde = [g.team1_player1, dbl ? g.team1_player2 : '', g.team2_player1, dbl ? g.team2_player2 : ''];
    const vis = window.NameDisplay ? NameDisplay.visningsnavne(fulde) : fulde.map(firstName);
    const [a, b] = hold === 1 ? [vis[0], vis[1]] : [vis[2], vis[3]];
    // Double: én spiller pr. linje, så navnene står helt — også i 5 × 3
    return (b ? [a || '?', b] : [a || '?']).map(n => `<span>${escapeHtml(n)}</span>`).join('');
}

function renderHoldkampCards(matches) {
    const grid = document.getElementById('holdkampCardsGrid');
    grid.innerHTML = matches.map(tm => {
        const logo1 = window.LogoMatch && LogoMatch.resolveTeamLogo(tm, 1, _overviewLogos);
        const logo2 = window.LogoMatch && LogoMatch.resolveTeamLogo(tm, 2, _overviewLogos);
        const logoImg = (logo, kls) => logo
            ? `<img class="${kls}" src="${escapeHtml(logo.url)}" alt="" onerror="this.style.display='none'">`
            : '';
        // I gang + lige afgjort (står 1 min med resultatet) — i formatets rækkefølge
        const live = hkNummererede(tm).filter(x => x.g.status === 'active' || hkResultatTilbage(x.g) > 0);
        const iGang = live.filter(x => x.g.status === 'active').length;
        const lay = hkLiveLayout(live.length);
        const sider = hkPageCount();

        const kort = live.map(({ g, navn }) => {
            const tilbage = hkResultatTilbage(g);
            if (tilbage) return hkResultatKort(g, navn, tilbage, logo1, logo2, logoImg);
            const raekke = (hold) => `
                <div class="hk-kamp-raekke" data-side="${hold}">
                    <span class="hk-streg hk-streg--${hold}"></span>
                    ${logoImg(hold === 1 ? logo1 : logo2, 'hk-kamp-logo')}
                    <span class="hk-kamp-navn">${hkHoldNavn(g, hold)}</span>
                    <span class="hk-kamp-saet" data-f="saet${hold}"></span>
                    <span class="hk-kamp-pts" data-f="pts${hold}">0</span>
                </div>`;
            return `<div class="hk-kamp" data-game-id="${g.id}">
                <div class="hk-kamp-hoved">
                    <span class="hk-kamp-kat">${escapeHtml(navn.toUpperCase())} <small>· BANE ${g.court_number}</small></span>
                    <span class="hk-kamp-status" data-f="status"></span>
                </div>
                ${raekke(1)}
                ${raekke(2)}
            </div>`;
        }).join('');

        return `<div class="hk-card" data-match-id="${tm.id}">
            <div class="hk-hoved">
                <span class="hk-hold hk-hold--1"><span class="hk-farve hk-farve--1"></span>${logoImg(logo1, 'hk-card-logo')}<span class="hk-holdnavn">${escapeHtml(tm.team1_name)}</span></span>
                <span class="hk-stilling" data-f="stilling"></span>
                <span class="hk-hold hk-hold--2"><span class="hk-holdnavn">${escapeHtml(tm.team2_name)}</span>${logoImg(logo2, 'hk-card-logo')}<span class="hk-farve hk-farve--2"></span></span>
            </div>
            <div class="hk-undertitel">
                <span>${iGang ? `SPILLES NU · ${iGang} ${iGang === 1 ? 'KAMP' : 'KAMPE'}`
                    : live.length ? 'LIGE AFGJORT' : 'INGEN DELKAMPE I GANG LIGE NU'}</span>
                ${sider > 1 ? `<span class="hk-side">HOLDKAMP ${hkPage + 1} AF ${sider}</span>` : ''}
            </div>
            <div class="hk-live" style="--hk-cols:${lay.cols}; --hk-rows:${lay.rows}; --hk-s:${lay.s};">${kort}</div>
            <div class="hk-chips" data-f="chips"></div>
        </div>`;
    }).join('');
    patchHoldkampCards(matches); // sæt stilling, point, sæt og status på de friske kort
}

// Kort for en delkamp, der lige er afgjort: vinderen fremhævet, sættene og antal
// vundne sæt i stedet for point. Løberen rundt om kortet tømmes over
// HK_RESULTAT_MS; den negative forsinkelse lader den fortsætte, hvor den var,
// når kortene tegnes igen (fx ved skift mellem holdkampe).
function hkResultatKort(g, navn, tilbage, logo1, logo2, logoImg) {
    const saet = hkSaetFraHold1(g);
    const raekke = (hold) => {
        const i = hold - 1;
        const vundne = saet.filter(x => x[i] > x[1 - i]).length;
        const kls = g.winner_team === hold ? 'hk-vinder' : 'hk-taber';
        return `
            <div class="hk-kamp-raekke ${kls}" data-side="${hold}">
                <span class="hk-streg hk-streg--${hold}"></span>
                ${logoImg(hold === 1 ? logo1 : logo2, 'hk-kamp-logo')}
                <span class="hk-kamp-navn">${hkHoldNavn(g, hold)}</span>
                <span class="hk-kamp-saet">${saet.map(x =>
                    `<span class="hk-saet-boks ${x[i] > x[1 - i] ? 'won' : 'lost'}">${x[i]}</span>`).join('')}</span>
                <span class="hk-kamp-pts">${saet.length ? vundne : ''}</span>
            </div>`;
    };
    const brugt = HK_RESULTAT_MS - tilbage;
    return `<div class="hk-kamp hk-kamp--afgjort" data-game-id="${g.id}">
        <svg class="hk-loeber" aria-hidden="true"><rect pathLength="100" style="animation-delay:-${brugt}ms"></rect></svg>
        <div class="hk-kamp-hoved">
            <span class="hk-kamp-kat">${escapeHtml(navn.toUpperCase())} <small>· BANE ${g.court_number}</small></span>
            <span class="hk-kamp-status">AFGJORT</span>
        </div>
        ${raekke(1)}
        ${raekke(2)}
    </div>`;
}

// Sæt på banen orienteret til holdkampens hold: [[team1, team2], ...]
function hkBaneSaet(cd, byttet) {
    return kortSaet(cd).map(([a, b]) => byttet ? [b, a] : [a, b]);
}

function patchHoldkampCards(matches) {
    matches.forEach(tm => {
        const card = document.querySelector(`.hk-card[data-match-id="${tm.id}"]`);
        if (!card) return;
        const t1w = tm.games.filter(g => g.winner_team === 1).length;
        const t2w = tm.games.filter(g => g.winner_team === 2).length;
        const sc = card.querySelector('[data-f="stilling"]');
        const scTekst = `${t1w} – ${t2w}`;
        if (sc && sc.textContent !== scTekst) sc.textContent = scTekst;

        // Delkampe i gang: point, sæt, serv og status fra banens tæller
        tm.games.forEach(g => {
            if (g.status !== 'active') return;
            const cell = card.querySelector(`.hk-kamp[data-game-id="${g.id}"]`);
            if (!cell) return;
            const cd = allCourtData.find(c => c.courtId === g.court_number);
            const sides = holdkampCourtSides(cd, g);
            if (!sides) return;
            const saet = hkBaneSaet(cd, sides.byttet);
            const mellem = erMellemSaet(cd);
            const pts = mellem ? [0, 0] : [sides.team1.score, sides.team2.score];
            const nr = Math.min((cd.player1.games || 0) + (cd.player2.games || 0) + 1, 3);
            const serv = servSide(cd);
            const servHold = serv ? (sides.byttet ? 3 - serv : serv) : 0;

            let status;
            if (cd.restBreakActive) {
                status = `${mellem ? `${nr}. SÆT NÆSTE` : 'PAUSE'} · ${formatPause(getPauseSecondsLeft(cd))}`;
            } else {
                status = `${nr}. SÆT`;
            }
            const st = cell.querySelector('[data-f="status"]');
            if (st && st.textContent !== status) st.textContent = status;
            cell.classList.toggle('hk-kamp--pause', !!cd.restBreakActive);

            [1, 2].forEach(hold => {
                const i = hold - 1;
                const p = cell.querySelector(`[data-f="pts${hold}"]`);
                if (p && p.textContent !== String(pts[i])) p.textContent = pts[i];
                const s = cell.querySelector(`[data-f="saet${hold}"]`);
                const html = saet.map(x => `<span class="hk-saet-boks ${x[i] > x[1 - i] ? 'won' : 'lost'}">${x[i]}</span>`).join('');
                if (s && s.innerHTML !== html) s.innerHTML = html;
                const r = cell.querySelector(`.hk-kamp-raekke[data-side="${hold}"]`);
                if (r) r.classList.toggle('hk-serv', servHold === hold);
            });
        });

        // Rækken nederst: alle delkampe — udeladt, så længe alle er i gang
        const chips = card.querySelector('[data-f="chips"]');
        if (!chips) return;
        const ventGS = HoldkampFormater.goldenSetStatus(tm).kraeves;
        const alleIGang = tm.games.length > 0 && tm.games.every(g => g.status === 'active') && !ventGS;
        const html = alleIGang ? '' : hkNummererede(tm).map(({ g, navn }) => {
            let kls = 'hk-chip', indhold = '';
            if (g.status === 'finished') {
                kls += g.winner_team === 1 ? ' hk-chip--1' : ' hk-chip--2';
                // Hvert sæt set fra hjemmeholdet; sæt, vinderen tabte, står lidt svagere
                indhold = hkSaetFraHold1(g).map(([h, u]) => {
                    const vundet = g.winner_team === 1 ? h > u : u > h;
                    return `<span class="hk-chip-saet${vundet ? '' : ' hk-chip-saet--tabt'}">${h}–${u}</span>`;
                }).join('');
            } else if (g.status === 'active') {
                kls += ' hk-chip--igang';
                indhold = '<span class="hk-chip-note">I GANG</span>';
            } else {
                kls += ' hk-chip--venter';
            }
            const kort = g.category === 'GS' ? 'GS' : navn.toUpperCase();
            return `<div class="${kls}"><span class="hk-chip-kat">${escapeHtml(kort)}</span>${indhold}</div>`;
        }).join('') + (ventGS ? '<div class="hk-chip hk-chip--venter"><span class="hk-chip-kat">GS</span><span class="hk-chip-note">3–3</span></div>' : '');
        if (chips.innerHTML !== html) chips.innerHTML = html;
        chips.style.display = html ? '' : 'none';
    });
}

async function initialize() {
    try {
        // Get court count from settings
        const settings = await api.getSettings();
        courtCount = settings.courtCount || 5;

        await refreshIdleSettings();

        // Hent logo-listerne én gang; herefter opdateres de via
        // SSE-config-events (push) i stedet for timere.
        await refreshOverviewLogos();

        await loadHoldkamp();
        await loadAllCourts();

        // Sponsorer/logoer/settings opdateres nu via SSE-config-events. Et
        // langsomt sikkerhedsnet (5 min) selvheler ved missede events og fanger
        // super-admins centrale logo-ændringer. Erstatter den gamle 10 s-timer.
        setInterval(async () => {
            await refreshIdleSettings();
            await refreshOverviewLogos();
            scheduleRefresh();
        }, 5 * 60 * 1000);
    } catch (error) {
        console.error('Failed to initialize overview:', error);
        hideLoading();
    }
}

function isHoldkampCourt(courtId) {
    if (!activeTeamMatches.length) return false;
    // Kun aktive spil — afsluttede holdkamp-spil har stadig court_number sat
    // men banen skal ikke behandles som holdkamp-bane efter kampen er slut.
    // Søg på tværs af ALLE aktive holdkampe.
    return activeTeamMatches.some(tm =>
        (tm.games || []).some(g => g.court_number === courtId && g.status === 'active')
    );
}

async function loadAllCourts() {
    try {
        // Fetch all court data in a single batch request (much more efficient!)
        const allGameStates = await api.getAllGameStates();

        allCourtData = allGameStates.map(gameState => ({ ...gameState }));

        // Sync pause countdown state from fresh API data.
        // Serveren gemmer kun restBreakSecondsLeft hvert ~10. sekund, så værdien er
        // grov og forældet (for høj) imellem gemninger. Vores lokale Date.now()-
        // baserede nedtælling (getPauseSecondsLeft) er derimod præcis OG selv-
        // korrigerende ved tab-throttling. ENHVER re-sync til serverens grove værdi
        // giver et synligt hop — og da oversigten re-renderer hvert 2. sek (REFRESH_
        // INTERVAL), hoppede den løbende. Derfor anker vi KUN ved en ny pause og
        // stoler ellers udelukkende på den lokale nedtælling. Pausen forsvinder
        // korrekt af sig selv når serveren sætter restBreakActive=false (banen ryddes
        // i else-grenen), så vi behøver aldrig at "rette" nedtællingen mod serveren.
        // Sikkerhedsventil: hvis serveren viser MEGET mere tid (>30s over skønnet),
        // er en helt ny pause startet uden at vi nåede at se restBreakActive=false —
        // så re-ankrer vi. (Normal staleness er ≤ ~10-20s og udløser den aldrig.)
        const now = Date.now();
        allCourtData.forEach(court => {
            if (court.restBreakActive && court.restBreakSecondsLeft > 0) {
                const existing = pauseCountdownState[court.courtId];
                const localEstimate = existing ? getPauseSecondsLeft(court) : null;
                if (!existing || court.restBreakSecondsLeft > localEstimate + 30) {
                    pauseCountdownState[court.courtId] = { receivedAt: now, secondsLeft: court.restBreakSecondsLeft };
                }
            } else {
                delete pauseCountdownState[court.courtId];
            }
        });

        // Opdater snapshot af aktive baner og spor afsluttede baner.
        // Simpel tilgang: afsluttede baner (matchCompleted=true) vises direkte
        // i activeOnly i op til 5 min. Snapshot-fallback håndterer race-condition
        // hvor banen forsvinder (clearCourt) inden oversigt ser matchCompleted=true.
        const currentCourtIds = new Set(allCourtData.map(c => c.courtId));

        allCourtData.forEach(court => {
            if (!court.isActive || !court.matchStartTime || isHoldkampCourt(court.courtId)) {
                // Bane er aktiv uden matchStartTime → ny tildeling → fjern gammel post
                if (court.isActive && finishedCourts.has(court.courtId)) {
                    finishedCourts.delete(court.courtId);
                    lastKnownActiveState.delete(court.courtId);
                }
                return;
            }

            // Kamp er "færdig" når en spiller har vundet 2 sæt — robust uanset matchCompleted-flag
            const matchDone = court.matchCompleted ||
                              court.player1.games >= 2 ||
                              court.player2.games >= 2;

            // Gem senest kendte tilstand — bruges som fallback hvis banen ryddes
            lastKnownActiveState.set(court.courtId, { ...court });

            if (matchDone) {
                const existing = finishedCourts.get(court.courtId);
                if (!existing || existing.matchStartTime !== court.matchStartTime) {
                    finishedCourts.set(court.courtId, {
                        finishedAt: court.matchEndTime ? new Date(court.matchEndTime).getTime() : now,
                        matchStartTime: court.matchStartTime,
                        _snapshot: { ...court }  // altid gem snapshot så fallback virker efter clearCourt
                    });
                } else if (!existing._snapshot) {
                    // Opdater eksisterende entry med snapshot hvis det mangler
                    existing._snapshot = { ...court };
                }
            } else if (finishedCourts.has(court.courtId)) {
                // Ny kamp startet på samme bane — fjern den afsluttede post
                const entry = finishedCourts.get(court.courtId);
                if (court.matchStartTime !== entry.matchStartTime) {
                    finishedCourts.delete(court.courtId);
                }
            }
        });

        // Fallback: baner der var aktive men nu er forsvundet (clearCourt før oversigt
        // nåede at se matchCompleted=true). Brug snapshot til at vise resultatet.
        for (const [courtId, snapshot] of lastKnownActiveState) {
            const current = allCourtData.find(c => c.courtId === courtId);
            const isGone = !current?.isActive || !current?.matchStartTime;
            if (isGone && !finishedCourts.has(courtId)) {
                finishedCourts.set(courtId, {
                    finishedAt: snapshot.matchEndTime
                        ? new Date(snapshot.matchEndTime).getTime()
                        : now,
                    matchStartTime: snapshot.matchStartTime,
                    _snapshot: { ...snapshot, matchCompleted: true }
                });
            }
            if (isGone) lastKnownActiveState.delete(courtId);
        }

        // Expire entries older than 5 minutes
        for (const [cid, entry] of finishedCourts) {
            if (now - entry.finishedAt > FINISHED_DISPLAY_MS) {
                finishedCourts.delete(cid);
                lastKnownActiveState.delete(cid);
            }
        }

        // badmintonplanner.dk: banner med rundenavn/næste runde/note (data følger med pr. bane)
        updatePlannerBanner(allCourtData);

        // Filter: vis aktive baner + afsluttede i op til 5 min.
        // matchCompleted=true baner inkluderes direkte — ingen separat snapshot-mekanisme.
        const activeOnly = allCourtData.filter(court => {
            if (!court.isActive) return false;

            const hasGameActivity =
                !!court.matchStartTime ||
                court.player1.score > 0 ||
                court.player2.score > 0 ||
                court.player1.games > 0 ||
                court.player2.games > 0 ||
                court.timerSeconds > 0 ||
                court.isActive;

            if (!hasGameActivity) {
                delete courtMatchTimes[court.courtId];
                return false;
            }

            // Vis afsluttet kamp i op til 5 min (brug games-count som primær indikator)
            const matchDone = court.matchCompleted ||
                              court.player1.games >= 2 ||
                              court.player2.games >= 2;
            if (matchDone) {
                const entry = finishedCourts.get(court.courtId);
                if (!entry) return false;
                if (now - entry.finishedAt > FINISHED_DISPLAY_MS) return false;
            }

            // Timer-anker: serverens elapsedSeconds (samme ur som starttiden)
            // tælles videre lokalt med performance.now() (monotonisk). Ankeret
            // genbruges hvis driften er ≤ 1,5 sek. så tallet ikke flimrer ved
            // hver poll; ellers re-ankres til serverens værdi.
            const prev = courtMatchTimes[court.courtId];
            const frozen = !!court.matchEndTime;
            let anchor = prev ? prev.anchor : null;
            if (typeof court.elapsedSeconds === 'number') {
                const localNow = anchor
                    ? (anchor.frozen ? anchor.base : anchor.base + (performance.now() - anchor.at) / 1000)
                    : null;
                if (!anchor || anchor.frozen !== frozen ||
                    localNow === null || Math.abs(localNow - court.elapsedSeconds) > 1.5) {
                    anchor = { base: court.elapsedSeconds, at: performance.now(), frozen };
                }
            } else {
                anchor = null; // ældre backend — calculateElapsedTime falder tilbage til dato-math
            }

            courtMatchTimes[court.courtId] = {
                matchStartTime: court.matchStartTime,
                matchEndTime: court.matchEndTime,
                anchor
            };
            return true;
        });

        // Merge: aktive/afsluttede baner fra DB + snapshot-fallback for ryddede baner
        const activeIds = new Set(activeOnly.map(c => c.courtId));
        const fallbackCourts = Array.from(finishedCourts.entries())
            .filter(([cid, e]) => e._snapshot && !activeIds.has(cid))
            .map(([, e]) => ({
                ...e._snapshot,
                _isFinished: true,
                _finishedAt: e.finishedAt
            }));

        // Mark completed courts in activeOnly as finished for rendering
        activeCourts = [
            ...activeOnly.map(c => {
                const done = c.matchCompleted || c.player1.games >= 2 || c.player2.games >= 2;
                return done
                    ? { ...c, _isFinished: true, _finishedAt: finishedCourts.get(c.courtId)?.finishedAt ?? now }
                    : c;
            }),
            ...fallbackCourts
        ].map(orienterBane);

        hideLoading();
        displayCurrentPage();
        updateIdleState();
    } catch (error) {
        console.error('Failed to load courts:', error);
        hideLoading();
    }
}

function displayCurrentPage() {
    const grid = document.getElementById('courtsGrid');
    const pageIndicator = document.getElementById('pageIndicator');
    const pageInfo = document.getElementById('pageInfo');

    // Under holdkamp vises KUN holdkamp-visningen øverst — per-bane-grid'et
    // (den nederste halvdel) skal være helt skjult.
    if (activeTeamMatches.length > 0) {
        grid.style.display = 'none';
        grid.innerHTML = '';
        pageIndicator.style.display = 'none';
        return;
    }

    if (activeCourts.length === 0) {
        grid.style.display = 'none';
        pageIndicator.style.display = 'none';
        return;
    }

    grid.style.display = 'grid';

    // Calculate total pages
    const totalPages = Math.ceil(activeCourts.length / COURTS_PER_PAGE);
    // Færre baner end før (fx fra 8 til 6, mens vi stod på side 2): uden dette
    // pegede currentPage ud over sidste side, og skærmen blev helt tom
    if (currentPage >= totalPages) currentPage = 0;

    // Update page indicator
    if (totalPages > 1) {
        pageIndicator.style.display = 'block';
        pageInfo.textContent = `Side ${currentPage + 1} af ${totalPages}`;
    } else {
        pageIndicator.style.display = 'none';
    }

    // Calculate which courts to show on current page
    const startIndex = currentPage * COURTS_PER_PAGE;
    const endIndex = startIndex + COURTS_PER_PAGE;
    const courtsToShow = activeCourts.slice(startIndex, endIndex);

    // Højst 4 baner: 2 × 2 med ca. 40 % større kort (ellers 3 × 2)
    grid.classList.toggle('courts-grid--fire', courtsToShow.length <= 4);

    // Check if same courts are already rendered — if so, update in-place to avoid layout jump
    // Include _isFinished in the key so a transition active→finished triggers a full re-render
    const existingIds = Array.from(grid.querySelectorAll('.court-card')).map(el =>
        el.dataset.courtId + (el.dataset.finished ? '-f' : ''));
    const newIds = courtsToShow.map(c => String(c.courtId) + (c._isFinished ? '-f' : ''));
    const sameLayout = existingIds.length === newIds.length && newIds.every((id, i) => id === existingIds[i]);

    if (sameLayout) {
        courtsToShow.forEach(court => updateCourtCardData(court));
    } else {
        grid.innerHTML = courtsToShow.map(court => renderCourtCard(court)).join('');
        // Add animation class only on full re-render
        grid.querySelectorAll('.court-card').forEach(el => el.classList.add('court-card--animate'));
    }
}

// ==================== BANEKORT (G2: hvert kort er et lille TV, layout A) ====================
// Status (sæt og tid / pause / afgjort / venter) står i kortets top, navnene i
// Bebas, og pointtallet er det største på kortet. Stregen i venstre kant viser,
// hvem der server (grøn for vinderen, når kampen er afgjort). Ved pause holder
// rækkerne plads til nedtællingen i højre side, så den ikke dækker sættene.
// Strukturen tegnes kun igen, når kortSignatur ændrer sig — ellers opdateres
// pointtallene, uret og nedtællingen på stedet.

function updateCourtCardData(court) {
    const card = document.querySelector(`.court-card[data-court-id="${court.courtId}"]`);
    if (!card) return;
    if (card.dataset.sig !== kortSignatur(court)) {
        card.outerHTML = renderCourtCard(court);
        return;
    }
    if (court._isFinished) {
        const timeEl = card.querySelector('.finished-time');
        if (timeEl) {
            const t = afsluttetTekst(court);
            if (timeEl.textContent !== t) timeEl.textContent = t;
        }
        return;
    }
    const [pts1, pts2] = kortPoint(court);
    card.querySelectorAll('.oc-point').forEach(el => {
        const t = String(el.dataset.side === '1' ? pts1 : pts2);
        if (el.textContent !== t) el.textContent = t;
    });
}

// Alt, der ændrer kortets opbygning (point og tid opdateres på stedet)
function kortSignatur(court) {
    const pause = !court._isFinished && !!court.restBreakActive;
    return [
        court._isFinished ? 'f' : '', pause ? 'p' : '', venterPaaKamp(court) ? 'v' : '',
        court.player1?.name, court.player1?.name2, court.player2?.name, court.player2?.name2,
        (court.setScoresHistory || []).length, servSide(court) || 0,
        pause ? `${court.player1?.score}-${court.player2?.score}` : '',
        court._isFinished ? resultatSignatur(court) : '', plannerSignatur(court)
    ].join('|');
}

// Kortets rækkefølge pr. bane: { courtId: [øverste navn, nederste navn] }.
// Tælleren bytter player1/player2, når spillerne skifter side mellem sættene,
// men tilskuerne skal se samme spiller øverst hele kampen — som på TV'et.
// Samme regler som tv-script-v3.js' laesOprindeligeSider:
// - Samme to spillere: rækkefølgen står fast.
// - Ét navn rettet: den uændrede spiller beholder sin række.
// - Nye spillere (ny kamp / skærmen genstartet): sæt 1's sider, hvis et sæt
//   er spillet, ellers de nuværende.
const baneRaekkefoelge = {};

function orienterBane(court) {
    const p1 = court.player1, p2 = court.player2;
    if (!p1 || !p2) return court;
    const husket = baneRaekkefoelge[court.courtId];
    let byttet = false;
    if (husket) {
        const [o1, o2] = husket;
        if (p1.name === o1 && p2.name === o2) byttet = false;
        else if (p1.name === o2 && p2.name === o1) byttet = true;
        else if (p1.name === o1 || p2.name === o2) byttet = false;
        else if (p1.name === o2 || p2.name === o1) byttet = true;
        else byttet = foersteSaetByttet(court);
    } else {
        byttet = foersteSaetByttet(court);
    }
    baneRaekkefoelge[court.courtId] = byttet ? [p2.name, p1.name] : [p1.name, p2.name];
    if (!byttet) return court;

    const vend = (s) => (s === 1 || s === 2 ? 3 - s : s);
    return {
        ...court,
        player1: p2,
        player2: p1,
        servingPlayer: vend(court.servingPlayer),
        servingTeam: vend(court.servingTeam),
        resultWinner: vend(court.resultWinner)
    };
}

// Stod spillerne omvendt i 1. sæt i forhold til nu?
function foersteSaetByttet(court) {
    const h = court.setScoresHistory;
    const foerste = Array.isArray(h) && h[0] && typeof h[0] === 'object' && h[0].player1Name ? h[0] : null;
    return !!foerste && foerste.player1Name === court.player2.name && foerste.player2Name === court.player1.name;
}

// Hvem server: 1 = øverste række (player1), 2 = nederste
function servSide(court) {
    const s = court.isDoubles ? court.servingTeam : court.servingPlayer;
    return s === 1 || s === 2 ? s : null;
}

// Afsluttede sæt orienteret til kortets rækker: [[række1, række2], ...]
function kortSaet(court) {
    return (court.setScoresHistory || []).map(set => {
        const parts = String((set && set.score) || set || '0-0').split('-');
        const a = parseInt(parts[0]) || 0, b = parseInt(parts[1]) || 0;
        return erSaetVendt(set, court.player1?.name, court.player2?.name) ? [b, a] : [a, b];
    });
}

// Pausen mellem sæt: tælleren nulstiller først pointene, når pausen slutter,
// så stillingen er stadig det afsluttede sæts
function erMellemSaet(court) {
    const saet = kortSaet(court);
    if (!court.restBreakActive || !saet.length) return false;
    const [a, b] = saet[saet.length - 1];
    const s1 = court.player1.score, s2 = court.player2.score;
    return (s1 === a && s2 === b) || (s1 === b && s2 === a);
}

function kortPoint(court) {
    if (erMellemSaet(court)) return [0, 0];
    return [court.player1.score, court.player2.score];
}

function afsluttetTekst(court) {
    const min = Math.floor((Date.now() - court._finishedAt) / 60000);
    return min < 1 ? 'LIGE NU' : `${min} MIN SIDEN`;
}

function formatPause(sek) {
    const s = Math.max(0, sek || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderCourtCard(court) {
    const afgjort = !!court._isFinished;
    const pause = !afgjort && !!court.restBreakActive;
    const venter = venterPaaKamp(court);
    const saet = kortSaet(court);
    const nr = Math.min((court.player1.games || 0) + (court.player2.games || 0) + 1, 3);

    // Status i kortets top
    let status, statusKlasse = '';
    if (afgjort) {
        const ord = court.resultOutcome === 'walkover' ? 'WALKOVER'
            : court.resultOutcome === 'ended_early' ? 'AFSLUTTET FØR TID' : 'AFGJORT';
        status = `${ord} · <span class="finished-time">${afsluttetTekst(court)}</span>`;
        statusKlasse = ' oc-status--afgjort';
    } else if (venter) {
        status = 'VENTER PÅ KAMP';
    } else if (pause) {
        status = erMellemSaet(court) ? `${nr}. SÆT NÆSTE` : `${nr}. SÆT · PAUSE`;
        statusKlasse = ' oc-status--pause';
    } else {
        status = `${nr}. SÆT · <span id="timer-${court.courtId}">${formatTimer(calculateElapsedTime(court.courtId))}</span>`;
    }

    // Vinderen (afgjort): indtastet resultat kan have valgt en vinder, der var bagud
    const g1 = court.player1?.games ?? 0, g2 = court.player2?.games ?? 0;
    const vinder = !afgjort ? 0 : court.resultWinner ? court.resultWinner : (g1 > g2 ? 1 : g2 > g1 ? 2 : 0);

    // Navne: fornavn, forbogstav ved sammenfald — som på TV'et
    const dbl = !!court.isDoubles;
    const fulde = [court.player1?.name, dbl ? court.player1?.name2 : '', court.player2?.name, dbl ? court.player2?.name2 : ''];
    const vis = window.NameDisplay
        ? NameDisplay.visningsnavne(fulde, { uforkortet: !!court.planner })
        : fulde.map(n => n || '');
    const plogo = (name) => {
        const logo = window.LogoMatch && LogoMatch.resolvePlayerLogo(name, {
            playerLogos: _overviewPlayerLogos, clubByName: _overviewClubByName, logos: _overviewLogos
        });
        return logo ? `<img class="player-logo" src="${escapeHtml(logo.url)}" alt="" onerror="this.style.display='none'">` : '';
    };
    const navn = (full, v) => full
        ? `<div class="player-name-row">${plogo(full)}<div class="player-name">${escapeHtml(v)}</div></div>` : '';

    // Pausen midt i sættet: stillingen står i sættets egen boks (nedtællingen har pointfeltet)
    const igang = pause && !erMellemSaet(court) ? [court.player1.score, court.player2.score] : null;
    const [pts1, pts2] = kortPoint(court);
    const serv = afgjort || venter ? null : servSide(court);

    const raekke = (side) => {
        const i = side - 1;
        const bokse = saet.map(s => `<span class="oc-saet-boks ${s[i] > s[1 - i] ? 'won' : 'lost'}">${s[i]}</span>`).join('')
            + (igang ? `<span class="oc-saet-boks igang">${igang[i]}</span>` : '');
        const kls = ['oc-raekke', serv === side ? 'oc-serv' : '',
            vinder === side ? 'oc-vinder' : '', vinder && vinder !== side ? 'oc-taber' : ''].filter(Boolean).join(' ');
        return `<div class="${kls}">
                <span class="oc-streg"></span>
                <div class="oc-navne">${navn(fulde[i * 2], vis[i * 2])}${navn(fulde[i * 2 + 1], vis[i * 2 + 1])}</div>
                <div class="oc-saet">${bokse}</div>
                <span class="oc-point" data-side="${side}">${side === 1 ? pts1 : pts2}</span>
            </div>`;
    };

    const kls = ['court-card', afgjort ? 'court-card--finished' : '', pause ? 'court-card--paused' : '',
        venter ? 'court-card--waiting' : ''].filter(Boolean).join(' ');

    return `
        <div class="${kls}" data-court-id="${court.courtId}"${afgjort ? ' data-finished="1"' : ''} data-sig="${escapeHtml(kortSignatur(court))}">
            <div class="court-card-header">
                <div class="court-number">BANE <span>${court.courtId}</span></div>
                <div class="oc-status${statusKlasse}">${status}</div>
            </div>
            ${raekke(1)}
            ${raekke(2)}
            ${pause ? `
            <div class="oc-pause">
                <span class="oc-pause-titel">PAUSE</span>
                <span class="oc-pause-tal" id="pause-timer-${court.courtId}">${formatPause(getPauseSecondsLeft(court))}</span>
            </div>` : ''}
            ${venter ? '<div class="oc-venter-tekst">Kampen starter, når der trykkes Start kamp</div>' : ''}
            ${plannerInfoHtml(court)}
        </div>
    `;
}

// Banen er aktiv, men kampen er ikke gået i gang (ingen starttid og ingen point).
// Kortet viser da "Venter på kamp" i stedet for et ur på 00:00 og en stilling på 0–0.
function venterPaaKamp(court) {
    if (court._isFinished || court.matchStartTime || court.restBreakActive) return false;
    return !(court.player1.score || court.player2.score || court.player1.games || court.player2.games);
}

// Resultatet på et afsluttet kort — ændres det (rettet resultat), tegnes kortet igen
function resultatSignatur(court) {
    return [court.resultOutcome || '', court.resultWinner || '', (court.setScoresHistory || []).length,
        court.player1?.games ?? 0, court.player2?.games ?? 0].join('|');
}

function getPauseSecondsLeft(court) {
    const state = pauseCountdownState[court.courtId];
    if (!state) return court.restBreakSecondsLeft || 0;
    const elapsed = (Date.now() - state.receivedAt) / 1000;
    return Math.max(0, Math.round(state.secondsLeft - elapsed));
}

function calculateElapsedTime(courtId) {
    const matchTimes = courtMatchTimes[courtId];

    if (!matchTimes || !matchTimes.matchStartTime) {
        return 0;
    }

    // Server-forankret tid (samme ur som starttiden, monotonisk lokal tælling)
    const anchor = matchTimes.anchor;
    if (anchor) {
        if (anchor.frozen) return Math.max(0, Math.floor(anchor.base));
        return Math.max(0, Math.floor(anchor.base + (performance.now() - anchor.at) / 1000));
    }

    // Fallback (ældre backend uden elapsedSeconds): dato-math med clamp
    const startTime = new Date(matchTimes.matchStartTime);
    const endTime = matchTimes.matchEndTime ? new Date(matchTimes.matchEndTime) : new Date();
    const elapsedMs = endTime - startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    return Math.max(0, elapsedSeconds);
}

// Er sættet gemt med siderne byttet i forhold til nu? Genkendes blot ét af
// navnene på sin plads, er det ikke byttet (en rettet stavefejl i det andet navn
// vendte før sættet, så vinderen stod som taber).
function erSaetVendt(set, p1Name, p2Name) {
    if (!set || typeof set !== 'object' || !set.player1Name) return false;
    if (set.player1Name === p1Name || (p2Name && set.player2Name === p2Name)) return false;
    return true;
}

function formatTimer(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

function escapeHtml(text) {
    // Escaper også anførselstegn — bruges i HTML-attributter (data-p1, src, ...)
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Orienterer sætscoren til team1 (række-venstre side) ud fra navnene i
// set_scores-strengen, så tallene matcher hvilket hold der står hvor — uanset
// hvilken side spillerne stod på pr. sæt. side1Key tomt -> kun rå tal.
// (Samme logik som admin-script.js' orientHistorySetScoreNumbers.)
function orientHistorySetScoreNumbers(rawSetScores, side1Key) {
    if (!rawSetScores) return [];
    if (!side1Key) return rawSetScores.match(/\d+-\d+/g) || [];
    const normalizeNames = s => String(s).trim().replace(/\s*[/&]\s*/g, ' / ');
    const anchor = normalizeNames(side1Key);
    return rawSetScores.split(', ').map(part => {
        const m = part.match(/^(.*?)\s+(\d+)-(\d+)\s+(.*?)$/);
        if (m) {
            const p1 = normalizeNames(m[1]);
            const p2 = normalizeNames(m[4]);
            if (p1 === anchor) return `${m[2]}-${m[3]}`;
            if (p2 === anchor) return `${m[3]}-${m[2]}`;
            return `${m[2]}-${m[3]}`;
        }
        const scoreOnly = part.trim().match(/^\d+-\d+$/);
        return scoreOnly ? part.trim() : null;
    }).filter(Boolean);
}

function hideLoading() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.style.display = 'none';
}

// ==================== IDLE SCREEN (screensaver / sponsor slideshow) ====================

let _idleImages = [];
let _idleSlideDuration = 10000;
let _idleSlideshowTimer = null;
let _idleAnimFrame = null;
let _idleSlideIndex = 0;
let _isIdleVisible = false;

async function refreshIdleSettings() {
    try {
        const [images, settings] = await Promise.all([
            // 'slideshow' (ikke 'general' — den type findes ikke; backend
            // ignorerede filteret og returnerede ALLE billeder, også bane-bannere
            // og inaktive). Idle-skærmen skal vise samme slideshow som TV'et.
            api.getSponsorImages('slideshow'),
            api.getSettings()
        ]);
        const newImages = images || [];
        const newDuration = (settings.slideDuration || 10) * 1000;

        // If image list or duration changed while idle, restart the idle screen
        const changed = newImages.length !== _idleImages.length || newDuration !== _idleSlideDuration;
        _idleImages = newImages;
        _idleSlideDuration = newDuration;

        if (_isIdleVisible && changed) {
            _stopIdleSlideshow();
            _stopIdleScreensaver();
            const screen = document.getElementById('idleScreen');
            if (screen) screen.innerHTML = '';
            _isIdleVisible = false;
            _startIdleContent();
        }
    } catch (e) { /* keep cached values on error */ }
}

function updateIdleState() {
    const hasActivity = activeCourts.length > 0 || activeTeamMatches.length > 0;
    if (hasActivity) {
        _hideIdleScreen();
    } else {
        _showIdleScreen();
    }
}

function _showIdleScreen() {
    if (_isIdleVisible) return;
    const screen = document.getElementById('idleScreen');
    if (!screen) return;
    screen.style.display = 'block';
    _isIdleVisible = true;
    _startIdleContent();
}

function _hideIdleScreen() {
    if (!_isIdleVisible) return;
    _stopIdleSlideshow();
    _stopIdleScreensaver();
    const screen = document.getElementById('idleScreen');
    if (screen) {
        screen.style.display = 'none';
        screen.innerHTML = '';
    }
    _isIdleVisible = false;
    _idleSlideIndex = 0;
}

function _startIdleContent() {
    if (_idleImages.length > 0) {
        _startIdleSlideshow();
    } else {
        _startIdleDefaultMessage();
    }
}

// ── Sponsor slideshow ────────────────────────────────────────────────────────

function _startIdleSlideshow() {
    const screen = document.getElementById('idleScreen');
    if (!screen) return;

    screen.innerHTML = `<img id="idleSlideImg"
        src="/uploads/${escapeHtml(_idleImages[0].filename)}"
        style="width:100%;height:100%;object-fit:contain;display:block;" alt="">`;
    _idleSlideIndex = 0;

    if (_idleImages.length > 1) {
        _idleSlideshowTimer = setInterval(() => {
            _idleSlideIndex = (_idleSlideIndex + 1) % _idleImages.length;
            const img = document.getElementById('idleSlideImg');
            if (img) img.src = `/uploads/${escapeHtml(_idleImages[_idleSlideIndex].filename)}`;
        }, _idleSlideDuration);
    }
}

function _stopIdleSlideshow() {
    if (_idleSlideshowTimer) {
        clearInterval(_idleSlideshowTimer);
        _idleSlideshowTimer = null;
    }
}

// ── Screensaver (bouncing text) ───────────────────────────────────────────────

function _startIdleDefaultMessage() {
    const screen = document.getElementById('idleScreen');
    if (!screen) return;

    screen.innerHTML = `
        <div id="idleBounceText" class="idle-bounce-text">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g transform="translate(0 1.2)"><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(-33 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(-14 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(14 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(33 12 14.5)"/><rect x="9.4" y="14.3" width="5.2" height="1.7" rx="0.85"/><path d="M9.7 16.6h4.6v0.5a2.3 2.3 0 0 1-4.6 0z"/></g></svg>
            <span>Ingen aktive kampe</span>
        </div>`;

    _startIdleScreensaver();
}

function _startIdleScreensaver() {
    _stopIdleScreensaver();

    let x = -1, y = -1, dx = 0, dy = 0, lastTime = null;

    function animate(timestamp) {
        const screen = document.getElementById('idleScreen');
        const text = screen ? screen.querySelector('#idleBounceText') : null;
        if (!screen || !text) return;

        if (x < 0) {
            const maxX = screen.offsetWidth - text.offsetWidth;
            const maxY = screen.offsetHeight - text.offsetHeight;
            x = Math.max(0, maxX / 2);
            y = Math.max(0, maxY / 2);
            const speed = 20;
            const angle = Math.random() * 2 * Math.PI;
            dx = Math.cos(angle) * speed;
            dy = Math.sin(angle) * speed;
            if (Math.abs(dx) < 6) dx = dx < 0 ? -6 : 6;
            if (Math.abs(dy) < 6) dy = dy < 0 ? -6 : 6;
        }

        if (!lastTime) lastTime = timestamp;
        const delta = Math.min((timestamp - lastTime) / 1000, 0.1);
        lastTime = timestamp;

        x += dx * delta;
        y += dy * delta;

        const maxX = Math.max(0, screen.offsetWidth - text.offsetWidth);
        const maxY = Math.max(0, screen.offsetHeight - text.offsetHeight);

        if (x <= 0)    { x = 0;    dx =  Math.abs(dx); }
        if (x >= maxX) { x = maxX; dx = -Math.abs(dx); }
        if (y <= 0)    { y = 0;    dy =  Math.abs(dy); }
        if (y >= maxY) { y = maxY; dy = -Math.abs(dy); }

        text.style.left = Math.round(x) + 'px';
        text.style.top  = Math.round(y) + 'px';

        _idleAnimFrame = requestAnimationFrame(animate);
    }

    _idleAnimFrame = requestAnimationFrame(animate);
}

function _stopIdleScreensaver() {
    if (_idleAnimFrame) {
        cancelAnimationFrame(_idleAnimFrame);
        _idleAnimFrame = null;
    }
}

function startAutoRefresh() {
    // loadHoldkamp køres FØRST så activeTeamMatch er frisk når loadAllCourts
    // kalder isHoldkampCourt() — ellers bruger den stale data hvor afsluttede
    // holdkamp-spil stadig har status='active' og ekskluderer banen fra visning.
    // Lille tilfældigt offset så oversigten ikke rammer serveren i præcis samme
    // sekund som TV-skærmene efter en fælles genstart/udfald (spredning).
    setTimeout(() => {
        refreshTimer = setInterval(scheduleRefresh, REFRESH_INTERVAL);
    }, Math.floor(Math.random() * 1000));

    // SSE-poke: opdater med det samme når en bane ændrer sig i stedet for at
    // vente på næste poll. Pollingen beholdes uændret som sikkerhedsnet (og
    // fanger holdkamp-ændringer der ikke udløser game-state events).
    if (window.LiveUpdates) {
        liveUpdatesHandle = window.LiveUpdates.connect({
            onEvent: (event) => {
                if (event && event.type === 'config') {
                    handleOversigtConfigEvent(event.scope);
                } else {
                    scheduleRefresh();
                }
            }
        });
    }
}

// Reager på et SSE config-event: invalidér den relevante cache og gen-render.
async function handleOversigtConfigEvent(scope) {
    if (scope === 'sponsors') {
        // Bane-bannere blev fjernet fra Oversigten; kun idle-slideshowets
        // indstillinger skal genindlæses her. (Tidligere kaldtes en fjernet
        // refreshCourtBanners(), som kastede ReferenceError ved hver ændring.)
        await refreshIdleSettings();
        scheduleRefresh();
    } else if (scope === 'logos') {
        await refreshOverviewLogos();
        scheduleRefresh();
    } else if (scope === 'theme') {
        if (window.loadTheme) await window.loadTheme();
    } else if (scope === 'settings') {
        try {
            const settings = await api.getSettings();
            courtCount = settings.courtCount || courtCount;
        } catch {}
        await refreshIdleSettings();
        scheduleRefresh();
    }
}

// Saml poll-ticks og SSE-events til én kørende opdatering ad gangen —
// kommer der events mens en opdatering kører, køres der præcis én gang til.
let _refreshRunning = false;
let _refreshPending = false;
async function scheduleRefresh() {
    if (_refreshRunning) {
        _refreshPending = true;
        return;
    }
    _refreshRunning = true;
    try {
        await loadHoldkamp();
        await loadAllCourts();
    } finally {
        _refreshRunning = false;
        if (_refreshPending) {
            _refreshPending = false;
            scheduleRefresh();
        }
    }
}

function startAutoScroll() {
    // Auto-scroll to next page every 10 seconds if there are more than 6 active courts
    scrollTimer = setInterval(() => {
        if (activeCourts.length > COURTS_PER_PAGE) {
            nextPage();
        }
    }, SCROLL_INTERVAL);
}

function startLocalTimers() {
    // Update timer displays every second based on matchStartTime
    localTimerInterval = setInterval(() => {
        updateTimerDisplays();
    }, 1000);
}

function updateTimerDisplays() {
    // Update match timer for all visible courts
    for (const courtId in courtMatchTimes) {
        const elapsed = formatTimer(calculateElapsedTime(courtId));
        const timerEl = document.getElementById(`timer-${courtId}`);
        if (timerEl) timerEl.textContent = elapsed;
    }
    // Update pause countdown timers using local state (no API lag)
    activeCourts.forEach(court => {
        if (!court.restBreakActive) return;
        const pauseTimerEl = document.getElementById(`pause-timer-${court.courtId}`);
        if (pauseTimerEl) {
            pauseTimerEl.textContent = formatPause(getPauseSecondsLeft(court));
        }
    });
}

function nextPage() {
    const totalPages = Math.ceil(activeCourts.length / COURTS_PER_PAGE);

    // Move to next page, wrap around to 0 if at end
    currentPage = (currentPage + 1) % totalPages;

    // Display new page immediately without animation
    displayCurrentPage();
}

// Cleanup on page unload — pagehide (ikke beforeunload) bevarer browserens bfcache
window.addEventListener('pagehide', function() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (scrollTimer) clearInterval(scrollTimer);
    if (localTimerInterval) clearInterval(localTimerInterval);
});


// ===== badmintonplanner.dk: runde-visning =====
// Hver bane i batch/all bærer court.planner = { label, note, nextRoundAt,
// substitutes[], courtNote } når banen viser en runde fra badmintonplanner.dk.
// Banneret øverst viser rundenavn, næste runde og rundenote; banekortet får
// udskiftere og banenote under spillerne.

let _plannerBannerSignatur = null;
let _plannerBannerNext = null;
let _plannerBannerTimer = null;

function plannerKlokkeslaet(date) {
    return new Intl.DateTimeFormat('da-DK', {
        timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(date).replace(':', '.');
}

function plannerNaesteTekst(next) {
    if (!next) return '';
    const diffMin = Math.ceil((next.getTime() - Date.now()) / 60000);
    const kl = plannerKlokkeslaet(next);
    if (diffMin > 1) return `Næste runde ${kl} · om ${diffMin} min`;
    if (diffMin === 1) return `Næste runde ${kl} · om 1 min`;
    return `Næste runde ${kl} · nu`;
}

function updatePlannerBanner(courts) {
    const banner = document.getElementById('plannerBanner');
    if (!banner) return;
    const p = (courts || []).map(c => c.planner).find(Boolean) || null;
    const signatur = p ? JSON.stringify([p.label, p.note, p.nextRoundAt]) : null;

    if (!p) {
        if (banner.style.display !== 'none') banner.style.display = 'none';
        _plannerBannerSignatur = null;
        _plannerBannerNext = null;
        if (_plannerBannerTimer) { clearInterval(_plannerBannerTimer); _plannerBannerTimer = null; }
        return;
    }
    const next = p.nextRoundAt ? new Date(p.nextRoundAt) : null;
    _plannerBannerNext = next && !isNaN(next.getTime()) ? next : null;

    if (signatur !== _plannerBannerSignatur) {
        _plannerBannerSignatur = signatur;
        document.getElementById('plannerBannerLabel').textContent = p.label || '';
        document.getElementById('plannerBannerNote').textContent = p.note || '';
        banner.style.display = (p.label || p.note || _plannerBannerNext) ? 'flex' : 'none';
    }
    const nextEl = document.getElementById('plannerBannerNext');
    const tekst = plannerNaesteTekst(_plannerBannerNext);
    if (nextEl.textContent !== tekst) nextEl.textContent = tekst;
    if (!_plannerBannerTimer) {
        _plannerBannerTimer = setInterval(() => {
            const el = document.getElementById('plannerBannerNext');
            const t = plannerNaesteTekst(_plannerBannerNext);
            if (el && el.textContent !== t) el.textContent = t;
        }, 15000);
    }
}

// Signatur til at afgøre om banekortet skal gen-renderes (udskiftere/note ændret)
function plannerSignatur(court) {
    const p = court && court.planner;
    if (!p) return '';
    return [(p.substitutes || []).join('|'), p.courtNote || ''].join('#');
}

function plannerInfoHtml(court) {
    const p = court && court.planner;
    if (!p) return '';
    const subs = (p.substitutes || []).filter(Boolean);
    if (!subs.length && !p.courtNote) return '';
    return `
        <div class="court-planner-info">
            ${subs.length ? `<div class="court-planner-subs"><span class="court-planner-label">Udskiftere</span>${escapeHtml(subs.join(' · '))}</div>` : ''}
            ${p.courtNote ? `<div class="court-planner-note">${escapeHtml(p.courtNote)}</div>` : ''}
        </div>`;
}
