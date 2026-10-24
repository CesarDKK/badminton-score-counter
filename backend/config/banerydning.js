const { query, queryOne } = require('./database');
const { publishGameStateChange } = require('../events/gameStateEvents');
const { invalidateCourtTokens } = require('../routes/matchSessionTokens');

/**
 * Gemmer banens afsluttede kamp i last_finished_matches, så TV'et kan vise
 * resultatet et par minutter efter, at banen er ryddet.
 * `existing` er banens game_states-række.
 */
async function gemSidsteAfsluttedeKamp(courtDbId, existing) {
    const courtRow = await queryOne('SELECT is_doubles FROM courts WHERE id = ?', [courtDbId]);
    const setScoresJson = existing.set_scores_history
        ? (typeof existing.set_scores_history === 'string'
            ? existing.set_scores_history
            : JSON.stringify(existing.set_scores_history))
        : '[]';
    await query(
        `INSERT INTO last_finished_matches
            (court_id, player1_name, player1_name2, player2_name, player2_name2,
             player1_games, player2_games, set_scores_history,
             is_doubles, match_end_time, cleared_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
            player1_name = VALUES(player1_name),
            player1_name2 = VALUES(player1_name2),
            player2_name = VALUES(player2_name),
            player2_name2 = VALUES(player2_name2),
            player1_games = VALUES(player1_games),
            player2_games = VALUES(player2_games),
            set_scores_history = VALUES(set_scores_history),
            is_doubles = VALUES(is_doubles),
            match_end_time = VALUES(match_end_time),
            cleared_at = NOW()`,
        [
            courtDbId,
            existing.player1_name,
            existing.player1_name2,
            existing.player2_name,
            existing.player2_name2,
            existing.player1_games || 0,
            existing.player2_games || 0,
            setScoresJson,
            courtRow ? !!courtRow.is_doubles : false,
            existing.match_end_time
        ]
    );
}

/**
 * Rydder en bane, hvis kampen på den er afsluttet (match_completed), men ingen
 * har trykket "Ryd banen" på tabletten. Uden det stod banen som optaget, og
 * holdkampens næste delkamp kunne ikke tildeles den.
 *
 * Gør det samme som admins "Nulstil bane" for en afsluttet kamp: resultatet
 * gemmes til TV'et, tilstanden slettes, og tablet/TV får et 'reset'-event
 * (tabletten lukker "Kamp vundet" og står klar). Tildelinger røres ikke —
 * kalderen styrer dem. Gør intet ved en kamp, der er i gang.
 *
 * `courtNumber` er banens nummer. `skalVaere(row)` kan afvise rækken (fx kun
 * holdkampens egen kamp). Returnerer true, hvis banen blev ryddet.
 */
async function rydAfsluttetBane(courtNumber, req, skalVaere = null) {
    const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtNumber]);
    if (!court) return false;
    const existing = await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
    if (!existing || !existing.match_completed) return false;
    if (skalVaere && !skalVaere(existing)) return false;

    await gemSidsteAfsluttedeKamp(court.id, existing);
    await query('DELETE FROM game_states WHERE court_id = ?', [court.id]);
    await query('UPDATE courts SET is_active = FALSE, is_doubles = FALSE WHERE id = ?', [court.id]);

    try { await invalidateCourtTokens(courtNumber); } catch (e) { console.error('Token invalidation failed:', e); }

    publishGameStateChange(req, courtNumber, 'reset');
    return true;
}

module.exports = { gemSidsteAfsluttedeKamp, rydAfsluttetBane };
