-- Migration 042: "Stop for i dag" for en holdkamp i livestreamen
--
-- Holdkampe sendes af sig selv. Før kunne det kun stoppes ved at slå livestream
-- fra for banen (og huske at slå det til igen). holdkamp_stop_until sættes af
-- admin under Livestream til dagens slutning (kl. 23:59 dansk tid): indtil da
-- sendes banen ikke af sig selv på grund af en holdkamp. "Send hele dagen" og
-- tablettens "Start livestream" virker stadig.

ALTER TABLE court_streams ADD COLUMN holdkamp_stop_until TIMESTAMP NULL DEFAULT NULL;
