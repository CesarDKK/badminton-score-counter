const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

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
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '_' + crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9]/g, '_')
            .substring(0, 50);
        cb(null, `${basename}_${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Kun billedfiler er tilladt (JPEG, PNG, GIF, WebP)'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
        files: 10
    }
});

module.exports = upload;
