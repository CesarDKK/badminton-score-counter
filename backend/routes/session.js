const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { fornyetToken } = require('../middleware/sessionForny');

// POST /api/session/forny — "Jeg er her stadig": nyt admin-token før det gamle
// udløber. authMiddleware afgør, om tokenet stadig gælder her (rolle, klub,
// slettet admin, skiftet adgangskode); device-tokens kan ikke fornyes.
router.post('/forny', authMiddleware, (req, res) => {
    const token = fornyetToken(req.user);
    if (!token) {
        return res.status(401).json({
            error: 'Du har været logget ind i en uge. Log ind igen.',
            sessionEnded: true
        });
    }
    res.json({ token });
});

module.exports = router;
