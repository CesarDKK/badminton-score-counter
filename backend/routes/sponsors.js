const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const upload = require('../config/multer');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');

/**
 * Check and deactivate expired sponsor images
 * Sets is_active = FALSE for images where expiration_date <= NOW()
 * @returns {Promise<number>} - Number of images deactivated
 */
async function checkAndDeactivateExpiredImages() {
    try {
        const result = await query(
            `UPDATE sponsor_images
             SET is_active = FALSE
             WHERE is_active = TRUE
             AND expiration_date IS NOT NULL
             AND expiration_date <= NOW()`
        );

        const deactivatedCount = result.affectedRows || 0;

        if (deactivatedCount > 0) {
            console.log(`[Sponsor Expiration] Deactivated ${deactivatedCount} expired image(s)`);
        }

        return deactivatedCount;
    } catch (error) {
        console.error('[Sponsor Expiration] Error checking expired images:', error);
        return 0;
    }
}

// GET /api/sponsors/images - Get all sponsor images (public)
router.get('/images', async (req, res, next) => {
    try {
        // Check and deactivate expired images on-demand
        await checkAndDeactivateExpiredImages();

        const { type, includeInactive } = req.query;
        let sql = `SELECT id, filename, type, original_name, file_size, width, height,
                    mime_type, upload_date, display_order, is_active, expiration_date
             FROM sponsor_images`;
        const params = [];
        const whereClauses = [];

        // Filter by type if provided
        if (type && (type === 'slideshow' || type === 'court')) {
            whereClauses.push('type = ?');
            params.push(type);

            // Filter by active status unless includeInactive is true
            // TV display and court pages should only see active images
            // Admin panel can see all with includeInactive=true
            if (includeInactive !== 'true') {
                whereClauses.push('is_active = TRUE');
            }
        }

        if (whereClauses.length > 0) {
            sql += ` WHERE ${whereClauses.join(' AND ')}`;
        }

        sql += ` ORDER BY display_order, upload_date DESC`;

        const images = await query(sql, params);

        // Optimize: Fetch all court assignments in a single query instead of N queries
        // Collect IDs of court-type images
        const courtImageIds = images.filter(img => img.type === 'court').map(img => img.id);

        // Fetch all court assignments in one query if there are court images
        let courtAssignments = {};
        if (courtImageIds.length > 0) {
            const assignments = await query(
                `SELECT sponsor_image_id, court_number
                 FROM sponsor_image_courts
                 WHERE sponsor_image_id IN (?)
                 ORDER BY sponsor_image_id, court_number`,
                [courtImageIds]
            );

            // Group assignments by image ID
            assignments.forEach(assignment => {
                if (!courtAssignments[assignment.sponsor_image_id]) {
                    courtAssignments[assignment.sponsor_image_id] = [];
                }
                courtAssignments[assignment.sponsor_image_id].push(assignment.court_number);
            });
        }

        // Map court assignments back to images and format dates
        for (const image of images) {
            // Assign courts (empty array if none assigned)
            image.assignedCourts = courtAssignments[image.id] || [];

            // Format expiration_date as ISO string (null if not set)
            if (image.expiration_date) {
                image.expiration_date = new Date(image.expiration_date).toISOString();
            }
        }

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

// POST /api/sponsors/upload - Upload sponsor images (requires auth + rate limiting)
router.post('/upload', uploadLimiter, authMiddleware, upload.array('images', 10), async (req, res, next) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'Ingen filer uploadet' });
        }

        // Get image type from request body (defaults to 'slideshow')
        const imageType = req.body.type || 'slideshow';

        // Validate type
        if (imageType !== 'slideshow' && imageType !== 'court') {
            return res.status(400).json({ error: 'Ugyldig billedtype. Skal være "slideshow" eller "court"' });
        }

        const uploadResults = []; // Track both successes and failures

        for (const file of req.files) {
            try {
                // Get original image metadata
                const metadata = await sharp(file.path).metadata();

                // Auto-rotate based on EXIF orientation and resize based on type
                let finalWidth = metadata.width;
                let finalHeight = metadata.height;
                let needsProcessing = false;

                // Check if image needs rotation or resizing
                if (metadata.orientation && metadata.orientation !== 1) {
                    needsProcessing = true;
                }

                // Different processing based on image type
                if (imageType === 'slideshow') {
                    // Slideshow: resize to fit within 1920x1080 maintaining aspect ratio
                    if (metadata.width > 1920 || metadata.height > 1080) {
                        needsProcessing = true;
                    }
                } else if (imageType === 'court') {
                    // Court banner: always process to exact 1920x216 with cropping
                    needsProcessing = true;
                }

                if (needsProcessing) {
                    const processedPath = file.path + '_processed.jpg';

                    if (imageType === 'slideshow') {
                        // Slideshow: fit inside bounds, maintain aspect ratio
                        await sharp(file.path)
                            .rotate() // Auto-rotate based on EXIF orientation
                            .resize(1920, 1080, {
                                fit: 'inside',
                                withoutEnlargement: true
                            })
                            .jpeg({ quality: 90 })
                            .toFile(processedPath);
                    } else if (imageType === 'court') {
                        // Court banner: fill dimensions exactly, crop excess from bottom
                        await sharp(file.path)
                            .rotate() // Auto-rotate based on EXIF orientation
                            .resize(1920, 216, {
                                fit: 'cover',
                                position: 'bottom'
                            })
                            .jpeg({ quality: 90 })
                            .toFile(processedPath);
                    }

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

                // Insert into database with type
                const result = await query(
                    `INSERT INTO sponsor_images
                     (filename, type, original_name, file_path, file_size, width, height, mime_type)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        file.filename,
                        imageType,
                        file.originalname,
                        file.path,
                        stats.size,
                        finalWidth,
                        finalHeight,
                        file.mimetype
                    ]
                );

                uploadResults.push({
                    success: true,
                    id: result.insertId,
                    filename: file.filename,
                    originalName: file.originalname,
                    url: `/uploads/${file.filename}`
                });
            } catch (imageError) {
                console.error(`Error processing ${file.originalname}:`, imageError);

                // Add failure result with error message
                uploadResults.push({
                    success: false,
                    originalName: file.originalname,
                    error: imageError.message || 'Ukendt fejl ved behandling af billede'
                });

                // Clean up file if processing failed
                try {
                    await fs.unlink(file.path);
                } catch (unlinkError) {
                    console.error('Failed to cleanup file:', unlinkError);
                }
            }
        }

        const successCount = uploadResults.filter(r => r.success).length;
        const failureCount = uploadResults.filter(r => !r.success).length;

        // Return comprehensive results
        res.json({
            success: successCount > 0,
            results: uploadResults,
            summary: {
                total: uploadResults.length,
                successful: successCount,
                failed: failureCount
            },
            // Backwards compatibility - include images array
            images: uploadResults.filter(r => r.success)
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

// PUT /api/sponsors/:id/active - Toggle active status for sponsor image (requires auth)
router.put('/:id/active', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        // Validate isActive is boolean
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'isActive skal være en boolean' });
        }

        // Validate that image exists
        const image = await queryOne(
            'SELECT id FROM sponsor_images WHERE id = ?',
            [id]
        );

        if (!image) {
            return res.status(404).json({ error: 'Billede ikke fundet' });
        }

        // Update is_active status
        await query(
            'UPDATE sponsor_images SET is_active = ? WHERE id = ?',
            [isActive, id]
        );

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/sponsors/:id/expiration - Set expiration date for sponsor image (requires auth)
router.put('/:id/expiration', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { expirationDate } = req.body;

        // Validate that image exists
        const image = await queryOne(
            'SELECT id FROM sponsor_images WHERE id = ?',
            [id]
        );

        if (!image) {
            return res.status(404).json({ error: 'Billede ikke fundet' });
        }

        // Handle null (clear expiration)
        if (expirationDate === null) {
            await query(
                'UPDATE sponsor_images SET expiration_date = NULL WHERE id = ?',
                [id]
            );
            return res.json({ success: true });
        }

        // Validate date format
        const expirationDateObj = new Date(expirationDate);
        if (isNaN(expirationDateObj.getTime())) {
            return res.status(400).json({ error: 'Ugyldig dato format' });
        }

        // Reject dates in the past
        const now = new Date();
        if (expirationDateObj <= now) {
            return res.status(400).json({ error: 'Udløbsdato skal være i fremtiden' });
        }

        // Reject dates too far in the future (max 5 years)
        const maxDate = new Date();
        maxDate.setFullYear(maxDate.getFullYear() + 5);
        if (expirationDateObj > maxDate) {
            return res.status(400).json({ error: 'Udløbsdato kan ikke være mere end 5 år i fremtiden' });
        }

        // Update expiration_date
        await query(
            'UPDATE sponsor_images SET expiration_date = ? WHERE id = ?',
            [expirationDateObj, id]
        );

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/sponsors/:id/courts - Update court assignments for a sponsor image (requires auth)
router.put('/:id/courts', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { courts } = req.body; // Array of court numbers

        // Validate that image exists and is of type 'court'
        const image = await queryOne(
            'SELECT id, type FROM sponsor_images WHERE id = ?',
            [id]
        );

        if (!image) {
            return res.status(404).json({ error: 'Billede ikke fundet' });
        }

        if (image.type !== 'court') {
            return res.status(400).json({ error: 'Kun bane sponsor billeder kan tildeles baner' });
        }

        // Validate courts array
        if (!Array.isArray(courts)) {
            return res.status(400).json({ error: 'Courts skal være et array' });
        }

        // Validate each court number
        const MAX_COURTS = 20; // Maximum number of courts supported
        const invalidCourts = courts.filter(c => {
            const num = parseInt(c);
            return !Number.isInteger(num) || num < 1 || num > MAX_COURTS;
        });

        if (invalidCourts.length > 0) {
            return res.status(400).json({
                error: `Ugyldige bane numre: ${invalidCourts.join(', ')}. Bane numre skal være mellem 1 og ${MAX_COURTS}.`
            });
        }

        // Convert to integers for safety
        const validCourts = courts.map(c => parseInt(c));

        // Optimized batch operations instead of N*2 individual queries
        // Step 1: Remove all existing assignments for this image
        await query('DELETE FROM sponsor_image_courts WHERE sponsor_image_id = ?', [id]);

        // Step 2 & 3: Only proceed if there are courts to assign
        if (validCourts.length > 0) {
            // Step 2: Remove these courts from any other images (batch delete)
            await query(
                'DELETE FROM sponsor_image_courts WHERE court_number IN (?)',
                [validCourts]
            );

            // Step 3: Batch insert all new court assignments at once
            const values = validCourts.map(courtNumber => [id, courtNumber]);
            await query(
                'INSERT INTO sponsor_image_courts (sponsor_image_id, court_number) VALUES ?',
                [values]
            );
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
