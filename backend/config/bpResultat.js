'use strict';
/**
 * Resultater til badmintonplayer.dk som kladde (holdkampe) — Badminton Danmark
 * har sagt god for det (Jesper 2026-11-25).
 *
 * Badmintonplayers egen tæller (livescore.badmintonplayer.dk) gør sådan, når
 * man trykker "Afslut kamp" på en delkamp:
 *   1. Holdkampen er hentet med livescore-koden som adgangskode:
 *      GET /api/LeagueMatch/{kampnr}?password=<base64(kode)>&isLiveScore=true
 *   2. Delkampens leagueMatchSet erstattes af sættene fra tælleren — et
 *      eksisterende sæt (samme setIndex) får nye points1/points2, ellers et nyt
 *      { leagueMatchIndividualMatchId, points1, points2, setIndex, teamIndex1: 0,
 *      teamIndex2: 1 }. points1 er hjemmeholdet (leagueGroupTeamId1).
 *   3. Hele modellen sendes tilbage som kladde:
 *      PUT /api/LeagueMatch/{kampnr}/{kode}?regionId=2 med IsDraft = true og
 *      match.matchTime som "samme klokkeslæt i UTC".
 * Hjemmeklubben godkender og indsender selv indberetningen bagefter.
 *
 * Vi gør det samme fra admin, men forsigtigere (Jesper valgte en knap med
 * visning først frem for automatik):
 *   - modellen hentes frisk lige før, der gemmes;
 *   - der skrives aldrig i en indberettet kamp (resultCompleted) eller en kamp,
 *     der ikke er åben for indberetning;
 *   - kun delkampe, hvor spillernes navne passer på BEGGE hold (intet gæt på
 *     rækkefølgen som ved livescore);
 *   - en delkamp, der allerede har et andet resultat på badmintonplayer, røres
 *     ikke — den vises i stedet;
 *   - walkover og "afsluttet før tid" skrives ikke (tastes på badmintonplayer).
 *
 * Denne fil: de rene funktioner og de to kald. Ruterne: routes/bpLivescore.js.
 */

const { API, normNavn } = require('./bpLivescore');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const AFBRUDT = ' (afsluttet før tid)';

// Et hold som sammenlignelig nøgle: navnene sorteret, uanset "A & B" eller "A / B"
const holdNoegle = (navne) => navne.map(normNavn).filter(Boolean).sort().join('|');
const delNavne = (s) => String(s || '').split(/\s*[/&]\s*/).map(x => x.trim()).filter(Boolean);

/**
 * Sættene fra en af vores delkampe, hold 1 først: { ok, saet: [[h1, h2], …] }
 * eller { ok: false, grund }.
 *
 * set_scores findes i tre former:
 *   tabletten  "Anna & Bo 15-12 Cy & Di, Cy & Di 15-9 Anna & Bo" (siderne kan byttes)
 *   manuel     "15-12 13-15 15-10" (hold 1 først)
 *   golden set "15-12" (hold 1 først)
 */
function saetFraDelkamp(g) {
    const raa = String(g.set_scores || '').trim();
    if (g.status !== 'finished') return { ok: false, grund: 'ikke færdigspillet' };
    if (!raa) return { ok: false, grund: 'ingen sætcifre' };
    if (raa === 'W.O.' || raa === 'Walkover') return { ok: false, grund: 'walkover — tastes på badmintonplayer.dk' };
    if (raa.endsWith(AFBRUDT)) return { ok: false, grund: 'afsluttet før tid — tastes på badmintonplayer.dk' };

    const h1 = holdNoegle([g.team1_player1, g.team1_player2]);
    const h2 = holdNoegle([g.team2_player1, g.team2_player2]);
    const saet = [];
    const dele = raa.includes(',') || /[^\d\s-]/.test(raa) ? raa.split(', ') : raa.split(/\s+/);
    for (const del of dele) {
        const m = del.match(/^(.*?)\s+(\d+)-(\d+)\s+(.*?)$/);
        if (m) {
            const venstre = holdNoegle(delNavne(m[1]));
            const hoejre = holdNoegle(delNavne(m[4]));
            if (venstre === h1 && hoejre === h2) saet.push([Number(m[2]), Number(m[3])]);
            else if (venstre === h2 && hoejre === h1) saet.push([Number(m[3]), Number(m[2])]);
            else return { ok: false, grund: 'navnene i sætcifrene passer ikke med delkampens spillere' };
            continue;
        }
        const t = del.trim().match(/^(\d+)-(\d+)$/);
        if (!t) return { ok: false, grund: `kan ikke læse sætcifrene "${raa.slice(0, 60)}"` };
        saet.push([Number(t[1]), Number(t[2])]);
    }
    if (!saet.length) return { ok: false, grund: 'ingen sætcifre' };
    if (saet.some(([a, b]) => a === b)) return { ok: false, grund: 'et sæt står lige' };
    // Sættene skal give samme vinder, som delkampen står med
    const v1 = saet.filter(([a, b]) => a > b).length;
    const v2 = saet.length - v1;
    const vinder = v1 > v2 ? 1 : v2 > v1 ? 2 : 0;
    if (!vinder || (g.winner_team && Number(g.winner_team) !== vinder)) {
        return { ok: false, grund: 'sætcifrene passer ikke med vinderen' };
    }
    return { ok: true, saet };
}

function spillere(ctm, holdId) {
    return ((ctm.teamPlayers && ctm.teamPlayers[holdId]) || [])
        .map(p => (p.player && p.player.name) || '').filter(Boolean);
}

/** Sættene, som de står på badmintonplayer (hjemme først), uden tomme 0-0. */
function bpSaet(ctm) {
    return ((ctm && ctm.leagueMatchSet) || [])
        .slice().sort((a, b) => a.setIndex - b.setIndex)
        .map(s => [Number(s.points1) || 0, Number(s.points2) || 0])
        .filter(([a, b]) => a || b);
}

const saetTekst = (saet) => saet.map(([a, b]) => `${a}-${b}`).join(' ');

/** Kan der overhovedet skrives i kampen? null = ja, ellers grunden. */
function kampSpaerret(model) {
    const m = model && model.match;
    if (!m) return 'Holdkampen findes ikke på badmintonplayer.dk';
    if (m.resultCompleted) return 'Holdkampen er allerede indberettet på badmintonplayer.dk — der skrives ikke i en indberettet kamp.';
    if (m.matchResultRegistrationOpen === false) return 'badmintonplayer.dk er ikke åben for indberetning af resultatet på denne kamp.';
    if (!m.liveScore) return 'Hjemmeklubben har lukket for Live Score på badmintonplayer.dk, så koden kan ikke bruges. Åbn igen, eller tast resultaterne på badmintonplayer.dk.';
    return null;
}

/**
 * Hvad der vil ske med hver af vores delkampe.
 * → { spaerret: grund|null, linjer: [{ gameId, kategori, nr, hold1, hold2 (hjemme
 *      først, når delkampen er fundet på badmintonplayer),
 *      handling: 'skriv'|'findes'|'spring', grund, saet (hjemme først),
 *      bpKampId, bpSaet }] }
 */
function planKladde(games, model) {
    const spaerret = kampSpaerret(model);
    const m = (model && model.match) || {};
    const ctms = (model && model.combinedTeamMatches) || [];
    const brugt = new Set();
    const linjer = [];

    for (const g of games) {
        const linje = {
            gameId: g.id, kategori: g.category, nr: g.game_number,
            hold1: [g.team1_player1, g.team1_player2].filter(Boolean).join(' & '),
            hold2: [g.team2_player1, g.team2_player2].filter(Boolean).join(' & '),
            handling: 'spring', grund: null, saet: null, bpKampId: null, bpSaet: null,
        };
        linjer.push(linje);

        const h1 = holdNoegle([g.team1_player1, g.team1_player2]);
        const h2 = holdNoegle([g.team2_player1, g.team2_player2]);
        let ctm = null, hold1ErHjemme = true;
        if (h1 && h2) {
            ctm = ctms.find(c => !brugt.has(c.leagueMatchIndividualMatchId)
                && holdNoegle(spillere(c, m.leagueGroupTeamId1)) === h1
                && holdNoegle(spillere(c, m.leagueGroupTeamId2)) === h2);
            if (!ctm) {
                ctm = ctms.find(c => !brugt.has(c.leagueMatchIndividualMatchId)
                    && holdNoegle(spillere(c, m.leagueGroupTeamId1)) === h2
                    && holdNoegle(spillere(c, m.leagueGroupTeamId2)) === h1);
                hold1ErHjemme = false;
            }
        }
        if (ctm) {
            brugt.add(ctm.leagueMatchIndividualMatchId);
            // Navnene som sætcifrene: hjemmeholdet først
            if (!hold1ErHjemme) [linje.hold1, linje.hold2] = [linje.hold2, linje.hold1];
            linje.bpKampId = ctm.leagueMatchIndividualMatchId;
            linje.bpSaet = bpSaet(ctm);
        }

        const vores = saetFraDelkamp(g);
        if (!vores.ok) { linje.grund = vores.grund; continue; }
        linje.saet = hold1ErHjemme ? vores.saet : vores.saet.map(([a, b]) => [b, a]);
        if (!ctm) { linje.grund = 'spillerne passer ikke med holdsedlen på badmintonplayer.dk'; continue; }
        if (ctm.winnerWo) { linje.grund = 'står som walkover på badmintonplayer.dk'; continue; }

        if (linje.bpSaet.length) {
            if (saetTekst(linje.bpSaet) === saetTekst(linje.saet)) {
                linje.handling = 'findes';
                linje.grund = 'står der allerede';
            } else {
                linje.grund = `der står allerede ${saetTekst(linje.bpSaet)} på badmintonplayer.dk — rettes ikke`;
            }
            continue;
        }
        linje.handling = 'skriv';
    }
    if (spaerret) for (const l of linjer) if (l.handling === 'skriv') { l.handling = 'spring'; l.grund = 'kampen er spærret'; }
    return { spaerret, linjer };
}

/** "2026-09-28T19:00:00" → samme klokkeslæt som UTC, som deres tæller (Ge). */
function utcKlokkeslaet(t) {
    const m = String(t || '').match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)/);
    if (!m) return t;
    return `${m[1].length === 16 ? m[1] + ':00' : m[1]}.000Z`;
}

/**
 * Modellen med de valgte delkampes sæt sat ind — som deres tæller gør det.
 * Rører ikke det, der er hentet (kopi).
 */
function anvendKladde(model, linjer) {
    const ny = JSON.parse(JSON.stringify(model));
    const skriv = new Map(linjer.filter(l => l.handling === 'skriv').map(l => [l.bpKampId, l.saet]));
    for (const ctm of ny.combinedTeamMatches || []) {
        const saet = skriv.get(ctm.leagueMatchIndividualMatchId);
        if (!saet) continue;
        const gamle = ctm.leagueMatchSet || [];
        ctm.leagueMatchSet = saet.map(([a, b], i) => {
            const f = gamle.find(s => Number(s.setIndex) === i);
            return f ? { ...f, points1: a, points2: b }
                     : { leagueMatchIndividualMatchId: ctm.leagueMatchIndividualMatchId, points1: a, points2: b, setIndex: i, teamIndex1: 0, teamIndex2: 1 };
        });
    }
    if (ny.match && ny.match.matchTime) ny.match.matchTime = utcKlokkeslaet(ny.match.matchTime);
    ny.IsDraft = true;
    return ny;
}

function tjekKampnr(kampnr) {
    if (!/^\d{1,12}$/.test(String(kampnr))) throw new Error('Ugyldigt kampnummer');
}

/** Holdkampen hentet med koden som adgangskode (som deres tæller). */
async function hentMedKode(kampnr, kode, { fetchFn = fetch } = {}) {
    tjekKampnr(kampnr);
    const pw = encodeURIComponent(Buffer.from(String(kode || ''), 'utf8').toString('base64'));
    const resp = await fetchFn(`${API}/LeagueMatch/${kampnr}?password=${pw}&isLiveScore=true`, {
        headers: { 'Accept': 'application/json', 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`badmintonplayer.dk svarede med HTTP ${resp.status}`);
    return resp.json();
}

/** Gem kladden. Kaster med badmintonplayers egen tekst, hvis den afvises. */
async function gemKladde(kampnr, kode, model, { fetchFn = fetch } = {}) {
    tjekKampnr(kampnr);
    const resp = await fetchFn(`${API}/LeagueMatch/${kampnr}/${encodeURIComponent(String(kode || ''))}?regionId=2`, {
        method: 'PUT',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA },
        body: JSON.stringify(model),
        signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
        let tekst = '';
        try { tekst = (await resp.text()).replace(/\s+/g, ' ').slice(0, 200); } catch { /* intet */ }
        throw new Error(`badmintonplayer.dk afviste kladden (HTTP ${resp.status})${tekst ? `: ${tekst}` : ''}`);
    }
    return true;
}

// Til Kamphistorik: kan holdkampen overføre resultater? Kun om koden er sat —
// holdkamp-ruterne må aldrig nævne eller sende koden selv.
const KLADDE_MULIG = '(aktiv_kilde_id IS NOT NULL AND bp_livescore_kode IS NOT NULL)';

module.exports = {
    KLADDE_MULIG,
    saetFraDelkamp, planKladde, anvendKladde, kampSpaerret, bpSaet, saetTekst, utcKlokkeslaet,
    hentMedKode, gemKladde,
};
