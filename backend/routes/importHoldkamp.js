'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { requirePage } = require('../middleware/pagePermission');
const { query, queryOne } = require('../config/database');

const SERVICE_URL  = 'https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetLeagueStanding';
const CONTEXT_PAGE = 'https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/';
const BROWSER_UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Fælles fartgrænse mod badmintonplayer.dk: højst 2 kald i sekundet fra hele
// serveren, uanset hvor mange klubber og holdkampe der venter på samme tid.
// Alle kald herfra (vagten, "Tjek nu" og manuel import) går gennem bpTur(),
// som reserverer næste ledige tidspunkt — så en travl lørdag giver en jævn
// række kald og aldrig en byge, der kunne få hele serverens IP blokeret.
const BP_MIN_AFSTAND_MS = 500;
let _bpNaesteLedig = 0;

async function bpTur() {
    const nu = Date.now();
    const start = Math.max(nu, _bpNaesteLedig);
    _bpNaesteLedig = start + BP_MIN_AFSTAND_MS; // reserveres synkront → sikkert ved samtidige kald
    if (start > nu) await new Promise(r => setTimeout(r, start - nu));
}

// Cache context key for 10 minutes — avoids hammering the site
let _contextKey = null;
let _contextKeyExpires = 0;

async function getContextKey(force = false) {
    if (!force && _contextKey && Date.now() < _contextKeyExpires) return _contextKey;
    await bpTur();
    const resp = await fetch(CONTEXT_PAGE, {
        headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) throw new Error(`Kunne ikke kontakte badmintonplayer.dk (HTTP ${resp.status})`);
    const html = await resp.text();
    const m = html.match(/var SR_CallbackContext\s*=\s*'([^']+)'/);
    if (!m) throw new Error('Sikkerhedstoken ikke fundet på badmintonplayer.dk');
    _contextKey = m[1];
    _contextKeyExpires = Date.now() + 10 * 60 * 1000;
    return _contextKey;
}

function parseHashParams(url) {
    const idx = url.indexOf('#');
    if (idx === -1) throw new Error('URL mangler #-parametre — brug linket direkte fra badmintonplayer.dk');
    const parts = url.substring(idx + 1).split(',');
    if (parts.length < 7) throw new Error('URL-format ukendt — er linket kopieret korrekt?');
    return {
        subPage:           parts[0] || '5',
        seasonID:          parts[1] || '',
        leagueGroupID:     parts[2] || '',
        ageGroupID:        parts[3] || '',
        regionID:          parts[4] || '',
        leagueGroupTeamID: parts[5] || '',
        leagueMatchID:     parts[6] || '',
        clubID:            parts[7] || '0',
    };
}

async function fetchMatchHtml(contextKey, params) {
    await bpTur();
    const resp = await fetch(SERVICE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': BROWSER_UA,
        },
        body: JSON.stringify({
            callbackcontextkey: contextKey,
            subPage:             params.subPage,
            seasonID:            params.seasonID,
            leagueGroupID:       params.leagueGroupID,
            ageGroupID:          params.ageGroupID,
            regionID:            params.regionID,
            leagueGroupTeamID:   params.leagueGroupTeamID,
            leagueMatchID:       params.leagueMatchID,
            clubID:              params.clubID,
            playerID:            '0',
        }),
        signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`Kamp-API svarede med HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data?.d?.html) throw new Error('Uventet svar fra badmintonplayer.dk — tjek at linket peger på en holdkamp');
    return data.d.html;
}

// ── HTML parsing helpers ────────────────────────────────────────────────────

function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').replace(/&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/&aelig;/g, 'æ').replace(/&oslash;/g, 'ø').replace(/&aring;/g, 'å')
        .replace(/&AElig;/g, 'Æ').replace(/&Oslash;/g, 'Ø').replace(/&Aring;/g, 'Å')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function textOf(html) {
    return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Som textOf, men linjeskift bliver til komma — fx en adresse over flere <br>. */
function textOfLinjer(html) {
    const MARKOER = '@@LINJE@@';
    return textOf(String(html).replace(/<br\s*\/?>/gi, MARKOER))
        .split(MARKOER).map(s => s.trim()).filter(Boolean).join(', ');
}

// "1. MD" → "MD", "1. S" → "Single", "1. D" → "Double", "Golden Set" → null
function mapCategory(raw) {
    const m = raw.match(/^\d+\.\s*([A-Za-z]{1,4})$/);
    if (!m) return null;
    const c = m[1].toUpperCase();
    if (c === 'S') return 'Single';
    if (c === 'D') return 'Double';
    return c; // MD, DS, HS, DD, HD
}

// Formatgenkendelse (også 4 piger, U9 3 spillere og 8-kamps-varianten) ligger
// i config/holdkampFormater.js sammen med reglerne for formaterne.
const { detectFormat } = require('../config/holdkampFormater');

/**
 * Kampinfo-tabellen. Den findes ogsaa foer holdsedlen er frigivet, og det er
 * den der goer automatikken mulig: starttidspunktet staar der fra det oejeblik
 * kampen er sat i kalenderen.
 *
 *   Tid        = "lø 05-09-2026 16:00"
 *   Hjemmehold = <a class='team'>Drive</a><br />Line Broen M<br />mail<br />tlf
 *
 * Holdnavnet tages kun fra <a>-elementet. Resten af cellen er holdlederens
 * navn, mail og telefonnummer, og dem har vi ingen grund til at gemme.
 */
function parseMatchInfo(html) {
    const info = {};
    const tabelM = html.match(/<table[^>]*class=["']matchinfo["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tabelM) return info;

    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowM;
    while ((rowM = rowRe.exec(tabelM[1])) !== null) {
        const celler = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdM;
        while ((tdM = tdRe.exec(rowM[1])) !== null) celler.push(tdM[1]);
        if (celler.length < 2) continue;

        const label = textOf(celler[0]);
        const raa = celler[1];

        if (/^Tid$/i.test(label))        info.tid = parseDanskTid(textOf(raa));
        else if (/^Kampnr$/i.test(label)) info.kampnr = textOf(raa);
        else if (/^Spillested$/i.test(label)) info.spillested = textOfLinjer(raa);
        else if (/^Hjemmehold$/i.test(label)) info.team1Name = holdNavnAf(raa);
        else if (/^Udehold$/i.test(label))    info.team2Name = holdNavnAf(raa);
    }
    return info;
}

function holdNavnAf(cellHtml) {
    const m = cellHtml.match(/<a[^>]*class=["']team["'][^>]*>([\s\S]*?)<\/a>/i);
    if (m) return decodeEntities(textOf(m[1]));
    // Falder tilbage til foerste linje, hvis markup'en skifter
    return textOf(cellHtml.split(/<br\s*\/?>/i)[0] || '');
}

// Badmintonplayer angiver tider som dansk vægur (Europe/Copenhagen). Vi gemmer
// dem i UTC (DATETIME: start_time, last_checked_at) og sammenligner i SQL med
// UTC_TIMESTAMP() — ikke NOW(), som følger databasens tidszone: står den ikke
// på UTC, blev kampe før opgivet to timer for tidligt ("Kom aldrig").
// TIMESTAMP-kolonner (created_at, updated_at) følger selv databasens tidszone
// og sammenlignes fortsat med NOW(). Uafhængigt af serverens egen tidszone.

/** Tidszone-offset (ms, positiv = foran UTC) for en zone på et givet tidspunkt. */
function tzOffsetMs(tz, dato) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const del = {};
    for (const p of dtf.formatToParts(dato)) if (p.type !== 'literal') del[p.type] = p.value;
    const somUtc = Date.UTC(+del.year, +del.month - 1, +del.day, +del.hour, +del.minute, +del.second);
    return somUtc - dato.getTime();
}

/** Dansk vægur (Y, 0-indekseret måned, D, t, m) → UTC-instant (Date). */
function danskVaeggurTilUtc(Y, Mo, D, t, mi) {
    const gaet = Date.UTC(Y, Mo, D, t, mi, 0);
    // Ét pas rammer rigtigt undtagen i selve DST-skiftetimen; et ekstra pas med
    // offset målt på det foreløbige instant håndterer også den kant.
    let off = tzOffsetMs('Europe/Copenhagen', new Date(gaet));
    off = tzOffsetMs('Europe/Copenhagen', new Date(gaet - off));
    return new Date(gaet - off);
}

/** "lø 05-09-2026 16:00" → UTC-instant (Date). */
function parseDanskTid(s) {
    const m = String(s || '').match(/(\d{2})[-.](\d{2})[-.](\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?/);
    if (!m) return null;
    const d = danskVaeggurTilUtc(
        Number(m[3]), Number(m[2]) - 1, Number(m[1]),
        m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0
    );
    return isNaN(d.getTime()) ? null : d;
}

/** MySQL DATETIME i UTC — sammenlignes med UTC_TIMESTAMP() (se ovenfor). */
function tilMysqlDato(d) {
    if (!d) return null;
    const p = n => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00`;
}

function parseMatchHtml(html) {
    // ── Team names from <tr class='toprow'> ──────────────────────────────
    let team1Name = '', team2Name = '';
    const topM = html.match(/<tr[^>]*class=["']toprow["'][^>]*>([\s\S]*?)<\/tr>/i);
    if (topM) {
        const texts = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdM;
        while ((tdM = tdRe.exec(topM[1])) !== null) {
            const t = textOf(tdM[1]);
            // Accept team names: at least 2 chars, not just a score like "21-15"
            if (t && t.length >= 2 && !/^\d+[-:]\d+$/.test(t)) texts.push(t);
        }
        if (texts.length >= 2) [team1Name, team2Name] = texts;
        else if (texts.length === 1) team1Name = texts[0];
    }

    // ── Game rows: each has <td class='discipline'> ───────────────────────
    const games = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowM;
    while ((rowM = rowRe.exec(html)) !== null) {
        const row = rowM[1];

        const discM = row.match(/<td[^>]*class=["']discipline["'][^>]*>([\s\S]*?)<\/td>/i);
        if (!discM) continue;

        const category = mapCategory(textOf(discM[1]));
        if (!category) continue; // skip Golden Set etc.

        // Collect player/playerwinner cells in DOM order (team1 = first, team2 = second)
        const cells = [];
        const cellRe = /<td[^>]*class=["'](?:player|playerwinner)["'][^>]*>([\s\S]*?)<\/td>/gi;
        let cellM;
        while ((cellM = cellRe.exec(row)) !== null) cells.push(cellM[1]);

        const extractNames = cellHtml => {
            const ns = [];
            const aRe = /<a[^>]*>([^<]+)<\/a>/gi;
            let aM;
            while ((aM = aRe.exec(cellHtml)) !== null) {
                const name = decodeEntities(aM[1]).trim();
                if (name) ns.push(name);
            }
            return ns;
        };

        const t1 = cells[0] ? extractNames(cells[0]) : [];
        const t2 = cells[1] ? extractNames(cells[1]) : [];

        games.push({
            category,
            team1Player1:  t1[0] || '',
            team1Player2:  t1[1] || null,
            team2Player1:  t2[0] || '',
            team2Player2:  t2[1] || null,
        });
    }

    return { team1Name, team2Name, format: detectFormat(games), games };
}

/**
 * Henter én kamp og returnerer baade kampinfo og holdseddel.
 * Bruges baade af ruten og af den automatiske overvaagning.
 */
async function hentKamp(url) {
    const params = parseHashParams(url);
    if (!params.leagueMatchID) {
        const err = new Error('Kamp-ID mangler i URL\'en');
        err.status = 400;
        throw err;
    }

    let contextKey = await getContextKey();
    let html = await fetchMatchHtml(contextKey, params);
    let info = parseMatchInfo(html);
    let seddel = parseMatchHtml(html);

    // Var token forældet, faar vi hverken kampinfo eller holdseddel — prøv igen
    if (!info.kampnr && !seddel.team1Name) {
        contextKey = await getContextKey(true);
        html = await fetchMatchHtml(contextKey, params);
        info = parseMatchInfo(html);
        seddel = parseMatchHtml(html);
    }

    return { params, info, seddel };
}

// ── Log for holdkamp-køen ────────────────────────────────────────────────────
// Hvert tjek og hver hændelse skrives i holdkamp_vagt_log (migration 030), så
// admin kan se i bunden af Holdkamp-siden, hvad der skete med en kamp — uden
// adgang til serverens log. Loggen må aldrig vælte vagten: fejl ignoreres.

const { currentTenant } = require('../config/tenantPools');
const _sidsteGennemloeb = new Map();   // tenant → ms for vagtens seneste gennemløb
const _sidsteOprydning = new Map();    // tenant → ms for seneste sletning af gamle rækker

const danskTid = (d) => d ? new Date(d).toLocaleString('da-DK', {
    timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
}) : 'ukendt';

async function vagtLog(w, niveau, besked) {
    try {
        await query(
            'INSERT INTO holdkamp_vagt_log (watcher_id, league_match_id, niveau, besked) VALUES (?, ?, ?, ?)',
            [w ? w.id || null : null, w ? w.league_match_id || null : null, niveau, String(besked).slice(0, 600)]
        );
    } catch (e) { /* fx før migration 030 er kørt */ }
}

/** Hvad badmintonplayer svarede — kort, til loggen. */
function svarBeskrivelse(info, seddel) {
    const dele = [];
    dele.push(info.kampnr ? `kampinfo fundet (kampnr ${info.kampnr})` : 'INGEN kampinfo i svaret');
    dele.push(`kamptid ${info.tid ? danskTid(info.tid) : 'ukendt'}`);
    dele.push(`hold: ${seddel.team1Name || '–'} / ${seddel.team2Name || '–'}`);
    dele.push(`${seddel.games.length} delkampe`);
    return dele.join(', ');
}

// ── Ruter ────────────────────────────────────────────────────────────────────

// GET /api/import/holdkamp-vagt-log — loggen + en lille diagnose af vagten
// (kører den, og går databasens ur rigtigt? En database der ikke kører UTC får
// kampe til at blive opgivet to timer for tidligt).
router.get('/holdkamp-vagt-log', authMiddleware, requirePage('holdkamp'), async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 300, 1), 1000);
        const watcherId = parseInt(req.query.watcher, 10) || null;
        const ur = await queryOne('SELECT NOW() AS nu, UTC_TIMESTAMP() AS utc, @@session.time_zone AS tz');
        const afvigelseMin = ur ? Math.round((new Date(ur.nu) - new Date(ur.utc)) / 60000) : null;
        const sidst = _sidsteGennemloeb.get(currentTenant());
        let log = [];
        try {
            log = await query(
                `SELECT l.id, UNIX_TIMESTAMP(l.tid) AS tid_unix, l.watcher_id, l.league_match_id,
                        l.niveau, l.besked, w.team1_name, w.team2_name
                   FROM holdkamp_vagt_log l
                   LEFT JOIN holdkamp_watchers w ON w.id = l.watcher_id
                  ${watcherId ? 'WHERE l.watcher_id = ?' : ''}
                  ORDER BY l.id DESC LIMIT ${limit}`,
                watcherId ? [watcherId] : []
            );
        } catch (e) { /* tabellen findes ikke endnu */ }
        res.json({
            diagnose: {
                serverTid: new Date().toISOString(),
                databaseNu: ur && ur.nu, databaseUtc: ur && ur.utc, databaseTidszone: ur && ur.tz,
                databaseAfvigelseMin: afvigelseMin,
                vagtSidstKoertSekSiden: sidst ? Math.round((Date.now() - sidst) / 1000) : null
            },
            log
        });
    } catch (error) { next(error); }
});

/**
 * POST /api/import/holdkamp-url
 *
 * Er holdsedlen frigivet, svarer vi som hidtil med hold og delkampe, saa admin
 * faar sit preview. Er den ikke, sætter vi kampen under overvaagning i stedet
 * for at afvise linket — holdsedlen frigives typisk foerst en time foer start.
 */
router.post('/holdkamp-url', authMiddleware, requirePage('holdkamp'), async (req, res, next) => {
    try {
        const { url } = req.body;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL mangler' });
        }
        if (!url.includes('badmintonplayer.dk')) {
            return res.status(400).json({ error: 'Kun links fra badmintonplayer.dk understøttes' });
        }

        const { params, info, seddel } = await hentKamp(url);

        // Holdsedlen er klar → som før
        if (seddel.team1Name && seddel.team2Name && seddel.games.length > 0) {
            return res.json({ success: true, pending: false, ...seddel });
        }

        // Ellers: kender vi tidspunktet, kan vi hente den selv når den kommer
        const team1 = info.team1Name || seddel.team1Name || '';
        const team2 = info.team2Name || seddel.team2Name || '';

        if (!info.tid) {
            return res.status(422).json({
                error: 'Hverken holdsammensætning eller kamptidspunkt kunne læses — er linket kopieret fra en holdkamp på badmintonplayer.dk?'
            });
        }

        await query(
            `INSERT INTO holdkamp_watchers
               (league_match_id, url, team1_name, team2_name, venue, start_time, status, last_checked_at, last_error, team_match_id)
             VALUES (?, ?, ?, ?, ?, ?, 'venter', UTC_TIMESTAMP(), NULL, NULL)
             ON DUPLICATE KEY UPDATE
               url = VALUES(url), team1_name = VALUES(team1_name), team2_name = VALUES(team2_name),
               venue = VALUES(venue), start_time = VALUES(start_time),
               status = 'venter', last_checked_at = UTC_TIMESTAMP(), last_error = NULL, team_match_id = NULL`,
            [params.leagueMatchID, url, team1, team2, info.spillested || null, tilMysqlDato(info.tid)]
        );

        const watcher = await queryOne(
            `SELECT *, DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i:00Z') AS start_time_iso
               FROM holdkamp_watchers WHERE league_match_id = ?`,
            [params.leagueMatchID]
        );
        await vagtLog(watcher, 'info',
            `Sat i kø: ${team1} – ${team2}, kampstart ${danskTid(info.tid)}. `
            + `Første tjek ${danskTid(vagt.foersteTjek(info.tid))}. (${svarBeskrivelse(info, seddel)})`);

        res.json({
            success: true,
            pending: true,
            team1Name: team1,
            team2Name: team2,
            venue: info.spillested || null,
            startTime: info.tid.toISOString(),
            watcher
        });
    } catch (err) {
        console.error('[importHoldkamp]', err.message);
        if (err.status) return res.status(err.status).json({ error: err.message });
        if (err.name === 'TimeoutError' || (err.cause && err.cause.code === 'UND_ERR_CONNECT_TIMEOUT')) {
            return res.status(504).json({ error: 'Timeout — badmintonplayer.dk svarer ikke' });
        }
        next(err);
    }
});

// GET /api/import/holdkamp-watchers — kampe der venter på holdsammensætningen
router.get('/holdkamp-watchers', authMiddleware, requirePage('holdkamp'), async (req, res, next) => {
    try {
        // start_time gemmes i UTC; vi sender det med et eksplicit 'Z', så
        // browseren selv omregner til dansk tid ved visning.
        const raekker = await query(
            `SELECT *, DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i:00Z') AS start_time_iso
               FROM holdkamp_watchers
              WHERE status = 'venter'
                 OR updated_at > DATE_SUB(NOW(), INTERVAL 12 HOUR)
              ORDER BY start_time IS NULL, start_time ASC`
        );
        const nu = new Date();
        res.json(raekker.map(w => medTidsplan(w, nu)));
    } catch (error) { next(error); }
});

// POST /api/import/holdkamp-watchers/:id/check — "Tjek nu": samme tjek som
// vagten laver, bare med det samme. Flytter ikke vagtens 30-sekunders gitter.
router.post('/holdkamp-watchers/:id/check', authMiddleware, requirePage('holdkamp'), async (req, res, next) => {
    try {
        const hent = () => queryOne(
            `SELECT *, DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i:00Z') AS start_time_iso
               FROM holdkamp_watchers WHERE id = ?`,
            [req.params.id]
        );
        const w = await hent();
        if (!w) return res.status(404).json({ error: 'Overvågningen findes ikke' });
        if (w.status !== 'venter') {
            return res.json({ udfald: w.status === 'oprettet' ? 'oprettet' : 'lukket', watcher: medTidsplan(w) });
        }
        const r = await tjekWatcher(w, { kilde: 'manuel' });
        res.json({ ...r, watcher: medTidsplan(await hent()) });
    } catch (error) { next(error); }
});

// DELETE /api/import/holdkamp-watchers/:id — stop overvågningen af én kamp
router.delete('/holdkamp-watchers/:id', authMiddleware, requirePage('holdkamp'), async (req, res, next) => {
    try {
        const w = await queryOne('SELECT id, league_match_id, team1_name, team2_name, status FROM holdkamp_watchers WHERE id = ?', [req.params.id]);
        const r = await query('DELETE FROM holdkamp_watchers WHERE id = ?', [req.params.id]);
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Overvågningen findes ikke' });
        await vagtLog(w, 'info', `${w.status === 'venter' ? 'Stoppet' : 'Fjernet fra listen'} af admin: ${w.team1_name} – ${w.team2_name}`);
        res.json({ success: true });
    } catch (error) { next(error); }
});

// ── Automatisk hentning ──────────────────────────────────────────────────────

// Tidsplanen (første tjek 59 min 50 sek før start, hvert 30. sekund i 10 minutter, derefter hvert 2. minut)
// ligger i config/holdkampVagt.js, så den kan unit-testes uden database.
const vagt = require('../config/holdkampVagt');

/** Tilføjer tjek-tidspunkter og nedtælling til en watcher-række (til admin). */
function medTidsplan(w, nu = new Date()) {
    const iso = (d) => (d ? new Date(d).toISOString() : null);
    const venter = w.status === 'venter';
    return {
        ...w,
        last_checked_iso: iso(w.last_checked_at),
        next_check_iso: venter ? vagt.naesteTjek(w, nu).toISOString() : null,
        seconds_to_next: venter ? vagt.sekunderTilNaeste(w, nu) : null,
        first_check_iso: iso(vagt.foersteTjek(w.start_time))
    };
}

/**
 * Tjekker én kamp hos badmintonplayer og opretter holdkampen, hvis holdsedlen
 * er frigivet. Bruges både af den automatiske vagt og af "Tjek nu"-knappen.
 *
 * Kampen "tages" først med en atomar opdatering af last_checked_at, så to
 * samtidige tjek (vagten og knappen, eller to gennemløb) aldrig opretter
 * holdkampen to gange.
 *
 * Returnerer { udfald: 'oprettet' | 'ikke_frigivet' | 'fejl' | 'optaget', ... }.
 */
async function tjekWatcher(w, { kilde = 'auto' } = {}) {
    const taget = await query(
        `UPDATE holdkamp_watchers SET last_checked_at = UTC_TIMESTAMP()
          WHERE id = ? AND status = 'venter' AND last_checked_at <=> ?`,
        [w.id, w.last_checked_at || null]
    );
    if (taget.affectedRows === 0) return { udfald: 'optaget' };
    const hvem = kilde === 'manuel' ? 'Tjek nu' : 'Tjek';

    try {
        const { info, seddel } = await hentKamp(w.url);

        if (!seddel.team1Name || !seddel.team2Name || seddel.games.length === 0) {
            // Ikke frigivet endnu. Kamptidspunktet genlæses hver gang, så en
            // flyttet kamp får sit vindue på det rigtige tidspunkt.
            await query(
                `UPDATE holdkamp_watchers SET last_error = NULL, start_time = COALESCE(?, start_time) WHERE id = ?`,
                [tilMysqlDato(info.tid), w.id]
            );
            const flyttet = info.tid && w.start_time && new Date(w.start_time).getTime() !== info.tid.getTime();
            if (flyttet) {
                console.log(`[holdkamp-watch] kamp ${w.league_match_id}: kamptidspunktet er ændret til ${info.tid.toISOString()}`);
            }
            const naeste = vagt.naesteTjek({ ...w, start_time: info.tid || w.start_time, last_checked_at: new Date() });
            await vagtLog(w, 'info',
                `${hvem}: holdsedlen er ikke frigivet endnu (${svarBeskrivelse(info, seddel)}).`
                + (flyttet ? ` Kamptidspunktet er ændret fra ${danskTid(w.start_time)} til ${danskTid(info.tid)}.` : '')
                + ` Næste tjek ${danskTid(naeste)}.`);
            return { udfald: 'ikke_frigivet' };
        }

        const { opretHoldkamp } = require('./teamMatches');
        const teamMatchId = await opretHoldkamp({
            format: seddel.format,
            team1Name: seddel.team1Name,
            team2Name: seddel.team2Name,
            games: seddel.games
        });

        await query(
            `UPDATE holdkamp_watchers SET status = 'oprettet', team_match_id = ?, last_error = NULL WHERE id = ?`,
            [teamMatchId, w.id]
        );
        console.log(`✓ Holdkamp hentet ${kilde === 'manuel' ? 'manuelt' : 'automatisk'}: ${seddel.team1Name} – ${seddel.team2Name} (kamp ${w.league_match_id})`);
        await vagtLog(w, 'info',
            `${hvem}: holdsedlen er frigivet — holdkampen er oprettet (${seddel.team1Name} – ${seddel.team2Name}, `
            + `format ${seddel.format}, ${seddel.games.length} delkampe).`);
        return { udfald: 'oprettet', teamMatchId };
    } catch (err) {
        // En turnering kan blokere oprettelsen. Holdsedlen er der, men vi kan
        // ikke oprette — markér som fejl så admin kan gøre det manuelt. Alle
        // andre fejl (netværk, timeout) prøves igen ved næste tjek.
        const blokeret = err.status === 409;
        const besked = String(err.message || err).slice(0, 400);
        await query(
            `UPDATE holdkamp_watchers SET last_error = ?, status = ? WHERE id = ?`,
            [besked, blokeret ? 'fejl' : 'venter', w.id]
        );
        console.error(`[holdkamp-watch] kamp ${w.league_match_id}: ${err.message}`);
        const aarsag = err.name === 'TimeoutError' ? ' (badmintonplayer.dk svarede ikke inden for tidsgrænsen)'
            : (err.cause && err.cause.code) ? ` (${err.cause.code})` : '';
        await vagtLog(w, 'fejl',
            `${hvem} fejlede: ${besked}${aarsag}. `
            + (blokeret ? 'Holdkampen kan ikke oprettes automatisk — opret den manuelt.' : 'Prøves igen ved næste tjek.'));
        return { udfald: 'fejl', fejl: besked, blokeret };
    }
}

/**
 * Kaldes fra scheduleren hvert 10. sekund. Selve gennemløbet er en ren
 * databaseforespørgsel; badmintonplayer rammes kun for de kampe, tidsplanen
 * siger er forfaldne (se config/holdkampVagt.js).
 */
async function runHoldkampWatchers() {
    // Til diagnosen i admin: kører vagten overhovedet for denne klub?
    const tenant = currentTenant();
    _sidsteGennemloeb.set(tenant, Date.now());
    if (Date.now() - (_sidsteOprydning.get(tenant) || 0) > 10 * 60 * 1000) {
        _sidsteOprydning.set(tenant, Date.now());
        try { await query('DELETE FROM holdkamp_vagt_log WHERE tid < NOW() - INTERVAL 14 DAY'); } catch (e) { /* før migration 030 */ }
    }

    // 1. Giv op på kampe hvor starttidspunktet for længst er passeret. Var der
    // en fejl undervejs (fx badmintonplayer svarede ikke), bevares den — før
    // stod der altid "aldrig frigivet", også når den rigtige årsag var en fejl.
    const opgives = await query(
        `SELECT id, league_match_id, team1_name, team2_name, start_time, last_error FROM holdkamp_watchers
          WHERE status = 'venter'
            AND ((start_time IS NOT NULL AND UTC_TIMESTAMP() > DATE_ADD(start_time, INTERVAL ? MINUTE))
              OR (start_time IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)))`,
        [vagt.OPGIV_EFTER_MIN, vagt.UDEN_TID_TIMER]
    );
    for (const w of opgives) {
        const besked = w.last_error
            ? `Opgivet. Sidste fejl: ${w.last_error}`.slice(0, 400)
            : 'Holdsammensætningen blev aldrig frigivet';
        const r = await query(
            `UPDATE holdkamp_watchers SET status = 'opgivet', last_error = ? WHERE id = ? AND status = 'venter'`,
            [besked, w.id]
        );
        if (r.affectedRows > 0) {
            console.log(`[holdkamp-watch] kamp ${w.league_match_id} opgivet: ${besked}`);
            await vagtLog(w, w.last_error ? 'fejl' : 'advarsel',
                `Opgivet ${vagt.OPGIV_EFTER_MIN} min efter kampstart (${danskTid(w.start_time)}): ${besked}`);
        }
    }

    // 2. Find dem tidsplanen siger skal tjekkes nu
    const venter = await query(
        `SELECT * FROM holdkamp_watchers
          WHERE status = 'venter'
          ORDER BY start_time IS NULL, start_time ASC
          LIMIT 50`
    );
    const nu = new Date();
    const forfaldne = venter.filter(w => vagt.erForfalden(w, nu));

    for (const w of forfaldne) {
        // Ét spor i loggen når vinduet åbner — ellers er de enkelte "ikke
        // frigivet endnu"-tjek tavse (180 linjer pr. kamp ville drukne resten).
        const foerste = vagt.foersteTjek(w.start_time);
        if (foerste && nu >= foerste && (!w.last_checked_at || new Date(w.last_checked_at) < foerste)) {
            console.log(`[holdkamp-watch] kamp ${w.league_match_id} (${w.team1_name} – ${w.team2_name}): vinduet er åbnet, tjekker hvert 30. sekund i 10 minutter og derefter hvert 2. minut`);
            await vagtLog(w, 'info',
                `Vinduet er åbnet (kampstart ${danskTid(w.start_time)}): tjekker hvert 30. sekund i 10 minutter, derefter hvert 2. minut`);
        }
        await tjekWatcher(w);
    }

    return forfaldne.length;
}

module.exports = router;
module.exports.runHoldkampWatchers = runHoldkampWatchers;
module.exports.bpTur = bpTur;
module.exports.BP_MIN_AFSTAND_MS = BP_MIN_AFSTAND_MS;
// Rene hjælpefunktioner eksporteres til unit-tests (tests/unit/holdkamp-tid.test.js)
module.exports.parseDanskTid = parseDanskTid;
module.exports.tilMysqlDato = tilMysqlDato;
module.exports.danskVaeggurTilUtc = danskVaeggurTilUtc;
