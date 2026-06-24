'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TS_BASE = 'https://badmintondenmark.tournamentsoftware.com';

// Cache consent-cookies pr. host i ~12t — siden ændrer dem sjældent, og vi sparer
// to ekstra requests per import.
let _consentCookieHeader = null;
let _consentCookieExpires = 0;

// Etablér consent-session ved at GET /cookiewall (sætter initial st-cookie)
// efterfulgt af POST /cookiewall/Save (opdaterer st til c=1&cp=7).
// Returnerer en Cookie-header der kan genbruges til efterfølgende requests.
async function establishConsent(force = false) {
    if (!force && _consentCookieHeader && Date.now() < _consentCookieExpires) {
        return _consentCookieHeader;
    }

    // Step 1: GET cookiewall for at få ASP.NET_SessionId + initial st-cookie
    const initResp = await fetch(`${TS_BASE}/cookiewall?returnurl=%2F`, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(12000),
        redirect: 'manual'
    });
    const cookies = collectCookies(initResp.headers);

    // Step 2: POST consent-form. 302-redirect forventet — vi følger ikke (vi vil bare have cookien).
    const formData = new URLSearchParams();
    formData.append('ReturnUrl', '/');
    formData.append('SettingsOpen', 'false');
    formData.append('CookiePurposes', '1');
    formData.append('CookiePurposes', '2');
    formData.append('CookiePurposes', '3');
    formData.append('CookiePurposes', '4');

    const saveResp = await fetch(`${TS_BASE}/cookiewall/Save`, {
        method: 'POST',
        headers: {
            'User-Agent': BROWSER_UA,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieHeader(cookies)
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(12000),
        redirect: 'manual'
    });
    mergeCookies(cookies, saveResp.headers);

    const header = cookieHeader(cookies);
    _consentCookieHeader = header;
    _consentCookieExpires = Date.now() + 12 * 60 * 60 * 1000;
    return header;
}

// Saml cookies fra Set-Cookie headers til simpel {name: value}-map
function collectCookies(headers) {
    const cookies = {};
    // node fetch lavet headers.getSetCookie() i nyere versioner
    const setCookies = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : headers.raw ? headers.raw()['set-cookie'] || [] : [];
    for (const sc of setCookies) {
        const eq = sc.indexOf('=');
        const semi = sc.indexOf(';');
        if (eq === -1) continue;
        const name = sc.substring(0, eq).trim();
        const value = sc.substring(eq + 1, semi === -1 ? sc.length : semi).trim();
        cookies[name] = value;
    }
    return cookies;
}

function mergeCookies(existing, headers) {
    const fresh = collectCookies(headers);
    Object.assign(existing, fresh);
}

function cookieHeader(cookies) {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

// Træk tournament ID ud af brugerens URL — accepterer hele tournament-URL eller bare UUID
function extractTournamentId(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const m = trimmed.match(uuidRegex);
    return m ? m[0].toLowerCase() : null;
}

// Hent en page fra tournamentsoftware.com med etableret consent-session
async function fetchTournamentPage(tournamentId, subPage, _retry = 0) {
    const cookie = await establishConsent(_retry > 0);
    const url = subPage
        ? `${TS_BASE}/tournament/${tournamentId}/${subPage}`
        : `${TS_BASE}/tournament/${tournamentId}`;
    const resp = await fetch(url, {
        headers: {
            'User-Agent': BROWSER_UA,
            'Accept': 'text/html,application/xhtml+xml',
            'Cookie': cookie
        },
        signal: AbortSignal.timeout(20000)
    });
    if (!resp.ok) {
        throw new Error(`Kunne ikke hente turneringsside (HTTP ${resp.status})`);
    }
    const html = await resp.text();
    const isWall = html.includes('class="message-page__modal"') && html.includes('cookiewall');
    // Hvis vi stadig får cookie-wall-siden, prøv at re-etablere consent én gang
    if (isWall && _retry < 1) {
        return fetchTournamentPage(tournamentId, subPage, _retry + 1);
    }
    return html;
}

// Decode de almindelige HTML-entiteter vi ser i navne
function decodeHtmlEntities(s) {
    if (!s) return s;
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// Træk turneringsnavn fra <title>...</title> eller <h2 class="hgroup__heading">
function parseTournamentName(html) {
    const h2 = html.match(/<h2[^>]*class="[^"]*hgroup__heading[^"]*"[^>]*>\s*([^<]+?)\s*<\/h2>/);
    if (h2) return decodeHtmlEntities(h2[1]).trim();
    const title = html.match(/<title>\s*([^<|]+?)\s*(?:\||<)/i);
    if (title) return decodeHtmlEntities(title[1]).trim();
    return '';
}

// Parser dag-tabs fra Matches-siden — strukturen er <a data-value="YYYYMMDD">
// med en <time datetime="YYYY-MM-DDTHH:MM:SS"> indeni + dansk dato-display.
// Returnerer liste af {date: "YYYY-MM-DD", value: "YYYYMMDD", label: "lø 30. maj"}
function parseTournamentDays(html) {
    const days = [];
    const tabRegex = /<a[^>]*data-value="(\d{8})"[^>]*data-href="[^"]*MatchesInDay[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = tabRegex.exec(html)) !== null) {
        const value = m[1]; // YYYYMMDD
        const inner = m[2];
        const isoDate = `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}`;

        // Træk display-fragmenter ud af <time>-elementet
        const weekday = (inner.match(/class="date__weekday"[^>]*>([^<]+)</)?.[1] || '').trim();
        const day = (inner.match(/class="date__day"[^>]*>([^<]+)</)?.[1] || '').trim();
        const month = (inner.match(/class="date__month"[^>]*>([^<]+)</)?.[1] || '').trim();

        const label = [decodeHtmlEntities(weekday), day && `${day}.`, decodeHtmlEntities(month)]
            .filter(Boolean)
            .join(' ');

        if (!days.find(d => d.value === value)) {
            days.push({ date: isoDate, value, label: label || isoDate });
        }
    }
    return days;
}

// Parser hele Matches-siden — returnerer en liste af kampe.
// HTML-strukturen er konsistent: hver kamp er i <div class="match match--list"> med
// to <div class="match__row">-sektioner (én per side), og hver række har 1-2
// <a data-player-id="..."><span class="nav-link__value">NAVN</span></a>.
function parseMatchesHtml(html) {
    const matches = [];
    const chunks = html.split('<div class="match match--list">').slice(1);

    for (const chunk of chunks) {
        // Begræns til denne match-blok. Vi splittede allerede på match__list-opener,
        // så chunk indeholder denne match + start af næste matchs <li>-wrapper. Cut'er
        // ved den næste match-group__item så vi ikke ved en fejl plukker den næste
        // match's header op. (NB: kan IKKE bruge </li> som markør — match-headeren har
        // selv interne <li>-items.)
        const nextWrapperIdx = chunk.indexOf('<li class="match-group__item">');
        const block = nextWrapperIdx > -1 ? chunk.substring(0, nextWrapperIdx) : chunk;

        // Header indeholder kategori + runde
        const bodyStart = block.indexOf('<div class="match__body">');
        const header = bodyStart > -1 ? block.substring(0, bodyStart) : block;
        const body = bodyStart > -1 ? block.substring(bodyStart) : '';

        // Kategori — første nav-link__value i headeren (peger på draw-linket)
        const categoryMatch = header.match(/class="nav-link__value">\s*([^<]+?)\s*<\/span>/);
        const category = categoryMatch ? decodeHtmlEntities(categoryMatch[1]).trim() : '';

        // Draw-id — TS eksponerer intet per-kamp GUID, men hver kamp-header linker til
        // sin draw (pulje/lodtrækning) via draw.aspx?...&draw=NN. draw er globalt unikt
        // pr. turnering, og sammen med runde + ordinal udgør det vores stabile join-nøgle
        // ved gen-import. &amp; pga. HTML-escaping i href.
        const drawMatch = header.match(/draw\.aspx\?id=[^"&]+&(?:amp;)?draw=(\d+)/);
        const drawId = drawMatch ? drawMatch[1] : '';

        // Runde — round-spanet har strukturen <span title="X" class="nav-link"><span class="nav-link__value">
        // Dette mønster matcher KUN round-spanet og IKKE venue-spanet (venuen har class før title
        // og flere klasse-navne). Dækker "Runde 1/2/3", "1/8", "Kvartfinale", "Semifinale", "Finale" osv.
        const roundMatch = header.match(/<span title="([^"]+)" class="nav-link"><span class="nav-link__value">/);
        const round = roundMatch ? decodeHtmlEntities(roundMatch[1]).trim() : '';

        // Find positionerne af side 1 og side 2's match__row åbnere
        const rowOpener = /<div class="match__row\s/g;
        const rowPositions = [];
        let m;
        while ((m = rowOpener.exec(body)) !== null) {
            rowPositions.push(m.index);
            if (rowPositions.length >= 2) break;
        }
        if (rowPositions.length < 2) continue;

        // Side 1: fra første row til anden row
        const side1Section = body.substring(rowPositions[0], rowPositions[1]);
        // Side 2: fra anden row til match__result / match__btn / match__footer / match__row-wrapper-end
        const candidateEnds = ['<div class="match__result"', '<div class="match__btn"', '<div class="match__footer"'];
        let side2End = body.length;
        for (const marker of candidateEnds) {
            const idx = body.indexOf(marker, rowPositions[1]);
            if (idx > -1 && idx < side2End) side2End = idx;
        }
        const side2Section = body.substring(rowPositions[1], side2End);

        const side1Full = extractPlayers(side1Section);
        const side2Full = extractPlayers(side2Section);
        const side1Players = side1Full.map(p => p.name);
        const side2Players = side2Full.map(p => p.name);

        // Vi importerer ALLE kampe — inkl. semi/finaler hvor spillerne endnu ikke er kendt
        // (TBD/placeholder-kampe). Brugeren kan så redigere navnene løbende når de afgøres.

        // Bestem doubles ud fra kategori-suffix (HD/DD/MD) — kan ikke baseres på antal
        // spillere når sliderne er tomme i placeholder-kampe
        const isDoubles = /\b(HD|DD|MD)\b/i.test(category) ||
                         (side1Players.length >= 2 || side2Players.length >= 2);

        matches.push({
            category,
            round,
            drawId,
            doubles: isDoubles,
            side1Player1: side1Players[0] || '',
            side1Player2: side1Players[1] || '',
            side2Player1: side2Players[0] || '',
            side2Player2: side2Players[1] || '',
            side1: side1Full,
            side2: side2Full
        });
    }

    return matches;
}

// Træk spillernavne ud af en match__row-sektion. Kun navne i anchors med data-player-id —
// det filtrerer "Bye"-tekster og lignende ud fordi de ikke har player-anchor.
// Træk spillere (navn + player-id + club-id) ud af en match__row-sektion.
// club-id kan være tom (=> ingen klub for spilleren).
function extractPlayers(section) {
    const players = [];
    const re = /data-player-id="(\d+)"[^>]*?data-club-id="(\d*)"[^>]*>\s*<span class="nav-link__value">\s*([^<]+?)\s*<\/span>/g;
    let m;
    while ((m = re.exec(section)) !== null) {
        const name = decodeHtmlEntities(m[3]).trim();
        if (name && !players.some(p => p.name === name)) {
            players.push({ name, playerId: m[1], clubId: m[2] || '' });
        }
    }
    return players;
}

// Bagudkompatibel: kun navne (bruges af den eksisterende flad-felt-mapping)
function extractPlayerNames(section) {
    return extractPlayers(section).map(p => p.name);
}

// Beregn en stabil sourceMatchId pr. kamp: "draw#runde#ordinal". ordinal er kampens
// løbenummer indenfor (draw, runde) i kilde-rækkefølgen over HELE turneringen, så den er
// ens ved import og senere gen-import (sync). Falder tilbage til kategori hvis draw mangler.
// Muterer matches in-place (sætter m.sourceMatchId) og returnerer samme array.
function assignSourceMatchIds(matches) {
    const ordinalCounters = new Map();
    for (const m of matches) {
        const scope = `${m.drawId || m.category || '?'}#${m.round || '?'}`;
        const ord = ordinalCounters.get(scope) || 0;
        ordinalCounters.set(scope, ord + 1);
        m.sourceMatchId = `${scope}#${ord}`;
    }
    return matches;
}

// Genbrugelig kerne: hent + parse alle kampe for en TS-turnering på tværs af alle dage.
// Bruges både af /preview (import) og af tournaments.js' sync-import (gen-import).
// Returnerer { tournamentName, days, matches } hvor hver match har sourceMatchId.
async function fetchAndParseTournamentMatches(tournamentId) {
    // Hent Matches-siden — bruges til at extrahere turneringsnavn + liste af dage.
    // OBS: /Matches defaulter til dag 1's kampe, så vi henter eksplicit per-dag bagefter
    // for at få ALLE kampe på tværs af multi-day turneringer.
    const mainHtml = await fetchTournamentPage(tournamentId, 'Matches');
    const tournamentName = parseTournamentName(mainHtml);
    const days = parseTournamentDays(mainHtml);

    let allMatches = [];

    if (days.length === 0) {
        // Ingen dag-tabs (måske kun én dag uden tab-UI) — parser main-siden direkte
        allMatches = parseMatchesHtml(mainHtml);
    } else {
        // Hent hver dag parallelt og tag kampene med deres dag
        const dayHtmls = await Promise.all(
            days.map(d => fetchTournamentPage(tournamentId, `matches/${d.value}`))
        );
        for (let i = 0; i < days.length; i++) {
            const dayMatches = parseMatchesHtml(dayHtmls[i]);
            const tagged = dayMatches.map(m => ({ ...m, day: days[i].date, dayLabel: days[i].label }));
            allMatches.push(...tagged);
        }
    }

    assignSourceMatchIds(allMatches);
    return { tournamentName, days, matches: allMatches };
}

// POST /api/import/tournament/preview
// Body: { url } — URL fra tournamentsoftware.com (eller bare UUID)
// Returnerer: { tournamentName, matchCount, matches: [...], days: [{date, value, label}] }
router.post('/preview', authMiddleware, async (req, res, next) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL er påkrævet' });
        }

        const tournamentId = extractTournamentId(url);
        if (!tournamentId) {
            return res.status(400).json({
                error: 'Kunne ikke finde turnerings-ID i URL — kopiér linket direkte fra tournamentsoftware.com'
            });
        }

        const { tournamentName, days, matches: allMatches } = await fetchAndParseTournamentMatches(tournamentId);

        if (allMatches.length === 0) {
            return res.status(404).json({
                error: 'Ingen kampe fundet på siden — er turneringen offentliggjort, og er der lavet lodtrækninger?'
            });
        }

        res.json({
            tournamentId,
            tournamentName,
            matchCount: allMatches.length,
            days, // tom array hvis kun én dag uden tabs
            matches: allMatches
        });
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return res.status(504).json({ error: 'Forbindelsen til tournamentsoftware.com timed out — prøv igen' });
        }
        console.error('Tournament import preview failed:', error);
        res.status(502).json({ error: error.message || 'Import-preview fejlede' });
    }
});

// Slå klubnavne op for de distinkte club-id'er i en turnerings kampe.
// TS' kampliste har kun et turnerings-lokalt club-id; klubnavnet hentes fra
// klub-siden /tournament/<id>/club/<cid>, hvor <title> har formen
// "... - Klub: <Klubnavn> (<nr>) - Oversigt". (Spillerens profilside dur IKKE:
// dens overskrift er turneringens arrangoer-branding, ens for alle spillere.)
// Returnerer Map<clubId, clubName>.
async function resolveClubNames(tournamentId, matches) {
    const clubIds = new Set();
    for (const m of matches) {
        for (const p of [...(m.side1 || []), ...(m.side2 || [])]) {
            if (p.clubId) clubIds.add(p.clubId);
        }
    }

    const ids = [...clubIds];
    const results = await Promise.all(ids.map(async (clubId) => {
        try {
            const html = await fetchTournamentPage(tournamentId, `club/${clubId}`);
            const m = html.match(/<title>[^<]*\bKlub:\s*(.+?)\s*\(\d+\)/i);
            const club = m ? decodeHtmlEntities(m[1]).trim() : '';
            return [clubId, club];
        } catch (e) {
            console.error(`Klubnavn-opslag fejlede for club-id ${clubId}:`, e.message);
            return [clubId, ''];
        }
    }));

    const map = new Map();
    for (const [clubId, club] of results) if (club) map.set(clubId, club);
    return map;
}

// Byg name->club-rækker (dedup pr. player_name) ud fra kampe + clubId->navn-map.
function buildPlayerClubRows(matches, clubIdToName) {
    const byName = new Map();
    for (const m of matches) {
        for (const p of [...(m.side1 || []), ...(m.side2 || [])]) {
            const club = p.clubId ? clubIdToName.get(p.clubId) : null;
            if (p.name && club && !byName.has(p.name)) {
                byName.set(p.name, { player_name: p.name, club, source_player_id: p.playerId || null });
            }
        }
    }
    return [...byName.values()];
}

module.exports = router;
// Eksportér genbrugskernen som property på routeren (routeren er en funktion, så
// app.use('/api/import/tournament', require(...)) virker stadig).
module.exports.fetchAndParseTournamentMatches = fetchAndParseTournamentMatches;
module.exports.extractTournamentId = extractTournamentId;
module.exports.resolveClubNames = resolveClubNames;
module.exports.buildPlayerClubRows = buildPlayerClubRows;
