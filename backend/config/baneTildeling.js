// Tildeling af en holdkamps delkamp eller en turneringskamp til en bane (nr. 78).
//
// Før kunne admin sætte en kamp på en bane, hvor der blev spillet, uden at
// serveren sagde noget: kun admin-siden selv gråede optagne baner ud — ud fra
// en liste, der kunne være minutter gammel. Den igangværende kamp blev
// overskrevet (holdkamp) eller stod videre med sin stilling under den nye kamps
// navne og blev meldt ind som dens resultat (turnering).
//
// Nu svarer ruterne 409 (code 'bane_i_gang'), når admin sætter en kamp på en
// bane, hvor der spilles. Admin kan bekræfte og sende force: true. En tablet
// vælger kun til sin egen bane, hvor den selv ser, hvad der spilles — den
// rammes ikke af reglen (delkampRegler.js har tablettens egne regler).

const { queryOne, query } = require('./database');
const { banenErIGang } = require('./delkampRegler');
const { publishGameStateChange } = require('../events/gameStateEvents');

// Banens stilling (også om kampen er afsluttet)
function banensStilling(courtNumber) {
    return queryOne(
        `SELECT gs.player1_score, gs.player2_score, gs.player1_games, gs.player2_games,
                gs.timer_seconds, gs.match_completed
           FROM courts c JOIN game_states gs ON c.id = gs.court_id
          WHERE c.court_number = ?`,
        [courtNumber]
    );
}

// Kører der en kamp, som tildelingen ville afbryde? En afsluttet kamp gør ikke
// — dens resultat ryddes, som før, når den nye kamp lander.
function kampKoerer(gs) {
    return banenErIGang(gs) && !gs.match_completed;
}

/**
 * Ren regel. Returnerer null (tilladt) eller { error, code } til et 409-svar.
 *  stilling      banens stilling (banensStilling)
 *  sammeBane     kampen står allerede på mål-banen (ingen flytning)
 *  force         admin har bekræftet, at kampen på banen må afbrydes
 */
function tildelingAfvist({ stilling, sammeBane, force }) {
    if (sammeBane || force === true || !stilling || !kampKoerer(stilling)) return null;
    return {
        error: 'Der spilles på banen lige nu. Vent til kampen er slut, eller bekræft, at den skal afbrydes.',
        code: 'bane_i_gang'
    };
}

// Admin har bekræftet (force), at kampen på banen skal afbrydes: tilstanden
// slettes som ved admins "Nulstil bane", og tablet/TV får et 'reset'-event, så
// den nye kamp starter fra 0-0 i stedet for at arve den afbrudte kamps stilling.
// Kampen var ikke færdig, så den gemmes ikke til TV'ets "seneste resultat".
async function afbrydKamp(courtNumber, req) {
    const court = await queryOne('SELECT id FROM courts WHERE court_number = ?', [courtNumber]);
    if (!court) return false;
    await query('DELETE FROM game_states WHERE court_id = ?', [court.id]);
    await query('UPDATE courts SET is_active = FALSE WHERE id = ?', [court.id]);
    publishGameStateChange(req, courtNumber, 'reset');
    return true;
}

/**
 * Hele tjekket for en rute: afvis (returnerer { error, code }) eller tillad —
 * og afbryd i så fald en kørende kamp, som admin har bekræftet (force).
 */
async function tjekOgRydBane(courtNumber, req) {
    const stilling = await banensStilling(courtNumber);
    const afvist = tildelingAfvist({ stilling, sammeBane: false, force: req.body.force });
    if (afvist) return afvist;
    if (stilling && kampKoerer(stilling)) await afbrydKamp(courtNumber, req);
    return null;
}

// Spiller banen en holdkamps delkamp eller en turneringskamp (status 'active')?
// Så må der ikke udstedes en QR-session til den (nr. 82).
async function officielKampPaaBane(courtNumber) {
    const r = await queryOne(
        `SELECT (EXISTS (SELECT 1 FROM team_match_games g JOIN team_matches tm ON tm.id = g.team_match_id
                          WHERE g.court_number = ? AND g.status = 'active' AND tm.status = 'active'))
             OR (EXISTS (SELECT 1 FROM tournament_matches m JOIN tournaments t ON t.id = m.tournament_id
                          WHERE m.court_number = ? AND m.status = 'active' AND t.status = 'active')) AS optaget`,
        [courtNumber, courtNumber]
    );
    return !!(r && Number(r.optaget));
}

// Banen er nu en holdkamp-/turneringsbane: en badmintonplanner-tildeling fra en
// tidligere runde fjernes, så kampens resultat ikke også meldes til planneren.
async function fjernPlannerTildeling(courtNumber) {
    try {
        await query('DELETE FROM planner_court_assignments WHERE court_number = ?', [courtNumber]);
    } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;   // før migration 027
    }
}

module.exports = { banensStilling, kampKoerer, tildelingAfvist, afbrydKamp, tjekOgRydBane, officielKampPaaBane, fjernPlannerTildeling };
