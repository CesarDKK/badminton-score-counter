// Backendens opstart: er den klar, og hvordan gik det?
//
// Før gav opstarten op efter ca. halvandet minut, hvis databasen ikke svarede
// (fx efter en genstart af serveren, hvor MySQL er længe om at komme op): ingen
// migrationer og ingen baggrundsjob (midnatsrydning, holdkamp-vagt, banerydning,
// ur-pauser, ugentlig backup) — mens processen lyttede videre, og /health var
// grøn. Nu prøves der igen, til det lykkes (server.js), /health svarer 503
// indtil da, og super-admin viser status under Serverens helbred.

const tilstand = {
    startet: Date.now(),   // processen startede
    klar: null,            // databasen svarede, migrationerne er kørt, jobbene er startet
    forsoeg: 0,
    fejl: null             // seneste fejl under opstarten (ryddes, når den lykkes)
};

function forsoeg() { tilstand.forsoeg += 1; }
function fejlede(besked) { tilstand.fejl = String(besked || 'ukendt fejl').slice(0, 300); }
function erKlar() { return tilstand.klar !== null; }
function nuKlar(nu = Date.now()) { tilstand.klar = nu; tilstand.fejl = null; }

// Til super-admin. migrationer: migrationRunner.status() — { tid, databaser, fejl }
function status(migrationer = null, nu = Date.now()) {
    return {
        startet: new Date(tilstand.startet).toISOString(),
        klar: tilstand.klar === null ? null : new Date(tilstand.klar).toISOString(),
        // Sekunder fra processen startede, til den var klar (null: ikke klar endnu)
        klarEfterSek: tilstand.klar === null ? null : Math.round((tilstand.klar - tilstand.startet) / 1000),
        koertSek: Math.round((nu - tilstand.startet) / 1000),
        forsoeg: tilstand.forsoeg,
        fejl: tilstand.fejl,
        migrationer
    };
}

function _nulstil(nu = Date.now()) {
    tilstand.startet = nu; tilstand.klar = null; tilstand.forsoeg = 0; tilstand.fejl = null;
}

module.exports = { forsoeg, fejlede, erKlar, nuKlar, status, _nulstil };
