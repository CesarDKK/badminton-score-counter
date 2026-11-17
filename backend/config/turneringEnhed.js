// Hvad en tablet må ændre ved en turneringskamp (nr. 105).
//
// Tabletten binder sig til den første turneringskamp, den ser på sin bane, og
// slipper først bindingen ved "Ryd banen" eller kampslut. Bytter admin en
// kamp, der ikke er startet, ud med en anden (eller taster W.O.), tæller
// tabletten den nye kamp under den nye kamps navne — men melder resultatet ind
// på den gamle: PUT …/matches/<gammel> { status: 'finished', winnerTeam: 2,
// setScores: <den nye kamps sæt> }. Den gamle kamp stod så som færdig med et
// opdigtet resultat.
//
// Nu må en enhed kun ændre en turneringskamp, der lige nu står 'active' på
// enhedens egen bane. Alt andet besvares 200 uden ændring: den uændrede
// tablet (court-script-v3, reportTournamentResult) logger kun fejl i konsollen
// og prøver ikke igen, så et 200 er det, den tager roligst imod.
//
// Normalforløbet: serveren har som regel selv meldt kampen færdig
// (taeller/resultatMelding.js), før tablettens kald kommer — kampen er da
// 'finished', og kaldet ændrer intet (før skrev det samme resultat igen).
// Springer serverens melding over (single/double passer ikke med banen,
// navnene genkendes ikke, stillingen begyndte før tildelingen), står kampen
// stadig 'active' på banen, og tablettens melding gælder som før.

const { queryOne } = require('./database');
const { baneFraDestination } = require('../middleware/qrSession');
const { stillingErKampens } = require('./baneTildeling');

/**
 * Kommer kaldet fra en tælle-enhed? Et adgangslink (role 'device'). På en lokal
 * installation (og demoen) har tabletten intet token, mens admin altid sender
 * sit login — så et kald uden token dér er tablettens.
 */
function erEnhed(req) {
    if (req.user && req.user.role === 'device') return true;
    if (req.accessMode === 'club' || req.user) return false;
    return !/^Bearer /.test((req.headers && req.headers.authorization) || '');
}

// Enhedens egen bane: adgangslinkets court/N — ellers ukendt (null)
function egenBane(req) {
    const d = req.user && req.user.role === 'device' ? req.user.destination : null;
    return /^court\/\d+$/.test(d || '') ? baneFraDestination(d) : null;
}

/**
 * Ren regel. Returnerer null (tilladt) eller grunden til, at intet ændres.
 *  match     kampens række (status, court_number og navne)
 *  bane      enhedens egen bane (null = ukendt)
 *  status    den status, enheden sender
 *  stilling  game_states for kampens bane — bruges kun, når banen er ukendt
 */
function enhedsAendringAfvist({ match, bane, status, stilling }) {
    if (!match || match.status !== 'active' || match.court_number == null) {
        return 'kampen er ikke i gang på en bane';
    }
    if (bane != null && Number(match.court_number) !== Number(bane)) {
        return `kampen står på bane ${match.court_number}`;
    }
    // Ukendt bane (lokal installation): et resultat gælder kun, når kampens
    // bane står med en afsluttet stilling under kampens navne
    if (bane == null && status === 'finished') {
        const hold1 = [match.side1_player1, match.side1_player2].filter(Boolean);
        const hold2 = [match.side2_player1, match.side2_player2].filter(Boolean);
        if (!stilling || !stilling.match_completed || !stillingErKampens(stilling, hold1, hold2)) {
            return 'banens stilling er ikke kampens';
        }
    }
    return null;
}

/** Hele tjekket for ruten: null (tilladt) eller grunden. */
async function enhedMaaIkkeAendre(req, match, status) {
    const bane = egenBane(req);
    let stilling = null;
    if (bane == null && status === 'finished' && match.court_number != null) {
        stilling = await queryOne(
            `SELECT gs.player1_name, gs.player2_name, gs.match_completed
               FROM courts c JOIN game_states gs ON c.id = gs.court_id
              WHERE c.court_number = ?`,
            [match.court_number]
        );
    }
    return enhedsAendringAfvist({ match, bane, status, stilling });
}

module.exports = { erEnhed, egenBane, enhedsAendringAfvist, enhedMaaIkkeAendre };
