-- Migration 015: Add finished_at to tournament_matches and team_match_games
-- Saa "Seneste kamp" paa admin-baneoversigten kan finde nyeste kamp paa tvaers
-- af alle tre kilder (match_history, tournament_matches, team_match_games).
-- Uden et finished_at-timestamp kender vi kun created_at, som ikke nodvendigvis
-- afspejler hvornar kampen blev faerdigspillet.

ALTER TABLE tournament_matches ADD COLUMN finished_at TIMESTAMP NULL AFTER set_scores;
ALTER TABLE team_match_games ADD COLUMN finished_at TIMESTAMP NULL AFTER set_scores;
