const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { billedFilnavn, billedFileFilter } = require('./imageUpload');

const baseUploadDir = process.env.UPLOAD_DIR || './uploads';

// Sikr at base-mappen eksisterer
if (!fs.existsSync(baseUploadDir)) {
    fs.mkdirSync(baseUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Hver klub får sin egen undermappe — 'local' bruges ved direkte/lokal adgang
        const clubDir = req.clubDbName || 'local';
        const dir = path.join(baseUploadDir, clubDir);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    // Endelsen udledes af mimetype (whitelist), ikke af originalname — ellers
    // kunne en .html-fil forklædt som billede gemmes med .html-endelse og
    // serveres som HTML fra /uploads. Magic bytes valideres efter upload med
    // validateImageMagic i den enkelte rute.
    filename: billedFilnavn(crypto)
});

const upload = multer({
    storage,
    fileFilter: billedFileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
        files: 10
    }
});

module.exports = upload;
