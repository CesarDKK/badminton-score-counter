/**
 * Regler for hvad en tablet (adgangslink, rolle 'device') må gøre ved en
 * holdkamps delkamp via PUT /api/team-matches/:id/games/:gameId.
 *
 * Ruten tjekkede kun, om MÅL-banen var optaget — aldrig delkampens egen status.
 * En tablet med en forældet liste kunne derfor genåbne en færdigspillet delkamp
 * (status tilbage til 'active'/'pending') eller trække en delkamp, der var i
 * gang på en anden bane, over på sin egen. Admin (club_admin, super_admin og
 * demoens admin) må stadig rette alt — det er dér, en fejl rettes.
 *
 * Ren funktion (ingen database), så reglen kan unit-testes.
 */

// Er banen i gang? Samme definition som admin-dropdownen og ruten bruger for
// den delkamp, der optager mål-banen: der er talt point, vundet sæt eller uret
// er startet.
function banenErIGang(gs) {
    return !!gs && (
        gs.player1_score > 0 || gs.player2_score > 0 ||
        gs.player1_games > 0 || gs.player2_games > 0 ||
        gs.timer_seconds > 0
    );
}

function sammeBane(a, b) {
    if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
    if (b === null || b === undefined || b === '') return false;
    return Number(a) === Number(b);
}

/**
 * @param {object} p
 * @param {boolean} p.erEnhed        kaldet kommer fra et adgangslink (role 'device')
 * @param {object}  p.delkamp        { status, court_number } som den står i databasen
 * @param {*}       p.status         ny status fra kaldet (undefined = uændret)
 * @param {*}       p.courtNumber    ny bane fra kaldet (undefined = uændret, null = frigiv)
 * @param {boolean} p.egenBaneIGang  delkampens NUVÆRENDE bane er i gang (se banenErIGang)
 * @returns {string|null} dansk fejltekst til et 409-svar, eller null hvis det er tilladt
 */
function delkampAendringAfvist({ erEnhed, delkamp, status, courtNumber, egenBaneIGang }) {
    if (!erEnhed || !delkamp) return null;

    const flytter = courtNumber !== undefined && !sammeBane(courtNumber, delkamp.court_number);

    if (delkamp.status === 'finished') {
        if (status === 'active' || status === 'pending') {
            return 'Delkampen er allerede færdigspillet og kan ikke genåbnes fra tabletten. Det kan admin gøre under Holdkamp.';
        }
        if (flytter) {
            return 'Delkampen er allerede færdigspillet og kan ikke flyttes til en bane. Vælg en anden delkamp.';
        }
        return null;
    }

    // Spilles allerede på en anden bane, og dér er der talt point: en anden
    // tablet må ikke trække den over til sig (frigivelse = null er tabletten på
    // banens egen "Ryd banen", som skal kunne slippe delkampen igen).
    if (delkamp.status === 'active' && delkamp.court_number !== null && delkamp.court_number !== undefined
        && courtNumber !== undefined && courtNumber !== null && flytter && egenBaneIGang) {
        return `Delkampen spilles allerede på bane ${delkamp.court_number}. Vælg en anden delkamp, eller lad admin flytte den.`;
    }

    return null;
}

module.exports = { banenErIGang, delkampAendringAfvist, sammeBane };
