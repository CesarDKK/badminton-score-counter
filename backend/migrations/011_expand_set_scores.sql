-- set_scores VARCHAR(200) er for lille til doubles med lange navne
ALTER TABLE match_history
    MODIFY COLUMN set_scores TEXT DEFAULT NULL;
