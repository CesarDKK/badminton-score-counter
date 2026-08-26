const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { billedFilnavn, billedFileFilter } = require('./imageUpload');

const baseUploadDir = process.env.UPLOAD_DIR || './uploads';
const logoDir = path.join(baseUploadDir, 'central_logos');

if (!fs.existsSync(logoDir)) {
    fs.mkdirSync(logoDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(logoDir)) {
            fs.mkdirSync(logoDir, { recursive: true });
        }
        cb(null, logoDir);
    },
    // Endelse fra mimetype-whitelist (ikke originalname) — se multer.js
    filename: billedFilnavn(crypto)
});

const logoUpload = multer({
    storage,
    fileFilter: billedFileFilter,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

module.exports = logoUpload;
