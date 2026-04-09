const jwt = require('jsonwebtoken');

function superAdminAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Ingen autorisation token' });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== 'super_admin') {
            return res.status(403).json({ error: 'Kun super admins har adgang' });
        }

        req.superAdmin = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token udløbet' });
        }
        return res.status(401).json({ error: 'Ugyldig token' });
    }
}

function generateSuperAdminToken(adminId, username) {
    return jwt.sign(
        { role: 'super_admin', id: adminId, username },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
}

module.exports = { superAdminAuth, generateSuperAdminToken };
