const express = require('express');
const { signAdminToken } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  const expected = process.env.FOOTBALL_ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: 'Admin password not configured on server' });
  }
  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = signAdminToken();
  res.json({ token });
});

module.exports = router;
