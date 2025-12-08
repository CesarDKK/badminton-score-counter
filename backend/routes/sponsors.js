const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../config/multer');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

// GET /api/sponsors/images - Get all sponsor images (public)
router.get('/images', async (req, res, next) => {
    try {
        const images = await query(
            `SELECT id, filename, original_name, file_size, width, height,
                    mime_type, upload_date, display_order
             FROM sponsor_images
             ORDER BY display_order, upload_date DESC`
        );

        res.json(images);
    } catch (error) {
        next(error);
    }
});

// GET /api/sponsors/settings - Get sponsor settings (public)
router.get('/settings', async (req, res, next) => {
    try {
        const settings = await queryOne('SELECT slide_duration FROM sponsor_settings LIMIT 1');

        res.json({
            slideDuration: settings?.slide_duration || 10
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/sponsors/settings - Update sponsor settings (requires auth)
router.put('/settings', authMiddleware, async (req, res, next) => {
    try {
        const { slideDuration } = req.body;

        if (!slideDuration || slideDuration < 3 || slideDuration > 60) {
            return res.status(400).json({ error: 'Varighed skal være mellem 3 og 60 sekunder' });
        }

        await query('UPDATE sponsor_settings SET slide_duration = ?', [slideDuration]);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// POST /api/sponsors/upload - Upload sponsor images (requires auth)
router.post('/upload', authMiddleware, upload.array('images', 10), async (req, res, next) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Ingen filer uploadet' });
        }

        const uploadedImages = [];

        for (const file of req.files) {
            try {
                // Get original image metadata
                const metadata = await sharp(file.path).metadata();

                // Auto-rotate based on EXIF orientation and resize if needed
                let finalWidth = metadata.width;
                let finalHeight = metadata.height;
                let needsProcessing = false;

                // Check if image needs rotation or resizing
                if (metadata.orientation && metadata.orientation !== 1) {
                    needsProcessing = true;
                }
                if (metadata.width > 1920 || metadata.height > 1080) {
                    needsProcessing = true;
                }

                if (needsProcessing) {
                    const processedPath = file.path + '_processed.jpg';

                    await sharp(file.path)
                        .rotate() // Auto-rotate based on EXIF orientation
                        .resize(1920, 1080, {
                            fit: 'inside',
                            withoutEnlargement: true
                        })
                        .jpeg({ quality: 90 })
                        .toFile(processedPath);

                    // Get processed metadata
                    const processedMetadata = await sharp(processedPath).metadata();
                    finalWidth = processedMetadata.width;
                    finalHeight = processedMetadata.height;

                    // Replace original with processed
                    await fs.unlink(file.path);
                    await fs.rename(processedPath, file.path);
                }

                // Get final file size
                const stats = await fs.stat(file.path);

                // Insert into database
                const result = await query(
                    `INSERT INTO sponsor_images
                     (filename, original_name, file_path, file_size, width, height, mime_type)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        file.filename,
                        file.originalname,
                        file.path,
                        stats.size,
                        finalWidth,
                        finalHeight,
                        file.mimetype
                    ]
                );

                uploadedImages.push({
                    id: result.insertId,
                    filename: file.filename,
                    url: `/uploads/${file.filename}`
                });
            } catch (imageError) {
                console.error(`Error processing ${file.originalname}:`, imageError);
                // Clean up file if processing failed
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    // Ignore unlink errors
                }
            }
        }

        if (uploadedImages.length === 0) {
            return res.status(500).json({ error: 'Alle uploads fejlede' });
        }

        res.json({
            success: true,
            images: uploadedImages
        });
    } catch (error) {
        // Clean up uploaded files on error
        if (req.files) {
            for (const file of req.files) {
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    // Ignore unlink errors
                }
            }
        }
        next(error);
    }
});

// DELETE /api/sponsors/:id - Delete sponsor image (requires auth)
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get image info
        const image = await queryOne(
            'SELECT filename, file_path FROM sponsor_images WHERE id = ?',
            [id]
        );

        if (!image) {
            return res.status(404).json({ error: 'Billede ikke fundet' });
        }

        // Delete from database
        await query('DELETE FROM sponsor_images WHERE id = ?', [id]);

        // Delete file from filesystem
        try {
            await fs.unlink(image.file_path);
        } catch (fileError) {
            console.error('Error deleting file:', fileError);
            // Continue even if file deletion fails
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/sponsors/all - Delete all sponsor images (requires auth)
router.delete('/all', authMiddleware, async (req, res, next) => {
    try {
        // Get all images
        const images = await query('SELECT filename, file_path FROM sponsor_images');

        // Delete all from database
        await query('DELETE FROM sponsor_images');

        // Delete all files from filesystem
        for (const image of images) {
            try {
                await fs.unlink(image.file_path);
            } catch (fileError) {
                console.error(`Error deleting file ${image.filename}:`, fileError);
                // Continue with other files
            }
        }

        res.json({
            success: true,
            deletedCount: images.length
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
