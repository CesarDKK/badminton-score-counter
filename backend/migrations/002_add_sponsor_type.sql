-- Add type column to sponsor_images table for dual sponsor image types
ALTER TABLE sponsor_images
ADD COLUMN type ENUM('slideshow', 'court') NOT NULL DEFAULT 'slideshow' AFTER filename;

-- Set all existing images to 'slideshow' type for backward compatibility
UPDATE sponsor_images SET type = 'slideshow' WHERE type IS NULL OR type = '';

-- Add index for efficient filtering by type
CREATE INDEX idx_sponsor_type ON sponsor_images(type, display_order, upload_date DESC);
