const jwt = require('jsonwebtoken');
const { klubAdminAfvist } = require('./klubAdminSession');

// Admin-auth til beskyttede endpoints (backup, indstillinger, sponsorer, sletning m.m.).
//
// En gyldig signatur er IKKE nok: token-typen og klubben skal også passe.
// Uden det kan et device-token (som TV/tablets bærer i deres bogmærke-links)
// eller et token udstedt til klub A kalde admin-endpoints hos klub B.
//
// Accepteres:
//   - super_admin: altid (styrer alle klubber)
//   - club_admin:  kun på den klub tokenet er udstedt til, og kun så længe
//                  admin'en findes og adgangskoden er den samme (klubAdminSession.js)
//   - { admin: true } (simpelt admin-login): kun uden for club-mode — i club-mode
//     udstedes den slags tokens slet ikke (se routes/auth.js), og et gammelt/
//     fremmed et af slagsen må ikke give adgang på tværs af klubber
// Afvises altid:
//   - device-tokens: de er visnings-/tælleradgang, ikke administration
async function authMiddleware(req, res, next) {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Ingen autorisation token' });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role === 'device') {
            return res.status(403).json({ error: 'Adgangslinket giver ikke admin-adgang' });
        }

        if (req.accessMode === 'club') {
            const erKlubbensAdmin = decoded.role === 'club_admin'
                && decoded.clubSubdomain === req.clubSubdomain;
            if (!erKlubbensAdmin && decoded.role !== 'super_admin') {
                return res.status(403).json({ error: 'Token giver ikke adgang til denne klub' });
            }
        } else if (decoded.admin !== true && decoded.role !== 'super_admin') {
            // Uden for club-mode (lokal installation, app., admin.) er der ingen klub
            // at være klub-admin for — et klub-admin-token giver ikke adgang her
            return res.status(403).json({ error: 'Token giver ikke admin-adgang' });
        }

        // Slettet admin eller skiftet adgangskode: sessionen gælder ikke længere
        if (decoded.role === 'club_admin') {
            const afvist = await klubAdminAfvist(decoded);
            if (afvist) return res.status(401).json({ error: afvist, sessionEnded: true });
        }

        // Attach decoded payload to request
        req.user = decoded;

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Ugyldig token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token udløbet' });
        }
        return res.status(500).json({ error: 'Autentificeringsfejl' });
    }
}

// Generate JWT token
function generateToken(payload) {
    return jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: '24h' } // Token expires in 24 hours
    );
}

// Er adgangslinket (device_tokens-rækken) stadig aktivt? JWT'en fra /t/:token
// gælder 12 timer (QR) eller 14 dage (faste links), så uden dette opslag virkede
// et tilbagekaldt eller slettet link, til JWT'en udløb. Kan udskiftes i tests.
let erAdgangslinkAktiv = async (tokenId) => {
    const { queryOne } = require('../config/database');
    const row = await queryOne('SELECT id FROM device_tokens WHERE id = ? AND is_active = 1', [tokenId]);
    return !!row;
};
function _saetAdgangslinkOpslag(fn) { erAdgangslinkAktiv = fn; }

// Svaret, når et adgangslink ikke længere gælder. QR-tællere (match_session)
// får "kampen er afsluttet" — deres session slutter, når banen ryddes.
async function adgangslinkAfvist(decoded) {
    if (decoded.role !== 'device') return null;
    if (decoded.tokenId && await erAdgangslinkAktiv(decoded.tokenId)) return null;
    const qr = decoded.tokenType === 'match_session';
    return {
        error: qr ? 'Kampen er afsluttet — scan QR-koden igen' : 'Adgangslinket er tilbagekaldt',
        authRequired: true,
        tokenRevoked: true,
        qrSessionEnded: qr
    };
}

// Håndhæv gyldigt token på skrive-operationer — men KUN i club-mode.
//
// I club-mode er API'et offentligt på internettet (klub.badmintonapp.dk), så en
// ubeskyttet skrive-rute kan misbruges af hvem som helst der kender subdomænet +
// et banenummer. Her kræver vi derfor et backend-udstedt token (device eller
// club_admin), som tæller/TV/QR allerede bærer via /t/:token- og login-flows.
//
// I direct-mode (lokal installation) er der ingen token-infrastruktur, og
// LAN'et/firewallen er grænsen — dér bevares den nuværende åbne adfærd uændret.
//
// Cross-club-guard: et token udstedt til én klub må ikke skrive til en anden.
async function requireWriteAuthInClubMode(req, res, next) {
    if (req.accessMode !== 'club') return next();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Adgang kræver et gyldigt adgangslink',
            authRequired: true
        });
    }

    let decoded;
    try {
        decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET);
    } catch (error) {
        return res.status(401).json({
            error: error.name === 'TokenExpiredError' ? 'Adgangslink udløbet' : 'Ugyldigt adgangslink',
            authRequired: true
        });
    }

    // Kun tokens udstedt til DENNE klub (device/club_admin bærer clubSubdomain)
    // eller super-admin. Et token uden klub-tilknytning — fx det simple
    // { admin: true }-login fra en lokal installation — er bevidst IKKE nok:
    // ellers ville standardadgangskoden på én installation åbne alle klubber.
    if (decoded.role !== 'super_admin' && decoded.clubSubdomain !== req.clubSubdomain) {
        return res.status(403).json({ error: 'Adgangslink hører til en anden klub', authRequired: true });
    }

    // Tilbagekaldt, slettet eller (QR) afsluttet adgangslink — og for klub-admins:
    // slettet bruger eller skiftet adgangskode
    try {
        const afvist = await adgangslinkAfvist(decoded);
        if (afvist) return res.status(401).json(afvist);
        if (decoded.role === 'club_admin') {
            const fejl = await klubAdminAfvist(decoded);
            if (fejl) return res.status(401).json({ error: fejl, authRequired: true, sessionEnded: true });
        }
    } catch (err) {
        return next(err);
    }

    req.user = decoded;
    next();
}

module.exports = {
    authMiddleware,
    generateToken,
    requireWriteAuthInClubMode,
    adgangslinkAfvist,
    _saetAdgangslinkOpslag
};
