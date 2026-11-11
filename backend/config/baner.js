/**
 * Baner ud over "Antal baner" (settings.court_count) er SKJULTE, ikke slettede.
 *
 * Før slettede PUT /api/settings/court-count rækkerne i `courts`, og
 * match_history, game_states og last_finished_matches hænger på courts(id) med
 * ON DELETE CASCADE — så en klub, der satte antallet ned fra 6 til 4, mistede
 * hele kamphistorikken for bane 5 og 6 (også når antallet blev sat op igen).
 *
 * Nu bliver rækkerne liggende, og alle steder, der lister baner eller lader en
 * tablet, et ur, planneren eller livestreamen arbejde på en bane, ser kun de
 * synlige. En skjult bane opfører sig altså som en slettet — bortset fra at
 * dens historik er der endnu, og at den kommer tilbage, når antallet hæves.
 */

// Faldbak, hvis indstillingen mangler: maksimum fra indstillingssiden, så ingen
// baner forsvinder på grund af en manglende række
const MAKS_BANER = 20;

/**
 * SQL-betingelse: banen er inden for "Antal baner".
 * @param {string} [alias] tabel-alias for courts (fx 'c'), hvis forespørgslen har et
 */
function synligBane(alias) {
    const kol = alias ? `${alias}.court_number` : 'court_number';
    return `${kol} <= COALESCE((SELECT CAST(bs.setting_value AS UNSIGNED) FROM settings bs
                                 WHERE bs.setting_key = 'court_count'), ${MAKS_BANER})`;
}

/**
 * Teksten til 409-svaret, når "Antal baner" sænkes, mens en bane, der skjules,
 * er i brug. Ren funktion til unit-test.
 *
 * @param {number} courtCount  det nye antal
 * @param {Array<{court_number:number, grund:string}>} optaget  baner over antallet, der er i brug
 * @returns {string|null}
 */
function nedsaettelseAfvist(courtCount, optaget) {
    const baner = [...new Set((optaget || [])
        .filter(o => Number(o.court_number) > Number(courtCount))
        .map(o => Number(o.court_number)))].sort((a, b) => a - b);
    if (baner.length === 0) return null;
    const grunde = [...new Set((optaget || [])
        .filter(o => baner.includes(Number(o.court_number)))
        .map(o => o.grund))];
    const navn = baner.length === 1 ? `Bane ${baner[0]}` : `Bane ${baner.slice(0, -1).join(', ')} og ${baner[baner.length - 1]}`;
    return `${navn} er i brug (${grunde.join(', ')}). Afslut eller ryd ${baner.length === 1 ? 'banen' : 'banerne'}, før antallet sættes ned til ${courtCount}.`;
}

module.exports = { synligBane, nedsaettelseAfvist, MAKS_BANER };
