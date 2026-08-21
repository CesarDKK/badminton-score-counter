'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { query, queryOne } = require('../config/database');

const SERVICE_URL  = 'https://www.badmintonplayer.dk/SportsResults/Components/WebService1.asmx/GetLeagueStanding';
const CONTEXT_PAGE = 'https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/';
const BROWSER_UA   = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Cache context key for 10 minutes — avoids hammering the site
let _contextKey = null;
let _contextKeyExpires = 0;

async function getContextKey(force = false) {
    if (!force && _contextKey && Date.now() < _contextKeyExpires) return _contextKey;
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

function detectFormat(games) {
    const cats = games.map(g => g.category);
    if (cats.some(c => c === 'Single' || c === 'Double')) return '4spillere';
    const n = games.length;
    const cnt = c => cats.filter(x => x === c).length;
    if (n === 11) return 'liga11';
    if (n === 13) return '13kamps';
    if (n === 9)  return '4plus3';
    if (n === 8 && cnt('MD') >= 2 && cnt('DS') >= 2) return '2plus2';
    if (n === 8 && cnt('MD') === 1 && cnt('DS') === 1) return '4plus2';
    return 'imported';
}

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

/** "lø 05-09-2026 16:00" → Date i serverens tidszone (Europe/Copenhagen). */
function parseDanskTid(s) {
    const m = String(s || '').match(/(\d{2})[-.](\d{2})[-.](\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?/);
    if (!m) return null;
    const d = new Date(
        Number(m[3]), Number(m[2]) - 1, Number(m[1]),
        m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0, 0, 0
    );
    return isNaN(d.getTime()) ? null : d;
}

/** MySQL DATETIME i lokal tid — samme zone som NOW() i containeren. */
function tilMysqlDato(d) {
    if (!d) return null;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:00`;
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

// ── Ruter ────────────────────────────────────────────────────────────────────

/**
 * POST /api/import/holdkamp-url
 *
 * Er holdsedlen frigivet, svarer vi som hidtil med hold og delkampe, saa admin
 * faar sit preview. Er den ikke, sætter vi kampen under overvaagning i stedet
 * for at afvise linket — holdsedlen frigives typisk foerst en time foer start.
 */
router.post('/holdkamp-url', authMiddleware, async (req, res, next) => {
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
             VALUES (?, ?, ?, ?, ?, ?, 'venter', NOW(), NULL, NULL)
             ON DUPLICATE KEY UPDATE
               url = VALUES(url), team1_name = VALUES(team1_name), team2_name = VALUES(team2_name),
               venue = VALUES(venue), start_time = VALUES(start_time),
               status = 'venter', last_checked_at = NOW(), last_error = NULL, team_match_id = NULL`,
            [params.leagueMatchID, url, team1, team2, info.spillested || null, tilMysqlDato(info.tid)]
        );

        const watcher = await queryOne(
            `SELECT *, DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i:00') AS start_time_local
               FROM holdkamp_watchers WHERE league_match_id = ?`,
            [params.leagueMatchID]
        );

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
router.get('/holdkamp-watchers', authMiddleware, async (req, res, next) => {
    try {
        // start_time_local sendes som tekst uden tidszone. En DATETIME bliver
        // ellers til en Date som JSON stempler med Z, og så rykker klokkeslættet
        // sig to timer i browseren.
        const raekker = await query(
            `SELECT *, DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i:00') AS start_time_local
               FROM holdkamp_watchers
              WHERE status = 'venter'
                 OR updated_at > DATE_SUB(NOW(), INTERVAL 12 HOUR)
              ORDER BY start_time IS NULL, start_time ASC`
        );
        res.json(raekker);
    } catch (error) { next(error); }
});

// DELETE /api/import/holdkamp-watchers/:id — stop overvågningen af én kamp
router.delete('/holdkamp-watchers/:id', authMiddleware, async (req, res, next) => {
    try {
        const r = await query('DELETE FROM holdkamp_watchers WHERE id = ?', [req.params.id]);
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Overvågningen findes ikke' });
        res.json({ success: true });
    } catch (error) { next(error); }
});

// ── Automatisk hentning ──────────────────────────────────────────────────────

// Vi begynder at kigge 70 minutter før start (holdsedlen frigives ca. 60 min
// før) og giver op 30 minutter efter starttidspunktet.
const START_FOER_MIN = 70;
const OPGIV_EFTER_MIN = 30;
const INTERVAL_MIN = 5;

// Kender vi ikke tidspunktet, kigger vi hvert 5. minut i seks timer og stopper.
const UDEN_TID_TIMER = 6;

/**
 * Kaldes fra scheduleren hvert minut. Den henter kun fra badmintonplayer for de
 * kampe der faktisk er i vinduet og ikke er tjekket inden for de sidste 5
 * minutter — resten er en ren databaseforespørgsel.
 */
async function runHoldkampWatchers() {
    // 1. Giv op på kampe hvor starttidspunktet for længst er passeret
    await query(
        `UPDATE holdkamp_watchers
            SET status = 'opgivet',
                last_error = 'Holdsammensætningen blev aldrig frigivet'
          WHERE status = 'venter'
            AND ((start_time IS NOT NULL AND NOW() > DATE_ADD(start_time, INTERVAL ? MINUTE))
              OR (start_time IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)))`,
        [OPGIV_EFTER_MIN, UDEN_TID_TIMER]
    );

    // 2. Find dem der skal tjekkes nu
    const forfaldne = await query(
        `SELECT * FROM holdkamp_watchers
          WHERE status = 'venter'
            AND (last_checked_at IS NULL OR last_checked_at <= DATE_SUB(NOW(), INTERVAL ? MINUTE))
            AND (start_time IS NULL OR NOW() >= DATE_SUB(start_time, INTERVAL ? MINUTE))
          ORDER BY start_time ASC
          LIMIT 10`,
        [INTERVAL_MIN, START_FOER_MIN]
    );

    for (const w of forfaldne) {
        try {
            const { info, seddel } = await hentKamp(w.url);

            if (!seddel.team1Name || !seddel.team2Name || seddel.games.length === 0) {
                // Stadig ikke frigivet — notér forsøget og prøv igen om 5 minutter
                await query(
                    `UPDATE holdkamp_watchers SET last_checked_at = NOW(), last_error = NULL,
                            start_time = COALESCE(?, start_time)
                      WHERE id = ?`,
                    [tilMysqlDato(info.tid), w.id]
                );
                continue;
            }

            const { opretHoldkamp } = require('./teamMatches');
            const teamMatchId = await opretHoldkamp({
                format: seddel.format,
                team1Name: seddel.team1Name,
                team2Name: seddel.team2Name,
                games: seddel.games
            });

            await query(
                `UPDATE holdkamp_watchers
                    SET status = 'oprettet', team_match_id = ?, last_checked_at = NOW(), last_error = NULL
                  WHERE id = ?`,
                [teamMatchId, w.id]
            );
            console.log(`✓ Holdkamp hentet automatisk: ${seddel.team1Name} – ${seddel.team2Name} (kamp ${w.league_match_id})`);
        } catch (err) {
            // En turnering kan blokere oprettelsen. Holdsedlen er der, men vi kan
            // ikke oprette — markér som fejl så admin kan gøre det manuelt.
            const blokeret = err.status === 409;
            await query(
                `UPDATE holdkamp_watchers
                    SET last_checked_at = NOW(), last_error = ?, status = ?
                  WHERE id = ?`,
                [String(err.message || err).slice(0, 400), blokeret ? 'fejl' : 'venter', w.id]
            );
            console.error(`[holdkamp-watch] kamp ${w.league_match_id}: ${err.message}`);
        }
    }

    return forfaldne.length;
}

module.exports = router;
module.exports.runHoldkampWatchers = runHoldkampWatchers;
