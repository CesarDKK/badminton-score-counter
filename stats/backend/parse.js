/**
 * Parsning af den HTML som GetLeagueStanding returnerer.
 *
 * Markup'en er maskingenereret af et ASP.NET-kontrolelement og er stabil, men den
 * er ikke XML-ren. Vi bruger derfor en lille scanner der kan håndtere indlejrede
 * tabeller frem for at regexe blindt hen over det hele.
 */

const { decodeEntities } = require('./badmintonplayer');

/** Alle tabeller på øverste niveau, med deres indhold. Håndterer indlejring. */
function extractTables(html) {
    const tables = [];
    const re = /<table\b([^>]*)>|<\/table\s*>/gi;
    let m, depth = 0, start = 0, attrs = '';
    while ((m = re.exec(html))) {
        if (m[0][1] !== '/') {
            if (depth === 0) { attrs = m[1]; start = m.index + m[0].length; }
            depth++;
        } else if (depth > 0) {
            depth--;
            if (depth === 0) tables.push({ attrs, inner: html.slice(start, m.index) });
        }
    }
    return tables;
}

/**
 * Værdien af en attribut. Markup'en blander enkelt- og dobbeltcitationstegn
 * (fx class='matchinfo' men href="..."), så begge dele skal kunne læses.
 */
function attr(attrs, navn) {
    const re = new RegExp(`\\b${navn}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const m = re.exec(attrs || '');
    if (!m) return '';
    return m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3] || '');
}

function tableClass(attrs) {
    return attr(attrs, 'class');
}

/** Rækker i en tabel. Indlejrede tabeller fjernes først så de ikke forstyrrer. */
function extractRows(tableInner) {
    const flad = tableInner.replace(/<table\b[\s\S]*?<\/table\s*>/gi, '');
    const rows = [];
    const re = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
    let m;
    while ((m = re.exec(flad))) rows.push(m[1]);
    return rows;
}

/** Celler i en række — både th og td, i dokumentrækkefølge. */
function extractCells(rowInner) {
    const cells = [];
    const re = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
    let m;
    while ((m = re.exec(rowInner))) cells.push(m[2]);
    return cells;
}

/** Fjerner tags og normaliserer whitespace + HTML-entiteter. */
function text(html) {
    return decodeEntities(String(html || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Argumenterne i et ShowStanding-kald.
 * Rækkefølge: subPage, seasonID, leagueGroupID, ageGroupID, regionID,
 *             leagueGroupTeamID, leagueMatchID, clubID, playerID
 */
function showStandingArgs(html) {
    const out = [];
    const re = /ShowStanding\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(html))) {
        out.push({
            subPage: m[1], seasonID: m[2], leagueGroupID: m[3], ageGroupID: m[4],
            regionID: m[5], leagueGroupTeamID: m[6], leagueMatchID: m[7],
            clubID: m[8], playerID: m[9], html: m[0]
        });
    }
    return out;
}

/** Alle links i et stykke HTML, som { href, onclick, tekst }. */
function links(html) {
    const out = [];
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    let m;
    while ((m = re.exec(html))) {
        out.push({
            href: attr(m[1], 'href'),
            onclick: attr(m[1], 'onclick'),
            tekst: text(m[2])
        });
    }
    return out;
}

// ── subPage 6: klubbens rækker i sæsonen ─────────────────────────────────────
/** → [{ hold, raekke, leagueGroupID, ageGroupID, regionID }] */
function parseClubOverview(html) {
    const ud = [];
    for (const t of extractTables(html)) {
        for (const row of extractRows(t.inner)) {
            const celler = extractCells(row);
            if (celler.length !== 2) continue;
            const kald = showStandingArgs(celler[1]).find((a) => a.subPage === '2');
            if (!kald) continue;
            ud.push({
                hold: text(celler[0]),
                raekke: text(celler[1]),
                leagueGroupID: kald.leagueGroupID,
                ageGroupID: kald.ageGroupID,
                regionID: kald.regionID
            });
        }
    }
    return ud;
}

// ── subPage 2: puljestilling → holdenes id'er ────────────────────────────────
/** → [{ navn, teamID, leagueGroupID, ageGroupID, regionID }] for hold hvis navn matcher. */
function parsePoolTeams(html, matchNavn) {
    const set = new Map();
    for (const a of links(html)) {
        const kald = showStandingArgs(a.onclick).find((x) => x.subPage === '3' && x.leagueGroupTeamID);
        if (!kald) continue;
        if (!matchNavn(a.tekst)) continue;
        if (set.has(kald.leagueGroupTeamID)) continue;
        set.set(kald.leagueGroupTeamID, {
            navn: a.tekst,
            teamID: kald.leagueGroupTeamID,
            leagueGroupID: kald.leagueGroupID,
            ageGroupID: kald.ageGroupID,
            regionID: kald.regionID
        });
    }
    return [...set.values()];
}

// ── subPage 3: holdets kampprogram → kampnumre ───────────────────────────────
function parseTeamMatches(html) {
    const numre = new Set();
    for (const kald of showStandingArgs(html)) {
        if (kald.subPage === '5' && kald.leagueMatchID) numre.add(kald.leagueMatchID);
    }
    return [...numre];
}

// ── subPage 5: holdseddel → spillere ─────────────────────────────────────────
/**
 * → { kampnr, tid, resultat, hjemme, ude, side, spillere: [{ id, navn, disciplin }] }
 * `side` er 'hjemme' eller 'ude' alt efter hvor klubben står. Er klubben ikke med
 * (kan ske ved fejlindtastning) returneres side: null og en tom spillerliste.
 */
function parseMatch(html, erKlub) {
    const tabeller = extractTables(html);
    const info = {};
    const infoTabel = tabeller.find((t) => /matchinfo/i.test(tableClass(t.attrs)));
    if (infoTabel) {
        for (const row of extractRows(infoTabel.inner)) {
            const c = extractCells(row);
            if (c.length >= 2) info[text(c[0])] = text(c[1]);
        }
    }

    const skema = tabeller.find((t) => /matchresultschema/i.test(tableClass(t.attrs)));
    if (!skema) return null;

    const raekker = extractRows(skema.inner);
    if (!raekker.length) return null;

    const hoved = extractCells(raekker[0]);
    const hjemme = text(hoved[1] || '');
    const ude = text(hoved[2] || '');
    const kolonne = erKlub(hjemme) ? 1 : (erKlub(ude) ? 2 : 0);

    const kamp = {
        kampnr: info['Kampnr'] || '',
        tid: info['Tid'] || '',
        resultat: info['Resultat'] || '',
        hjemme,
        ude,
        side: kolonne === 1 ? 'hjemme' : (kolonne === 2 ? 'ude' : null),
        spillere: []
    };
    if (!kolonne) return kamp;

    for (let i = 1; i < raekker.length; i++) {
        const celler = extractCells(raekker[i]);
        const disciplin = text(celler[0] || '');
        if (!/^\d+\.\s*\S/.test(disciplin)) continue;
        const celle = celler[kolonne];
        if (!celle) continue;
        for (const a of links(celle)) {
            if (!/VisSpiller/i.test(a.href)) continue;
            const id = (a.href.split('#')[1] || '').trim();
            if (!id) continue;
            kamp.spillere.push({ id, navn: a.tekst, disciplin });
        }
    }
    return kamp;
}

module.exports = {
    extractTables, extractRows, extractCells, text, links, showStandingArgs, attr,
    parseClubOverview, parsePoolTeams, parseTeamMatches, parseMatch
};
