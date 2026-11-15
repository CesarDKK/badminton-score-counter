const jwt = require('jsonwebtoken');
const { kodeAftryk } = require('./klubAdminSession');

// Super-admin-sessioner følger brugeren i master-databasen (nr. 18), som
// klub-admins (klubAdminSession.js): tokenet bærer et aftryk af adgangskode-
// hashen (pv), og ved hvert kald slås admin'en op. Før var signaturen og
// rollen nok: et stjålet token virkede i 8 timer og kunne fornyes i op til 7
// dage (/api/session/forny), også efter et skift af adgangskoden. Et token fra
// før aftrykket kom med afvises — man logger ind igen.

// Opslaget i master-databasen; kan udskiftes i tests
let hentSuperAdmin = async (id) => {
    const masterDb = require('../config/masterDatabase');
    return masterDb.queryOne('SELECT password_hash FROM super_admins WHERE id = ?', [id]);
};
function _saetSuperAdminOpslag(fn) { hentSuperAdmin = fn; }

// Gælder super-admin-tokenet stadig? Returnerer en fejltekst, ellers null
async function superAdminAfvist(decoded) {
    const row = decoded.id ? await hentSuperAdmin(decoded.id) : null;
    if (!row) return 'Brugeren findes ikke længere — log ind igen';
    if (!decoded.pv || decoded.pv !== kodeAftryk(row.password_hash)) return 'Adgangskoden er ændret — log ind igen';
    return null;
}

// Tvunget password-skift: et must-change-token kan KUN skifte adgangskode —
// det kan heller ikke bruges på klubbernes API (middleware/auth.js)
const MAA_SKIFTE = { error: 'Skift adgangskoden først', mustChangePassword: true };

async function superAdminAuth(req, res, next) {
    let decoded;
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Ingen autorisation token' });
        }
        decoded = jwt.verify(authHeader.substring(7), process.env.JWT_SECRET);
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token udløbet', sessionExpired: true });
        }
        return res.status(401).json({ error: 'Ugyldig token' });
    }

    if (decoded.role !== 'super_admin') {
        return res.status(403).json({ error: 'Kun super admins har adgang' });
    }

    // (defense in depth — så flowet ikke kan omgås i browserens devtools)
    if (decoded.mustChange && !req.path.endsWith('/change-password')) {
        return res.status(403).json(MAA_SKIFTE);
    }

    try {
        const afvist = await superAdminAfvist(decoded);
        if (afvist) return res.status(401).json({ error: afvist, sessionEnded: true });
    } catch (err) {
        return next(err);
    }

    req.superAdmin = decoded;
    next();
}

// passwordHash: admin'ens aktuelle hash — aftrykket (pv) gør tokenet ugyldigt,
// når adgangskoden skiftes
function generateSuperAdminToken(adminId, username, mustChange = false, passwordHash = '') {
    return jwt.sign(
        { role: 'super_admin', id: adminId, username, mustChange: !!mustChange, pv: kodeAftryk(passwordHash) },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
}

module.exports = { superAdminAuth, generateSuperAdminToken, superAdminAfvist, MAA_SKIFTE, _saetSuperAdminOpslag };
