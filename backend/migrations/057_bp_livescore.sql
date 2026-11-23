-- Migration 057: livescore til badmintonplayer.dk for holdkampe
--
-- Stillingen fra tabletten sendes til badmintonplayer.dk's livescore, så
-- hjemmeklubben ikke skal tælle to gange (Badminton Danmark har sagt god for
-- det, Jesper 2026-11-23). Kun holdkampe hentet fra badmintonplayer.dk
-- (team_matches.aktiv_kilde_id = kampnummeret), og kun når admin har slået det
-- til med klubbens livescore-kode.
--
-- team_matches.bp_livescore:        1 = send livescore for holdkampen
-- team_matches.bp_livescore_kode:   koden fra badmintonplayer ("Indberet resultat")
-- team_matches.bp_venue_id:         spillestedets id hos badmintonplayer
-- team_matches.bp_livescore_status: 'ok' eller seneste fejl (vises i admin)
-- team_matches.bp_livescore_sendt:  sidst der blev sendt (UTC)
-- team_match_games.bp_kamp_id:      delkampens id hos badmintonplayer
--                                   (leagueMatchIndividualMatchId)
-- team_match_games.bp_spillere:     JSON med hjemme-/udeholdets spillere
--                                   (navn, playerId, clubId) til beskeden
--
-- Kan køres igen: 1060 (kolonnen findes) springes over.

ALTER TABLE team_matches ADD COLUMN bp_livescore TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE team_matches ADD COLUMN bp_livescore_kode VARCHAR(64) NULL DEFAULT NULL;
ALTER TABLE team_matches ADD COLUMN bp_venue_id INT NULL DEFAULT NULL;
ALTER TABLE team_matches ADD COLUMN bp_livescore_status VARCHAR(300) NULL DEFAULT NULL;
ALTER TABLE team_matches ADD COLUMN bp_livescore_sendt DATETIME NULL DEFAULT NULL;
ALTER TABLE team_match_games ADD COLUMN bp_kamp_id INT NULL DEFAULT NULL;
ALTER TABLE team_match_games ADD COLUMN bp_spillere TEXT NULL DEFAULT NULL;
