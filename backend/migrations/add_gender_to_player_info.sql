-- Migration: Add gender column to player_info table
-- Run this once on existing databases

ALTER TABLE player_info
ADD COLUMN gender ENUM('Herre', 'Dame') NOT NULL DEFAULT 'Herre'
AFTER club;

-- Add index for gender for faster filtering
ALTER TABLE player_info
ADD INDEX idx_gender (gender);
