-- Migration 026: started_at på delkampe (holdkamp) og turneringskampe.
--
-- Hidtil blev kun sluttidspunktet (finished_at) gemt, så Kamphistorik kunne
-- ikke vise varighed for holdkamp- og turneringskampe (kun for almindelige
-- kampe, der har match_history.duration). started_at sættes ved tildeling
-- til en bane og erstattes ved afslutning af banens rigtige starttid
-- (game_states.match_start_time = første serv), hvis den er nyere.
-- Kampe spillet før denne migration har ingen starttid og viser ingen varighed.

ALTER TABLE team_match_games ADD COLUMN started_at TIMESTAMP NULL AFTER finished_at;
ALTER TABLE tournament_matches ADD COLUMN started_at TIMESTAMP NULL AFTER finished_at;
