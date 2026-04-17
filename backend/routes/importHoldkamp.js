'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

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

// ── Route ────────────────────────────────────────────────────────────────────

// POST /api/import/holdkamp-url  (requires auth)
router.post('/holdkamp-url', authMiddleware, async (req, res, next) => {
    try {
        const { url } = req.body;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL mangler' });
        }
        if (!url.includes('badmintonplayer.dk')) {
            return res.status(400).json({ error: 'Kun links fra badmintonplayer.dk understøttes' });
        }

        const params = parseHashParams(url);
        if (!params.leagueMatchID) {
            return res.status(400).json({ error: 'Kamp-ID mangler i URL\'en' });
        }

        let contextKey = await getContextKey();
        let html = await fetchMatchHtml(contextKey, params);
        let result = parseMatchHtml(html);

        // If token was stale, retry once with a fresh key
        if (!result.team1Name) {
            contextKey = await getContextKey(true);
            html = await fetchMatchHtml(contextKey, params);
            result = parseMatchHtml(html);
        }

        if (!result.team1Name || !result.team2Name) {
            return res.status(422).json({ error: 'Holdnavne ikke fundet — er linket en holdkamp med spillernavne?' });
        }
        if (result.games.length === 0) {
            return res.status(422).json({ error: 'Ingen kampe fundet — er resultater tastet ind på hjemmesiden?' });
        }

        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[importHoldkamp]', err.message);
        if (err.name === 'TimeoutError' || (err.cause && err.cause.code === 'UND_ERR_CONNECT_TIMEOUT')) {
            return res.status(504).json({ error: 'Timeout — badmintonplayer.dk svarer ikke' });
        }
        next(err);
    }
});

module.exports = router;
