const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename: timestamp_randomhash_originalname
        const uniqueSuffix = Date.now() + '_' + crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9]/g, '_') // Sanitize filename
            .substring(0, 50); // Limit basename length
        cb(null, `${basename}_${uniqueSuffix}${ext}`);
    }
});

// File filter - accept images only
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Kun billedfiler er tilladt (JPEG, PNG, GIF, WebP)'), false);
    }
};

// Configure multer
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB default
        files: 10 // Max 10 files per upload
    }
});

module.exports = upload;
