-- Migration 055: "Stop for denne kamp" på tabletten under en holdkamp
--
-- Holdkampe sendes af sig selv. Før kunne de kun stoppes i admin ("Stop for i
-- dag", migration 042), og det gjaldt banen resten af dagen. Nu kan tabletten
-- springe den delkamp over, der står på banen: holdkamp_spring_over er dens
-- team_match_games.id. Den næste delkamp, der sættes på banen, har et andet id
-- og sendes igen af sig selv. Et id genbruges aldrig, så værdien skal ikke ryddes.

ALTER TABLE court_streams ADD COLUMN holdkamp_spring_over INT NULL DEFAULT NULL;
