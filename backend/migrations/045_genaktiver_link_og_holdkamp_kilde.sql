-- Migration 045: genaktiverede adgangslinks og én holdkamp pr. kilde (pakke N)
--
-- Nr. 44 — device_tokens.sessioner_fra: et tilbagekaldt link kan genaktiveres
-- (PUT /api/device-tokens/:id/genaktiver). Linket får en ny adresse, og
-- sessioner udstedt før genaktiveringen (TV'et/tabletten bærer dem i op til
-- 180 dage) afvises stadig: middleware/auth.js sammenligner sessionens iat med
-- sessioner_fra. NULL = linket er aldrig genaktiveret.
--
-- Nr. 45 — team_matches.aktiv_kilde_id: kampens id på badmintonplayer.dk, så
-- længe holdkampen er aktiv (nulstilles, når den afsluttes). Unik, så den samme
-- kamp ikke kan oprettes to gange (dobbeltklik på "Opret Holdkamp", eller import
-- i hånden + holdkamp-køen). Holdkampe oprettet i formularen har NULL.
--
-- Kan køres igen: 1060 (kolonnen findes) og 1061 (nøglen findes) springes over.

ALTER TABLE device_tokens ADD COLUMN sessioner_fra DATETIME NULL DEFAULT NULL;

ALTER TABLE team_matches ADD COLUMN aktiv_kilde_id VARCHAR(40) NULL DEFAULT NULL;

ALTER TABLE team_matches ADD UNIQUE KEY uq_team_match_aktiv_kilde (aktiv_kilde_id);
