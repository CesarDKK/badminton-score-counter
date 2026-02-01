-- Migration: Add is_active and expiration_date to sponsor_images
-- Purpose: Enable manual control and automatic expiration for slideshow sponsor images

-- Add is_active column for manual control (defaults to TRUE for backwards compatibility)
ALTER TABLE sponsor_images
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER display_order;

-- Add expiration_date column for automatic deactivation (NULL = never expires)
ALTER TABLE sponsor_images
ADD COLUMN expiration_date TIMESTAMP NULL DEFAULT NULL AFTER is_active;

-- Set all existing images to active (backwards compatibility)
UPDATE sponsor_images SET is_active = TRUE WHERE is_active IS NULL;

-- Add index for efficient filtering by type, active status, and expiration
CREATE INDEX idx_sponsor_active_filter ON sponsor_images(type, is_active, expiration_date);
