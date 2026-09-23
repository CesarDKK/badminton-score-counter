const crypto = require('crypto');

// Klub-admin-sessioner følger brugeren i databasen, ikke kun JWT'en.
//
// JWT'en gælder 24 timer, og før blev kun signaturen tjekket: en slettet admin,
// en admin hvis adgangskode var skiftet (fx fordi den var lækket), og en admin
// hvis side-rettigheder var indskrænket, beholdt sin adgang, til JWT'en udløb.
//
// Nu bærer tokenet et fingeraftryk af adgangskode-hashen (pv), og ved hver
// forespørgsel slås admin'en op: findes rækken ikke, eller er adgangskoden
// skiftet, afvises tokenet; side-rettighederne tages fra databasen.

// Kort, envejs fingeraftryk af bcrypt-hashen — afslører intet om adgangskoden
const kodeAftryk = (hash) => crypto.createHash('sha256').update(String(hash)).digest('base64url').slice(0, 16);

// Opslaget i klubbens database; kan udskiftes i tests
let hentKlubAdmin = async (id) => {
    const { queryOne } = require('../config/database');
    return queryOne('SELECT password_hash, page_permissions FROM club_admins WHERE id = ?', [id]);
};
function _saetKlubAdminOpslag(fn) { hentKlubAdmin = fn; }

// null = alle sider; ellers listen af side-nøgler (samme tolkning som ved login)
function tolkRettigheder(raa) {
    if (!raa) return null;
    try {
        const liste = typeof raa === 'string' ? JSON.parse(raa) : raa;
        return Array.isArray(liste) ? liste : null;
    } catch {
        return null;
    }
}

// Gælder klub-admin-tokenet stadig? Returnerer en fejltekst, ellers null — og
// sætter decoded.permissions til de aktuelle rettigheder fra databasen.
async function klubAdminAfvist(decoded) {
    const row = decoded.id ? await hentKlubAdmin(decoded.id) : null;
    if (!row) return 'Brugeren findes ikke længere — log ind igen';
    if (!decoded.pv || decoded.pv !== kodeAftryk(row.password_hash)) return 'Adgangskoden er ændret — log ind igen';
    decoded.permissions = tolkRettigheder(row.page_permissions);
    return null;
}

module.exports = { kodeAftryk, tolkRettigheder, klubAdminAfvist, _saetKlubAdminOpslag };
