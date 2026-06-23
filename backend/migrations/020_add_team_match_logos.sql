-- Holdkamp logo-override pr. hold (NULL = auto-match paa holdnavn)
ALTER TABLE team_matches ADD COLUMN team1_logo_id INT NULL;
ALTER TABLE team_matches ADD COLUMN team2_logo_id INT NULL;
