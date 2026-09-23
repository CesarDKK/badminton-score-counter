const jwt = require('jsonwebtoken');
const { adgangslinkAfvist } = require('./auth');

// QR-tælleren: enhver telefon må scanne QR-koden på banens TV og tælle kampen
// uden login. Det skal blive ved med at være sådan — men adgangen skal følge
// det, man fysisk kan se i hallen:
//
//   1. Kun et TV (eller en admin) kan få udstedt QR-koden. Ellers kunne alle på
//      internettet hente /api/qr-code/1 og få skriveadgang til klubben.
//   2. En QR-session (tokenType 'match_session') gælder kun sin egen bane og
//      kun almindelig tælling — ikke holdkamp- og turneringsresultater.
//   3. Den ophører, når banen ryddes, tildeles en holdkamp/turneringskamp eller
//      frigives efter inaktivitet (rækken i device_tokens slettes). JWT'en
//      gælder 12 timer, så rækken tjekkes ved hver skrivning — det gør
//      requireWriteAuthInClubMode for alle adgangslinks (middleware/auth.js).

// Bane-nummeret en device-session hører til ('court/3' / 'tv/3' → 3), ellers null
function baneFraDestination(destination) {
    const m = /^(?:court|tv)\/(\d+)$/.exec(destination || '');
    return m ? parseInt(m[1], 10) : null;
}

const erQrSession = (user) => !!user && user.role === 'device' && user.tokenType === 'match_session';

// Efter requireWriteAuthInClubMode på bane-ruter: en QR-session må kun skrive
// til sin egen bane. (At sessionen stadig er aktiv, har requireWriteAuthInClubMode tjekket.)
// param = navnet på route-parameteren med banenummeret, eller en funktion (req) → banenummer.
function kunEgenBane(param) {
    return function (req, res, next) {
        if (!erQrSession(req.user)) return next();

        const bane = parseInt(typeof param === 'function' ? param(req) : req.params[param], 10);
        if (baneFraDestination(req.user.destination) !== bane) {
            return res.status(403).json({ error: 'QR-koden gælder en anden bane' });
        }
        next();
    };
}

// Holdkamp- og turneringsresultater er officielle: dem må en QR-session ikke skrive.
// (En bane, der får tildelt en sådan kamp, mister i forvejen sin QR-session.)
function ikkeQrSession(req, res, next) {
    if (erQrSession(req.user)) {
        return res.status(403).json({ error: 'QR-tælleren kan ikke indrapportere holdkamp- eller turneringsresultater' });
    }
    next();
}

// Må den, der kalder, få QR-koden til banen vist? Kun banens TV (et fast og
// stadig aktivt adgangslink til tv/<bane>, eller et gammelt TV-link uden bane),
// klubbens admin eller super-admin. Returnerer en HTTP-status ved afvisning, ellers null.
async function afvisQrKode(req, courtNumber) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return 401;

    let decoded;
    try {
        decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET);
    } catch {
        return 401;
    }

    if (decoded.role === 'super_admin') return null;
    if (decoded.clubSubdomain !== req.clubSubdomain) return 403;
    if (decoded.role === 'club_admin') return null;

    if (decoded.role === 'device' && decoded.tokenType !== 'match_session') {
        const dest = decoded.destination || '';
        const tv = dest === 'tv' || dest === 'tv-v3'                  // gamle TV-links uden bane
            || (dest.startsWith('tv/') && baneFraDestination(dest) === courtNumber);
        if (!tv) return 403;
        return (await adgangslinkAfvist(decoded)) ? 401 : null;       // tilbagekaldt TV-link
    }
    return 403;
}

module.exports = { kunEgenBane, ikkeQrSession, afvisQrKode, baneFraDestination };
