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

        // Tvunget password-skift: et must-change-token kan KUN skifte adgangskode
        // (defense in depth — så flowet ikke kan omgås i browserens devtools).
        if (decoded.mustChange && !req.path.endsWith('/change-password')) {
            return res.status(403).json({ error: 'Skift adgangskoden først', mustChangePassword: true });
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

function generateSuperAdminToken(adminId, username, mustChange = false) {
    return jwt.sign(
        { role: 'super_admin', id: adminId, username, mustChange: !!mustChange },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
}

module.exports = { superAdminAuth, generateSuperAdminToken };
