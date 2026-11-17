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
const { glemFrigivetKamp } = require('./frigivneKampe');
const { publishGameStateChange } = require('../events/gameStateEvents');
const { rydAfsluttetBane } = require('./banerydning');
const { meldAfgjortKamp, holdPaaPlads, holdkampNavne } = require('../taeller/resultatMelding');

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
// — dens resultat ryddes, når den nye kamp lander (holdkamp: teamMatches.js,
// turnering: rydAfsluttetFoerTildeling herunder).
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
    await glemFrigivetKamp(court.id);   // ryddet med vilje (rest af nr. 4)
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

// Står den afsluttede stilling under navnene fra kampen hold1/hold2 — én side
// på hver plads? (Kun de første navne: i single står makker-feltet ofte med
// et gammelt navn eller "Makker 1".)
function stillingErKampens(gs, hold1, hold2) {
    const p1 = holdPaaPlads([gs.player1_name], hold1, hold2);
    const p2 = holdPaaPlads([gs.player2_name], hold1, hold2);
    return !!p1 && !!p2 && p1 !== p2;
}

// En kamp, der stadig står 'active' på banen (ikke den, der tildeles), og
// hvis navne står på den afsluttede stilling: dens resultat er ikke meldt ind.
// Returnerer en kort beskrivelse til admin — eller null.
async function uindmeldtResultat(courtNumber, gs, turneringskampId) {
    const m = await queryOne(
        `SELECT m.id, m.side1_player1, m.side1_player2, m.side2_player1, m.side2_player2
           FROM tournament_matches m JOIN tournaments t ON t.id = m.tournament_id
          WHERE m.court_number = ? AND m.status = 'active' AND t.status = 'active' AND m.id != ?
          ORDER BY m.id LIMIT 1`,
        [courtNumber, turneringskampId || 0]
    );
    if (m) {
        const hold1 = [m.side1_player1, m.side1_player2].filter(Boolean);
        const hold2 = [m.side2_player1, m.side2_player2].filter(Boolean);
        if (stillingErKampens(gs, hold1, hold2)) {
            return { hvad: 'turnering', navne: `${hold1.join(' / ')} – ${hold2.join(' / ')}` };
        }
    }
    const g = await queryOne(
        `SELECT g.team1_player1, g.team1_player2, g.team2_player1, g.team2_player2,
                tm.team1_name, tm.team2_name
           FROM team_match_games g JOIN team_matches tm ON tm.id = g.team_match_id
          WHERE g.court_number = ? AND g.status = 'active' AND tm.status = 'active'
          ORDER BY g.id LIMIT 1`,
        [courtNumber]
    );
    if (g) {
        const { hold1, hold2 } = holdkampNavne(g);
        if (stillingErKampens(gs, hold1, hold2)) {
            return { hvad: 'holdkamp', navne: `${hold1[0]} – ${hold2[0]}` };
        }
    }
    return null;
}

/**
 * En turneringskamp sættes på en bane, hvor forrige kamp er slut, men ikke
 * ryddet (ingen trykkede "Ryd banen", og de 5 min til auto-rydning er ikke
 * gået) — nr. 104. Før stod den gamle slutstilling videre under den nye kamps
 * navne, auto-rydningen ramte ikke længere, og "Ryd banen" satte den nye kamp
 * tilbage til afventer — eller meldte den færdig med den gamle kamps resultat.
 *
 * Nu ryddes banen som holdkampens tildeling gør (banerydning.rydAfsluttetBane):
 * resultatet gemmes til TV'et, tilstanden slettes, og tablet/TV får 'reset'.
 * Først meldes resultatet ind, som "Ryd banen" gør, hvis det ikke er sket.
 * Hører slutstillingen stadig til en kamp, der står 'active' på banen (den
 * kunne ikke meldes ind), ryddes intet: 409 (code 'bane_resultat_mangler'),
 * så resultatet ikke går tabt — som holdkampens tildeling.
 *
 * Returnerer null (banen er klar) eller { error, code } til et 409-svar.
 */
async function rydAfsluttetFoerTildeling(courtNumber, req, turneringskampId) {
    const gs = await queryOne(
        `SELECT gs.*, c.is_doubles AS bane_double
           FROM courts c JOIN game_states gs ON c.id = gs.court_id
          WHERE c.court_number = ?`,
        [courtNumber]
    );
    if (!gs || !gs.match_completed) return null;

    try {
        await meldAfgjortKamp(req, courtNumber, gs, { erDouble: !!gs.bane_double });
    } catch (e) { console.error('Indmelding af kampresultat fejlede:', e.message); }

    const mangler = await uindmeldtResultat(courtNumber, gs, turneringskampId);
    if (mangler) {
        const hvor = mangler.hvad === 'holdkamp' ? 'i holdkampen' : 'i turneringslisten';
        return {
            error: `Kampen på bane ${courtNumber} (${mangler.navne}) er slut, men resultatet er ikke meldt ind. ` +
                `Indtast resultatet ${hvor} først — ellers går det tabt.`,
            code: 'bane_resultat_mangler'
        };
    }
    await rydAfsluttetBane(courtNumber, req);
    return null;
}

// Spiller banen en turneringskamp (status 'active')? En QR-session må tælle en
// holdkamps delkamp på sin egen bane (Jesper, 2026-11-13: klubben slår QR-koden
// fra, når der afvikles turneringer), men aldrig en turneringskamp (nr. 82).
async function turneringPaaBane(courtNumber) {
    const r = await queryOne(
        `SELECT EXISTS (SELECT 1 FROM tournament_matches m JOIN tournaments t ON t.id = m.tournament_id
                         WHERE m.court_number = ? AND m.status = 'active' AND t.status = 'active') AS optaget`,
        [courtNumber]
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

module.exports = {
    banensStilling, kampKoerer, tildelingAfvist, afbrydKamp, tjekOgRydBane, turneringPaaBane, fjernPlannerTildeling,
    stillingErKampens, uindmeldtResultat, rydAfsluttetFoerTildeling
};
