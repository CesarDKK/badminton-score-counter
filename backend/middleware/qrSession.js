const jwt = require('jsonwebtoken');

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
//      gælder 12 timer, så rækken tjekkes ved hver skrivning.

// Bane-nummeret en device-session hører til ('court/3' / 'tv/3' → 3), ellers null
function baneFraDestination(destination) {
    const m = /^(?:court|tv)\/(\d+)$/.exec(destination || '');
    return m ? parseInt(m[1], 10) : null;
}

const erQrSession = (user) => !!user && user.role === 'device' && user.tokenType === 'match_session';

async function standardErAktiv(tokenId) {
    const { queryOne } = require('../config/database');
    const row = await queryOne(
        "SELECT id FROM device_tokens WHERE id = ? AND token_type = 'match_session' AND is_active = 1",
        [tokenId]
    );
    return !!row;
}

// Efter requireWriteAuthInClubMode på bane-ruter: en QR-session må kun skrive
// til sin egen bane, og kun så længe sessionen ikke er afsluttet.
// param = navnet på route-parameteren med banenummeret, eller en funktion (req) → banenummer.
function kunEgenBane(param, { erAktiv = standardErAktiv } = {}) {
    return async function (req, res, next) {
        if (!erQrSession(req.user)) return next();

        const bane = parseInt(typeof param === 'function' ? param(req) : req.params[param], 10);
        if (baneFraDestination(req.user.destination) !== bane) {
            return res.status(403).json({ error: 'QR-koden gælder en anden bane' });
        }
        try {
            if (!(await erAktiv(req.user.tokenId))) {
                return res.status(401).json({
                    error: 'Kampen er afsluttet — scan QR-koden igen',
                    authRequired: true,
                    qrSessionEnded: true
                });
            }
        } catch (err) {
            return next(err);
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

// Må den, der kalder, få QR-koden til banen vist? Kun banens TV (et fast
// adgangslink til tv/<bane>, eller et gammelt TV-link uden bane), klubbens
// admin eller super-admin. Returnerer en HTTP-status ved afvisning, ellers null.
function afvisQrKode(req, courtNumber) {
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
        if (dest === 'tv' || dest === 'tv-v3') return null;           // gamle TV-links uden bane
        if (dest.startsWith('tv/') && baneFraDestination(dest) === courtNumber) return null;
    }
    return 403;
}

module.exports = { kunEgenBane, ikkeQrSession, afvisQrKode, baneFraDestination };
