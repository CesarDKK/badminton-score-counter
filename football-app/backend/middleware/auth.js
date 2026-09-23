const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_football_secret';

// Kort, envejs fingeraftryk af adgangskode-hashen. Står i tokenet, så en ny
// adgangskode gør alle gamle sessioner ugyldige (JWT'en gælder 7 dage).
const kodeAftryk = (hash) => crypto.createHash('sha256').update(String(hash)).digest('base64url').slice(0, 16);

// Underskriver et JWT for en klub-admin. Token indeholder klub-id + subdomain
// så vi efterfølgende kan validere at admin'en kun rammer sin egen klubs data.
function signClubAdminToken({ adminId, clubId, clubSubdomain, passwordHash = '' }) {
  return jwt.sign(
    { role: 'club_admin', adminId, clubId, clubSubdomain, pv: kodeAftryk(passwordHash) },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Opslaget af admin'en; kan udskiftes i tests
let hentAdmin = async (adminId, clubId) => {
  const { pool } = require('../db');
  const [rows] = await pool.query(
    'SELECT password_hash FROM football_club_admins WHERE id = ? AND club_id = ? LIMIT 1',
    [adminId, clubId]
  );
  return rows[0] || null;
};
function _saetAdminOpslag(fn) { hentAdmin = fn; }

// requireAdmin valider JWT OG at admin'ens klub matcher det aktuelle subdomain.
// Hvis nogen prøver at bruge en Lyngby-token mod brondby.footballapp.dk,
// returneres 403 — selv hvis token i sig selv er gyldig.
// Derudover slås admin'en op: er den slettet, eller er adgangskoden skiftet
// (super-admin "Nulstil adgangskode"), gælder sessionen ikke længere.
async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing token' });
  }
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (payload.role !== 'club_admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Cross-tenant beskyttelse: token's klub skal matche request's klub
  if (req.clubId && payload.clubId !== req.clubId) {
    return res.status(403).json({ error: 'Token tilhører en anden klub' });
  }
  try {
    const admin = await hentAdmin(payload.adminId, payload.clubId);
    if (!admin) return res.status(401).json({ error: 'Brugeren findes ikke længere — log ind igen', sessionEnded: true });
    if (!payload.pv || payload.pv !== kodeAftryk(admin.password_hash)) {
      return res.status(401).json({ error: 'Adgangskoden er ændret — log ind igen', sessionEnded: true });
    }
  } catch (err) {
    return next(err);
  }
  req.admin = payload;
  next();
}

module.exports = { signClubAdminToken, requireAdmin, kodeAftryk, _saetAdminOpslag };
