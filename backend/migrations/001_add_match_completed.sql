-- Add match_completed column to game_states table
ALTER TABLE game_states
ADD COLUMN IF NOT EXISTS match_completed BOOLEAN DEFAULT FALSE AFTER match_end_time;
