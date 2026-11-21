-- Migration 056: én YouTube-udsendelse pr. delkamp, og en stoppet kamp slettes
--
-- Holdkampe blev sendt som én lang udsendelse (hele holdkampen, også mellem
-- delkampene). Nu får hver delkamp sin egen video med delkampen i titlen
-- ("HD1: Lyngby 2 – Gentofte"), så kampene er lette at finde bagefter
-- (Jesper 2026-11-21).
--
-- yt_delkamp: delkampen (team_match_games.id), banens åbne udsendelse hører
--   til. Skifter delkampen, afsluttes udsendelsen, og en ny oprettes.
-- yt_slet: kampen blev stoppet, mens den blev spillet (tablettens stop eller
--   admins "Stop for i dag") — udsendelsen slettes på YouTube i stedet for at
--   blive liggende som en halv kamp.

ALTER TABLE court_streams ADD COLUMN yt_delkamp INT NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN yt_slet TINYINT(1) NOT NULL DEFAULT 0;
