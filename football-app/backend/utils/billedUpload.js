const fs = require('fs');
const path = require('path');

// Uploadede billeder (hold-, turnerings- og klub-logoer) serveres fra /api/uploads
// på ALLE klubbers subdomæner, og admin-tokenet ligger i localStorage. Før blev
// filendelsen taget fra klientens filnavn og typen fra klientens egen angivelse:
// en SVG med <script> eller en .html-fil sendt som image/png blev gemt og kunne
// åbnes på fx brondby.footballapp.dk — og læse Brøndbys admin-token.
//
// Tre lag: endelsen udledes af typen (whitelist), indholdet tjekkes (magic bytes,
// og SVG'er uden scripts), og /api/uploads serveres med en sandbox-CSP, så en fil
// aldrig kan køre scripts, heller ikke dem der allerede ligger der.

const ENDELSE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};
const SERVEREDE_ENDELSER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

const endelseFraType = (mimetype) => ENDELSE[mimetype] || null;

// multer fileFilter: kun de tilladte billedtyper
function billedFilter(req, file, cb) {
  if (!endelseFraType(file.mimetype)) {
    const fejl = new Error('Kun billedfiler er tilladt (PNG, JPG, WebP, GIF, SVG)');
    fejl.status = 400; // server.js' fejlhåndtering bruger err.status
    return cb(fejl);
  }
  cb(null, true);
}

// SVG er tekst og kan indeholde scripts og event-handlere
const FARLIG_SVG = /<script|<foreignobject|<iframe|<embed|<object|\son[a-z]+\s*=|javascript:|data:text\/html|<!entity/i;

// Passer indholdet til typen? (buffer = filens bytes)
function erGyldigtBillede(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const b = buffer;
  switch (mimetype) {
    case 'image/png': return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/jpeg': return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/gif': return b.slice(0, 4).toString('latin1') === 'GIF8';
    case 'image/webp': return b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP';
    case 'image/svg+xml': {
      const tekst = b.toString('utf8');
      return /<svg[\s>]/i.test(tekst) && !FARLIG_SVG.test(tekst);
    }
    default: return false;
  }
}

// Efter multer: den gemte fil skal være et rigtigt billede, ellers slettes den og kaldet afvises
function tjekUploadetBillede(req, res, next) {
  if (!req.file) return next();
  let ok = false;
  try { ok = erGyldigtBillede(fs.readFileSync(req.file.path), req.file.mimetype); } catch { ok = false; }
  if (ok) return next();
  try { fs.unlinkSync(req.file.path); } catch { /* allerede væk */ }
  return res.status(400).json({ error: 'Filen er ikke et gyldigt billede (eller SVG\'en indeholder scripts)' });
}

// multer filename: <prefix>_<tid><endelse fra typen>
const filnavn = (prefix) => (req, file, cb) => cb(null, `${prefix(req)}_${Date.now()}${endelseFraType(file.mimetype)}`);

// Til express.static på /api/uploads: kun billeder, og aldrig scripts
function kunBilleder(req, res, next) {
  if (!SERVEREDE_ENDELSER.has(path.extname(req.path).toLowerCase())) return res.status(404).end();
  next();
}
function sikreUploadHeadere(res) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = { endelseFraType, billedFilter, erGyldigtBillede, tjekUploadetBillede, filnavn, kunBilleder, sikreUploadHeadere };
