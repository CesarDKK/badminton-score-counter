const fs = require('fs');
const path = require('path');

// Delt billed-validering for alle uploads (sponsorer, logoer).
//
// To lag, fordi klientens Content-Type ikke kan stoles på:
//  1. sikkerEndelse(): den gemte fils endelse udledes af den PÅSTÅEDE mimetype
//     mod en whitelist — aldrig af det oprindelige filnavn. Ellers kunne
//     'evil.html' (uploadet med Content-Type: image/png) blive gemt som .html
//     og serveret som text/html fra /uploads → stored XSS på app-domænet.
//  2. validateImageMagic(): efter upload læses filens første bytes og
//     sammenholdes med et rigtigt billed-signatur. Et script forklædt som
//     billede afvises her, og filen slettes.

const MIME_TIL_ENDELSE = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
};

function sikkerEndelse(mimetype) {
    return MIME_TIL_ENDELSE[mimetype] || null;
}

// Genkend et billede på dets magic bytes (uafhængigt af filnavn/Content-Type)
function erGyldigtBillede(buf) {
    if (!buf || buf.length < 12) return false;
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
    // GIF: 'GIF8'
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
    // WebP: 'RIFF' .... 'WEBP'
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
    return false;
}

function laesHoved(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(12);
        fs.readSync(fd, buf, 0, 12, 0);
        return buf;
    } finally {
        fs.closeSync(fd);
    }
}

// Express-middleware: kør EFTER multer. Validerer req.file / req.files mod
// magic bytes og sletter + afviser hvis en fil ikke er et rigtigt billede.
function validateImageMagic(req, res, next) {
    const filer = req.files || (req.file ? [req.file] : []);
    for (const f of filer) {
        let ok = false;
        try {
            ok = erGyldigtBillede(laesHoved(f.path));
        } catch {
            ok = false;
        }
        if (!ok) {
            // Ryd alle uploadede filer i denne request op
            for (const g of filer) {
                try { fs.unlinkSync(g.path); } catch {}
            }
            return res.status(400).json({ error: 'Filen er ikke et gyldigt billede' });
        }
    }
    next();
}

// Fælles filename-funktion til multer.diskStorage — sikker endelse fra mimetype
function billedFilnavn(crypto) {
    return (req, file, cb) => {
        const ext = sikkerEndelse(file.mimetype);
        if (!ext) {
            return cb(new Error('Kun JPEG, PNG, GIF eller WebP er tilladt'), null);
        }
        const uniqueSuffix = Date.now() + '_' + crypto.randomBytes(8).toString('hex');
        const basename = path.basename(file.originalname, path.extname(file.originalname))
            .replace(/[^a-zA-Z0-9]/g, '_')
            .substring(0, 50) || 'billede';
        cb(null, `${basename}_${uniqueSuffix}${ext}`);
    };
}

// Fælles fileFilter — hurtig afvisning på mimetype før filen streames til disk
function billedFileFilter(req, file, cb) {
    if (sikkerEndelse(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Kun JPEG, PNG, GIF eller WebP er tilladt'), false);
    }
}

module.exports = {
    sikkerEndelse,
    erGyldigtBillede,
    validateImageMagic,
    billedFilnavn,
    billedFileFilter,
};
