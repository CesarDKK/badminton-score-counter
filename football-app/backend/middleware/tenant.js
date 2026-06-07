// Multi-tenant middleware: udleder football-klub fra request-hostname.
//
// Subdomain-mønster:  <subdomain>.footballapp.dk  → klub identificeret via subdomain
// Apex:               footballapp.dk / www        → req.clubId = null (landing-state)
// Lokal udvikling:    localhost, IP, custom hosts → req.clubId = null
//
// Sætter på req:
//   - clubId         (INT | null)
//   - clubSubdomain  (string | null)
//   - clubName       (string | null)
//
// Routes der KRÆVER klub-kontekst skal selv tjekke for req.clubId === null
// og returnere 404 eller 400 før de queryer DB.

const { pool } = require('../db');

const APP_DOMAIN = (process.env.FOOTBALL_APP_DOMAIN || 'footballapp.dk').toLowerCase();

function extractSubdomain(host) {
  if (!host) return null;
  const lower = host.toLowerCase();
  // Lokal/IP-adgang giver ingen klub-kontekst
  if (lower === 'localhost' || lower === APP_DOMAIN || lower === `www.${APP_DOMAIN}`) {
    return null;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) return null;
  // Skal slutte på app-domænet for at vi anerkender subdomain
  if (!lower.endsWith(`.${APP_DOMAIN}`)) return null;
  const sub = lower.slice(0, -(`.${APP_DOMAIN}`.length));
  // Drop nested subdomains (fx admin.foo.footballapp.dk) — vi tager kun top-level
  if (sub.includes('.')) return null;
  if (sub === 'www') return null;
  return sub;
}

async function tenantMiddleware(req, res, next) {
  try {
    const host = (req.hostname || '').toLowerCase();
    const subdomain = extractSubdomain(host);

    if (!subdomain) {
      req.clubId = null;
      req.clubSubdomain = null;
      req.clubName = null;
      return next();
    }

    const [rows] = await pool.query(
      'SELECT id, name, is_active FROM football_clubs WHERE subdomain = ? LIMIT 1',
      [subdomain]
    );
    const club = rows[0];

    if (!club) {
      return res.status(404).json({ error: `Klub '${subdomain}' findes ikke` });
    }
    if (!club.is_active) {
      return res.status(403).json({ error: `Klub '${subdomain}' er deaktiveret` });
    }

    req.clubId = club.id;
    req.clubSubdomain = subdomain;
    req.clubName = club.name;
    next();
  } catch (err) {
    console.error('tenant middleware error', err);
    next(err);
  }
}

// Helper til routes der kræver klub-kontekst (de fleste)
function requireClub(req, res, next) {
  if (!req.clubId) {
    return res.status(400).json({ error: 'Denne handling kræver et klub-subdomain' });
  }
  next();
}

module.exports = { tenantMiddleware, requireClub };
