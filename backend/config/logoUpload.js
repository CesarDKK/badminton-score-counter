const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

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
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '_' + crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9]/g, '_')
            .substring(0, 50);
        cb(null, `${basename}_${uniqueSuffix}${ext}`);
    }
});

// Kun raster-logoer: PNG/WebP/JPG
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/webp', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Kun PNG, WebP eller JPG er tilladt'), false);
    }
};

const logoUpload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

module.exports = logoUpload;
