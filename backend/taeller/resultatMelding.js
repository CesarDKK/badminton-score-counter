// En afgjort kamp på en bane meldes ind til den delkamp (holdkamp) eller
// turneringskamp, banen spiller — af serveren, i det øjeblik den afgjorte
// stilling gemmes.
//
// Før var det kun tabletten, der meldte resultatet ind, med ét kald efter
// matchbolden. Faldt hallens net ud netop dér, blev kaldet opgivet uden besked,
// tabletten viste "Kamp vundet" som normalt, og "Ryd banen" satte delkampen
// tilbage til "afventer" — holdkampen manglede en kamp. Selve stillingen gemmes
// derimod med genforsøg, til den når frem, så serveren har altid slutresultatet.
//
// Tabletten melder stadig selv ind (ældre sider, og de tilfælde serveren springer
// over); to indmeldinger af samme kamp giver samme resultat.
//
// Serveren melder kun ind, når det er sikkert, at stillingen på banen ER den
// kamp: navnene på begge sider skal være kampens, single/double skal passe, og
// kampen skal være startet efter, at den blev sat på banen. Ellers gør den intet.

const { query, queryOne } = require('../config/database');
const { publishGameStateChange } = require('../events/gameStateEvents');
const holdkampFormater = require('../config/holdkampFormater');

const STANDARDNAVNE = new Set(['Spiller 1', 'Spiller 2', 'Makker 1', 'Makker 2']);

function parseSaet(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

// Hvilket hold (1 eller 2) står på pladsen? null hvis ingen af navnene er
// kampens, eller hvis de peger på begge hold
function holdPaaPlads(navne, hold1, hold2) {
    const kendte = navne.filter(n => n && !STANDARDNAVNE.has(n));
    const paa1 = kendte.some(n => hold1.includes(n));
    const paa2 = kendte.some(n => hold2.includes(n));
    return paa1 === paa2 ? null : (paa1 ? 1 : 2);
}

// Sættene som tekst, præcis som tabletten skriver dem (court-script-v3.js,
// saveMatchResult): "Anna 15-9 Berit, Berit 15-12 Anna" — navnene som de stod
// i hvert sæt, så admin og oversigt kan vende tallene til hjemmeholdet
function saetTekst(saet, erDouble) {
    const navne = (a, b) => (erDouble && b && b !== 'Makker 1' && b !== 'Makker 2') ? `${a} & ${b}` : a;
    return saet.map(s => (typeof s === 'string'
        ? s
        : `${navne(s.player1Name, s.player1Name2)} ${s.score} ${navne(s.player2Name, s.player2Name2)}`
    )).join(', ');
}

/**
 * Resultatet af banens afgjorte kamp set fra kampens to hold/sider.
 * gs: game_states-rækken. hold1/hold2: navnene på kampens to sider.
 * Returnerer { winnerTeam, setScores } — eller null, når stillingen ikke med
 * sikkerhed er denne kamp (navnene passer ikke, eller ingen har vundet).
 */
function resultatFraBane(gs, { erDouble, hold1, hold2 }) {
    if (!gs || !gs.match_completed) return null;
    // Et indtastet resultat (badmintonplanner) er ikke talt på banen
    if (gs.result_outcome) return null;
    const plads1 = holdPaaPlads([gs.player1_name, erDouble ? gs.player1_name2 : null], hold1, hold2);
    const plads2 = holdPaaPlads([gs.player2_name, erDouble ? gs.player2_name2 : null], hold1, hold2);
    if (!plads1 || !plads2 || plads1 === plads2) return null;

    const s1 = Number(gs.player1_games) || 0;
    const s2 = Number(gs.player2_games) || 0;
    if (s1 === s2) return null;
    // Spillerne bytter plads mellem sættene, og sæt og navn følges ad
    const winnerTeam = s1 > s2 ? plads1 : plads2;
    return { winnerTeam, setScores: saetTekst(parseSaet(gs.set_scores_history), erDouble) };
}

// Kampen på banen begyndte, før delkampen/turneringskampen blev sat på den —
// så er det ikke den kamp (samme værn som config/matchTiming.js)
function startetFoerTildeling(gs, tildelt) {
    if (!gs.match_start_time || !tildelt) return false;
    const start = new Date(gs.match_start_time).getTime();
    const sat = new Date(tildelt).getTime();
    return Number.isFinite(start) && Number.isFinite(sat) && start < sat;
}

// Navnene på delkampens to hold, med de pladsholdere tabletten viser, når et
// navn mangler (court-script-v3.js, holdkampHoldNavne)
function holdkampNavne(g) {
    const t1 = g.team1_name || 'Hold 1';
    const t2 = g.team2_name || 'Hold 2';
    return {
        hold1: [g.team1_player1 || `${t1} spiller`, g.team1_player2 || `${t1} makker`],
        hold2: [g.team2_player1 || `${t2} spiller`, g.team2_player2 || `${t2} makker`]
    };
}

/**
 * Melder banens afgjorte kamp ind til dens delkamp eller turneringskamp.
 * gs: den netop gemte game_states-række (match_completed). Returnerer
 * { type, id, winnerTeam, setScores } når noget blev meldt ind, ellers null.
 * opts.erDouble: banens single/double, som den var under kampen — når banen
 * er ved at blive ryddet (DELETE nulstiller is_doubles), læses den ikke igen.
 */
async function meldAfgjortKamp(req, courtNumber, gs, opts = {}) {
    const bane = parseInt(courtNumber, 10);
    if (!Number.isInteger(bane) || !gs || !gs.match_completed) return null;
    let erDouble;
    if (typeof opts.erDouble === 'boolean') {
        erDouble = opts.erDouble;
    } else {
        const court = await queryOne('SELECT is_doubles FROM courts WHERE court_number = ?', [bane]);
        erDouble = !!(court && court.is_doubles);
    }

    const g = await queryOne(
        `SELECT g.id, g.category, g.started_at,
                g.team1_player1, g.team1_player2, g.team2_player1, g.team2_player2,
                tm.team1_name, tm.team2_name
           FROM team_match_games g
           JOIN team_matches tm ON tm.id = g.team_match_id
          WHERE g.court_number = ? AND g.status = 'active' AND tm.status = 'active'
          ORDER BY g.id LIMIT 1`,
        [bane]
    );
    if (g) {
        if (holdkampFormater.erDouble(g.category) !== erDouble) return null;
        if (startetFoerTildeling(gs, g.started_at)) return null;
        const r = resultatFraBane(gs, { erDouble, ...holdkampNavne(g) });
        if (!r) return null;
        // status = 'active' i WHERE: tabletten kan have meldt ind i mellemtiden
        const res = await query(
            `UPDATE team_match_games
                SET status = 'finished', finished_at = CURRENT_TIMESTAMP,
                    started_at = COALESCE(?, started_at), winner_team = ?, set_scores = ?
              WHERE id = ? AND status = 'active'`,
            [gs.match_start_time || null, r.winnerTeam, r.setScores, g.id]
        );
        if (!res.affectedRows) return null;
        publishGameStateChange(req, bane, 'assignment');
        console.log(`✓ Bane ${bane}: delkamp #${g.id} meldt ind af serveren (hold ${r.winnerTeam} vandt)`);
        return { type: 'holdkamp', id: g.id, ...r };
    }

    const m = await queryOne(
        `SELECT m.id, m.doubles, m.started_at,
                m.side1_player1, m.side1_player2, m.side2_player1, m.side2_player2
           FROM tournament_matches m
           JOIN tournaments t ON t.id = m.tournament_id
          WHERE m.court_number = ? AND m.status = 'active' AND t.status = 'active'
          ORDER BY m.id LIMIT 1`,
        [bane]
    );
    if (m) {
        if (!!m.doubles !== erDouble) return null;
        if (startetFoerTildeling(gs, m.started_at)) return null;
        const r = resultatFraBane(gs, {
            erDouble,
            hold1: [m.side1_player1, m.side1_player2].filter(Boolean),
            hold2: [m.side2_player1, m.side2_player2].filter(Boolean)
        });
        if (!r) return null;
        const res = await query(
            `UPDATE tournament_matches
                SET status = 'finished', finished_at = CURRENT_TIMESTAMP,
                    started_at = COALESCE(?, started_at), winner_team = ?, set_scores = ?
              WHERE id = ? AND status = 'active'`,
            [gs.match_start_time || null, r.winnerTeam, r.setScores, m.id]
        );
        if (!res.affectedRows) return null;
        publishGameStateChange(req, bane, 'assignment');
        console.log(`✓ Bane ${bane}: turneringskamp #${m.id} meldt ind af serveren (side ${r.winnerTeam} vandt)`);
        return { type: 'turnering', id: m.id, ...r };
    }
    return null;
}

module.exports = { meldAfgjortKamp, resultatFraBane, saetTekst, holdPaaPlads, holdkampNavne, startetFoerTildeling };
