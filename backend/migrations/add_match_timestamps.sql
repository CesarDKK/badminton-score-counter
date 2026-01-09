-- Migration: Add match_start_time and match_end_time columns to game_states table
-- Run this once on existing databases

ALTER TABLE game_states
ADD COLUMN match_start_time TIMESTAMP NULL AFTER updated_at,
ADD COLUMN match_end_time TIMESTAMP NULL AFTER match_start_time;
