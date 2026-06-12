-- set_scores VARCHAR(200) er for lille til doubles med lange navne over 3 saet.
-- Samme problem som 011 rettede for match_history, men tournament_matches (012)
-- og team_match_games (008) blev oprettet med VARCHAR(200). Naar strengen er for
-- lang fejler UPDATE'en (ER_DATA_TOO_LONG), saa kampen aldrig markeres 'finished'
-- og bliver haengende i kamplisten uden at lande i historikken.
ALTER TABLE tournament_matches
    MODIFY COLUMN set_scores TEXT DEFAULT NULL;

ALTER TABLE team_match_games
    MODIFY COLUMN set_scores TEXT DEFAULT NULL;
