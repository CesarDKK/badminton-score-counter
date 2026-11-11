/**
 * Validering af de to korte felter i kamphistorikken, som POST
 * /api/match-history modtager fra tabletten: gamesWon (sæt, fx "2-1") og
 * duration (varighed, fx "34:07").
 *
 * Felterne blev gemt råt og vist med innerHTML i adminens Kamphistorik, så en
 * QR-gæst kunne sende HTML ind (nr. 61). Admin escaper nu, og serveren tager
 * kun imod de formater, der faktisk bliver sendt:
 *   - tabletten (court-script-v3.js): gamesWon `${vinder}-${taber}`, duration
 *     formatDuration() = "MM:SS" (minutter kan blive over 99)
 *   - "Indtast resultat" (/result) og uret skriver selv i tabellen og bruger
 *     varighedTekst() fra matchTiming.js — samme "MM:SS" — og 'W.O.' ved walkover
 *
 * Ren funktion, så reglerne kan unit-testes.
 */

const SAET = /^(\d{1,2}-\d{1,2}|W\.O\.)$/;
const VARIGHED = /^\d{1,4}:[0-5]\d$/;

/** @returns {string|null} dansk fejltekst til et 400-svar, eller null hvis felterne er i orden */
function historikFelterFejl({ gamesWon, duration }) {
    if (typeof gamesWon !== 'string' || !SAET.test(gamesWon)) {
        return 'Ugyldigt resultat — forventede sæt som "2-1"';
    }
    if (typeof duration !== 'string' || !VARIGHED.test(duration)) {
        return 'Ugyldig varighed — forventede minutter og sekunder som "34:07"';
    }
    return null;
}

module.exports = { historikFelterFejl };
