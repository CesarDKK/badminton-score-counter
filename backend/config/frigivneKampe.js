/**
 * Kampe, scheduleren har frigivet efter inaktivitet (migration 051, rest af
 * nr. 4 i pakke P). Rækken i frigivne_kampe gør, at en tablet, der kommer
 * tilbage til en tom bane med kampen i gang, spørger "Fortsæt kampen?".
 *
 * Den må kun stå, mens banen er tom efter netop den frigivelse. Får banen en
 * ny række i game_states (en ny kamp, "Fortsæt", en tildeling), eller ryddes
 * den med vilje (admin, tabletten, en tildeling, planneren), glemmes den — ellers
 * kunne en tablet senere lægge den gamle kamp oven på en ny tildeling.
 * Scheduleren er den eneste, der sletter game_states og lader rækken stå.
 */
const db = require('./database');

async function glemFrigivetKamp(courtPk) {
    try {
        await db.query('DELETE FROM frigivne_kampe WHERE court_id = ?', [courtPk]);
    } catch (e) {
        /* før migration 051 */
    }
}

module.exports = { glemFrigivetKamp };
