/**
 * Eksport af kamphistorikken som CSV, Excel kan åbne direkte (nr. 48).
 *
 * - UTF-8 med BOM (ellers viser Excel æøå forkert), semikolon som skilletegn
 *   (dansk Excel bruger komma som decimaltegn), CRLF mellem rækkerne.
 * - Datoer som dd-mm-åååå tt:mm i dansk tid.
 * - Formel-injektion: et felt, der begynder med = + - @ (eller tabulator/CR),
 *   får et foranstillet ', så Excel viser det som tekst i stedet for at regne
 *   det ud — spillernavne kommer udefra (QR-gæster, TS, import).
 * - Hentes i bidder (BID rækker ad gangen, keyset på id), så en stor tabel
 *   ikke lægges i hukommelsen på én gang; rækkerne skrives til svaret
 *   efterhånden (skrivCsv).
 *
 * Rene funktioner — kun skrivCsv rører svaret, og hentIBidder kalder den
 * forespørgselsfunktion, den får.
 */
const { varighedTekst } = require('./matchTiming');

const BOM = '﻿';
const SKILLE = ';';
const BID = 1000;

/** Ét felt: tekst, formel-værn og citationstegn efter behov. */
function csvFelt(v) {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

const csvLinje = (felter) => felter.map(csvFelt).join(SKILLE) + '\r\n';

/** dd-mm-åååå tt:mm i dansk tid (sommer- og vintertid), '' hvis ugyldig. */
function danskDato(v) {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return '';
    const dele = Object.fromEntries(new Intl.DateTimeFormat('da-DK', {
        timeZone: 'Europe/Copenhagen', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(d).map(p => [p.type, p.value]));
    return `${dele.day}-${dele.month}-${dele.year} ${dele.hour}:${dele.minute}`;
}

const AFBRUDT = ' (afsluttet før tid)';

// Et hold som sammenlignelig nøgle: medlemmerne sorteret, uanset om de er
// skrevet "A & B" (banerne) eller "A / B" (turnering/holdkamp)
const medlemmer = (s) => String(s || '').trim().split(/\s*[/&]\s*/).map(p => p.trim()).filter(Boolean);
const holdNoegle = (s) => medlemmer(s).sort().join(' / ');

/**
 * Sætcifrene fra set_scores ("A 21-15 B, B 21-19 A") vendt, så `anker` står
 * først: "21-15 19-21". 'W.O.'/'Walkover' → 'W.O.'. Samme regel som admins
 * orientHistorySetScoreNumbers. Tom streng hvis intet.
 */
function saetCifre(raw, anker) {
    if (!raw) return '';
    const tekst = String(raw).trim();
    if (tekst === 'W.O.' || tekst === 'Walkover') return 'W.O.';
    const afbrudt = tekst.endsWith(AFBRUDT);
    const ren = afbrudt ? tekst.slice(0, -AFBRUDT.length) : tekst;
    const a = anker ? holdNoegle(anker) : null;
    const aMedlemmer = anker ? medlemmer(anker) : [];
    const ud = [];
    for (const del of ren.split(', ')) {
        const m = del.match(/^(.*?)\s+(\d+)-(\d+)\s+(.*?)$/);
        if (m) {
            let vend = false;
            if (a) {
                if (holdNoegle(m[1]) === a) vend = false;
                else if (holdNoegle(m[4]) === a) vend = true;
                else {
                    const h1 = aMedlemmer.some(n => m[1].includes(n));
                    const h2 = aMedlemmer.some(n => m[4].includes(n));
                    vend = h2 && !h1;
                }
            }
            ud.push(vend ? `${m[3]}-${m[2]}` : `${m[2]}-${m[3]}`);
            continue;
        }
        const tal = del.match(/\d+-\d+/g);
        if (tal) ud.push(...tal);
    }
    return ud.join(' ') + (afbrudt && ud.length ? ' (før tid)' : '');
}

const hold = (a, b) => [a, b].filter(Boolean).join(' / ');

// ---- De tre faner ----

const ENKELT_HOVED = ['Dato', 'Bane', 'Vinder', 'Taber', 'Sæt', 'Sætcifre (vinder først)', 'Varighed'];
function enkeltRaekke(r) {
    return [danskDato(r.match_date), r.court_number ?? '', r.winner_name, r.loser_name,
        r.games_won, saetCifre(r.set_scores, r.winner_name), r.duration];
}

const HOLD_HOVED = ['Dato', 'Holdkamp', 'Delkamp', 'Bane', 'Hold 1', 'Spillere hold 1', 'Hold 2', 'Spillere hold 2',
    'Vinder', 'Sætcifre (hold 1 først)', 'Varighed'];
function holdRaekke(r) {
    const vinder = r.winner_team === 1 ? r.team1_name : r.winner_team === 2 ? r.team2_name : '';
    const spillet = r.status === 'finished';
    return [danskDato(r.finished_at || r.created_at), `${r.team1_name} – ${r.team2_name}`, r.category,
        r.court_number ?? '', r.team1_name, hold(r.team1_player1, r.team1_player2),
        r.team2_name, hold(r.team2_player1, r.team2_player2),
        spillet ? vinder : 'Ikke spillet',
        spillet ? saetCifre(r.set_scores, hold(r.team1_player1, r.team1_player2)) : '',
        spillet ? varighedTekst(r.started_at, r.finished_at) : ''];
}

const TURNERING_HOVED = ['Dato', 'Turnering', 'Kamp', 'Bane', 'Side 1', 'Side 2', 'Vinder', 'Sætcifre (side 1 først)', 'Varighed'];
function turneringRaekke(r) {
    const s1 = hold(r.side1_player1, r.side1_player2);
    const s2 = hold(r.side2_player1, r.side2_player2);
    const vinder = r.winner_team === 1 ? s1 : r.winner_team === 2 ? s2 : '';
    return [danskDato(r.finished_at), r.tournament_name, r.label || (r.match_order != null ? `#${r.match_order}` : ''),
        r.court_number ?? '', s1, s2, vinder, saetCifre(r.set_scores, s1), varighedTekst(r.started_at, r.finished_at)];
}

/**
 * Hent alle rækker i bidder: hent(efterId, antal) skal give rækker med id
 * < efterId (null = fra toppen) sorteret efter id faldende. Kalder
 * medBid(rækker) for hver bid.
 */
async function hentIBidder(hent, medBid, bid = BID) {
    let efter = null;
    for (;;) {
        const raekker = await hent(efter, bid);
        if (!raekker.length) return;
        await medBid(raekker);
        if (raekker.length < bid) return;
        efter = raekker[raekker.length - 1].id;
    }
}

/** Skriv en CSV til svaret: overskrift, så rækkerne bid for bid. */
async function skrivCsv(res, filnavn, hoved, hent, tilRaekke, bid = BID) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filnavn}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.write(BOM + csvLinje(hoved));
    await hentIBidder(hent, async (raekker) => {
        res.write(raekker.map(r => csvLinje(tilRaekke(r))).join(''));
    }, bid);
    res.end();
}

/** fx kamphistorik-2026-11-16.csv (dansk dato) */
function filnavn(navn, nu = new Date()) {
    const d = danskDato(nu).slice(0, 10).split('-').reverse().join('-');
    return `${navn}-${d}.csv`;
}

module.exports = {
    BOM, SKILLE, BID, csvFelt, csvLinje, danskDato, saetCifre, hentIBidder, skrivCsv, filnavn,
    ENKELT_HOVED, enkeltRaekke, HOLD_HOVED, holdRaekke, TURNERING_HOVED, turneringRaekke
};
