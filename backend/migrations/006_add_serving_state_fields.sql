-- Add serving state fields to game_states table for proper doubles and set transitions
USE badminton_counter;

ALTER TABLE game_states
ADD COLUMN serving_player INT DEFAULT NULL COMMENT '1 or 2, which player/team is serving' AFTER deciding_game_switched,
ADD COLUMN initial_server INT DEFAULT NULL COMMENT 'Who served first (for tracking)' AFTER serving_player,
ADD COLUMN serving_team INT DEFAULT NULL COMMENT 'For doubles: which team is serving (1 or 2)' AFTER initial_server,
ADD COLUMN serving_player_on_team INT DEFAULT NULL COMMENT 'For doubles: which player on team (1=main, 2=partner)' AFTER serving_team,
ADD COLUMN team1_right_court INT DEFAULT 1 COMMENT 'For doubles: which player on team 1 is in right court (1=main, 2=partner)' AFTER serving_player_on_team,
ADD COLUMN team2_right_court INT DEFAULT 1 COMMENT 'For doubles: which player on team 2 is in right court (1=main, 2=partner)' AFTER team1_right_court,
ADD COLUMN between_sets BOOLEAN DEFAULT FALSE COMMENT 'True when between sets, allows position swapping in doubles' AFTER team2_right_court;
