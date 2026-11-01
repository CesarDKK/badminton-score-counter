-- Migration 039: hele pointreglernes tilstand gemmes
--
-- Tabletten regner med frontend/js/taeller-regler.js, og reglernes tilstand har
-- fire felter, serveren ikke gemte: om pausen ved 11 (8) er taget i sættet,
-- hvornår den kørende pause begyndte og hvor lang den er, og om siderne er
-- byttet med "Skift side". Tabletten gættede dem ved indlæsning (pausen taget,
-- hvis en side var nået pausepunktet) — nu læses de, som de blev gemt.
--
-- rest_break_started_at er tablettens ur (ms), så den tablet, der genindlæser
-- midt i en pause, kan regne resten af pausen ud med sit eget ur.

ALTER TABLE game_states ADD COLUMN rest_break_taken BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_states ADD COLUMN rest_break_started_at BIGINT NULL;
ALTER TABLE game_states ADD COLUMN rest_break_duration INT NOT NULL DEFAULT 60;
ALTER TABLE game_states ADD COLUMN sides_manually_switched BOOLEAN NOT NULL DEFAULT FALSE;
