const jwt = require('jsonwebtoken');

// Admin-auth til beskyttede endpoints (backup, indstillinger, sponsorer, sletning m.m.).
//
// En gyldig signatur er IKKE nok: token-typen og klubben skal også passe.
// Uden det kan et device-token (som TV/tablets bærer i deres bogmærke-links)
// eller et token udstedt til klub A kalde admin-endpoints hos klub B.
//
// Accepteres:
//   - super_admin: altid (styrer alle klubber)
//   - club_admin:  kun på den klub tokenet er udstedt til
//   - { admin: true } (simpelt admin-login): kun uden for club-mode — i club-mode
//     udstedes den slags tokens slet ikke (se routes/auth.js), og et gammelt/
//     fremmed et af slagsen må ikke give adgang på tværs af klubber
// Afvises altid:
//   - device-tokens: de er visnings-/tælleradgang, ikke administration
function authMiddleware(req, res, next) {
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
        } else if (decoded.admin !== true
            && decoded.role !== 'club_admin'
            && decoded.role !== 'super_admin') {
            return res.status(403).json({ error: 'Token giver ikke admin-adgang' });
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
function requireWriteAuthInClubMode(req, res, next) {
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

    req.user = decoded;
    next();
}

module.exports = {
    authMiddleware,
    generateToken,
    requireWriteAuthInClubMode
};
