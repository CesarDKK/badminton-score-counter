/**
 * Rettelse af én kamp i kamphistorikken (match_history) fra admin (nr. 48).
 *
 * Reglerne for sæt, vinder, walkover og "før tid" er tællerens egne
 * (config/kampResultat.js validerIndtastning) — de kodes ikke en gang til.
 * Rækken skrives i samme format som "Indtast resultat" på banen
 * (routes/gameStates.js POST /:courtId/result), så kamphistorikken, "Seneste
 * kamp" og statistikken læser den som ellers:
 *   winner_name / loser_name  sidernes navne ("Jens & Bo" i double)
 *   games_won                 "2-1" (vinderens sæt først) eller "W.O."
 *   set_scores                "S1 15-7 S2, S1 13-15 S2" (+ " (afsluttet før tid)")
 *                             eller "Walkover"
 * Varigheden røres ikke.
 *
 * body = { side1, side2, gameMode: '15'|'21', winner: 1|2, walkover, sets: [[a,b], ...] }
 */
const { validerIndtastning, vundneSaet } = require('./kampResultat');

const MAKS_NAVN = 100;   // match_history.winner_name/loser_name VARCHAR(100)

function rensNavn(v) {
    return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** @returns {{ felter: {winner_name, loser_name, games_won, set_scores} } | { error: string }} */
function rettetRaekke(body) {
    if (!body || typeof body !== 'object') return { error: 'Resultatet mangler' };
    const s1 = rensNavn(body.side1), s2 = rensNavn(body.side2);
    if (!s1 || !s2) return { error: 'Begge sider skal have et navn' };
    if (s1.length > MAKS_NAVN || s2.length > MAKS_NAVN) return { error: `Et navn kan højst være ${MAKS_NAVN} tegn` };
    if (s1 === s2) return { error: 'De to sider skal have forskellige navne' };
    const gameMode = body.gameMode === '21' ? '21' : body.gameMode === '15' || body.gameMode == null ? '15' : null;
    if (!gameMode) return { error: 'Ugyldigt pointformat' };

    const v = validerIndtastning({ winner: body.winner, walkover: body.walkover === true, sets: body.sets }, gameMode);
    if (v.error) return { error: v.error };
    const { sets, winner, walkover, outcome } = v.resultat;

    const vinder = winner === 1 ? s1 : s2;
    const taber = winner === 1 ? s2 : s1;
    if (walkover) {
        return { felter: { winner_name: vinder, loser_name: taber, games_won: 'W.O.', set_scores: 'Walkover' } };
    }
    const [g1, g2] = vundneSaet(sets, gameMode);
    const [gv, gt] = winner === 1 ? [g1, g2] : [g2, g1];
    const set_scores = sets.map(([a, b]) => `${s1} ${a}-${b} ${s2}`).join(', ')
        + (outcome === 'ended_early' ? ' (afsluttet før tid)' : '');
    return { felter: { winner_name: vinder, loser_name: taber, games_won: `${gv}-${gt}`, set_scores } };
}

module.exports = { rettetRaekke, MAKS_NAVN };
