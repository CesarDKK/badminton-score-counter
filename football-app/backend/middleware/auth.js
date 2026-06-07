const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_football_secret';

// Underskriver et JWT for en klub-admin. Token indeholder klub-id + subdomain
// så vi efterfølgende kan validere at admin'en kun rammer sin egen klubs data.
function signClubAdminToken({ adminId, clubId, clubSubdomain }) {
  return jwt.sign(
    { role: 'club_admin', adminId, clubId, clubSubdomain },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// requireAdmin valider JWT OG at admin'ens klub matcher det aktuelle subdomain.
// Hvis nogen prøver at bruge en Lyngby-token mod brondby.footballapp.dk,
// returneres 403 — selv hvis token i sig selv er gyldig.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'club_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    // Cross-tenant beskyttelse: token's klub skal matche request's klub
    if (req.clubId && payload.clubId !== req.clubId) {
      return res.status(403).json({ error: 'Token tilhører en anden klub' });
    }
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { signClubAdminToken, requireAdmin };
