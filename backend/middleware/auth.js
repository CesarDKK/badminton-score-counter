const jwt = require('jsonwebtoken');

// Middleware to verify JWT token
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

module.exports = {
    authMiddleware,
    generateToken
};
