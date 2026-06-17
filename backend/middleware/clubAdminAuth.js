const jwt = require('jsonwebtoken');

function clubAdminAuth(req, res, next) {
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

        req.clubAdmin = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token udløbet' });
        }
        return res.status(401).json({ error: 'Ugyldig token' });
    }
}

// permissions: array af side-noegler brugeren maa tilgaa, eller null = alle sider
function generateClubAdminToken(adminId, username, clubSubdomain, permissions = null) {
    return jwt.sign(
        { role: 'club_admin', id: adminId, username, clubSubdomain, permissions },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );
}

module.exports = { clubAdminAuth, generateClubAdminToken };
