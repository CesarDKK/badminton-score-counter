const jwt = require('jsonwebtoken');
const { klubAdminAfvist, kodeAftryk } = require('./klubAdminSession');

// Klub-admin-endpoints (adgangslinks, eget kodeord). Tokenet skal være et
// club_admin-token udstedt til DENNE klub: klubben afgøres af subdomænet, og et
// token fra klub A må ikke give adgang til klub B's adgangslinks. Uden for
// club-mode (lokal installation, app., admin.) findes der ingen klub at være
// admin for, så her afvises club_admin-tokens også.
async function clubAdminAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Ingen autorisation token' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== 'club_admin') {
            return res.status(403).json({ error: 'Kun klub admins har adgang' });
        }

        if (req.accessMode !== 'club' || decoded.clubSubdomain !== req.clubSubdomain) {
            return res.status(403).json({ error: 'Token giver ikke adgang til denne klub' });
        }

        // Slettet admin eller skiftet adgangskode (se klubAdminSession.js)
        const afvist = await klubAdminAfvist(decoded);
        if (afvist) return res.status(401).json({ error: afvist, sessionEnded: true });

        req.clubAdmin = decoded;
        req.user = decoded; // så requirePage (side-rettigheder) kan bruges bagefter
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token udløbet' });
        }
        return res.status(401).json({ error: 'Ugyldig token' });
    }
}

// permissions: array af side-noegler brugeren maa tilgaa, eller null = alle sider.
// passwordHash: admin'ens aktuelle hash — fingeraftrykket (pv) gør tokenet ugyldigt,
// når adgangskoden skiftes.
function generateClubAdminToken(adminId, username, clubSubdomain, permissions = null, passwordHash = '') {
    return jwt.sign(
        { role: 'club_admin', id: adminId, username, clubSubdomain, permissions, pv: kodeAftryk(passwordHash) },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
}

module.exports = { clubAdminAuth, generateClubAdminToken };
