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

// Automatisk "Ryd banen" efter holdkamp- og turneringskampe: resultatet er meldt
// ind, så snart kampen er vundet, men banen (tablet og TV) står med "Kamp vundet",
// til nogen trykker "Ryd banen" — og det glemmes tit efter de sidste kampe. Efter
// AUTO_RYD_EFTER_MIN minutter ryddes banen derfor af sig selv; TV'et viser
// resultatet et par minutter mere fra last_finished_matches.
//
// Kun baner, hvor kampen er afsluttet, og hvor navnene er en færdigmeldt
// holdkamp-/turneringskamps fra den bane. En almindelig kamp eller en
// badmintonplanner-runde (resultatet skal stå til næste runde) røres ikke.
const AUTO_RYD_EFTER_MIN = 5;

async function autoRydAfsluttedeBaner(req) {
    const spillere = (a1, a2, b1, b2) => `(${a1}, ${a2}, ${b1}, ${b2})`;
    const holdkamp = spillere('g.team1_player1', 'g.team1_player2', 'g.team2_player1', 'g.team2_player2');
    const turnering = spillere('m.side1_player1', 'm.side1_player2', 'm.side2_player1', 'm.side2_player2');
    const baner = await query(
        `SELECT c.court_number
           FROM game_states gs
           JOIN courts c ON c.id = gs.court_id
          WHERE gs.match_completed = TRUE
            AND gs.match_end_time <= NOW() - INTERVAL ? MINUTE
            AND (EXISTS (SELECT 1 FROM team_match_games g
                          WHERE g.court_number = c.court_number AND g.status = 'finished'
                            AND gs.player1_name IN ${holdkamp} AND gs.player2_name IN ${holdkamp})
              OR EXISTS (SELECT 1 FROM tournament_matches m
                          WHERE m.court_number = c.court_number AND m.status = 'finished'
                            AND gs.player1_name IN ${turnering} AND gs.player2_name IN ${turnering}))`,
        [AUTO_RYD_EFTER_MIN]
    );
    let ryddet = 0;
    for (const { court_number } of baner) {
        if (await rydAfsluttetBane(court_number, req)) {
            ryddet++;
            console.log(`✓ Bane ${court_number} ryddet automatisk (${AUTO_RYD_EFTER_MIN} min efter holdkamp-/turneringskamp)`);
        }
    }
    return ryddet;
}

module.exports = { gemSidsteAfsluttedeKamp, rydAfsluttetBane, autoRydAfsluttedeBaner, AUTO_RYD_EFTER_MIN };
