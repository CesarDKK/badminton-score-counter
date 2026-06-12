-- Migration 017: gem kilde-id'er saa en importeret turnering kan opdateres
-- (genhentes) fra tournamentsoftware.com uden at lave en ny turnering.
-- source_tournament_id  = TS-turneringens UUID (paa tournaments)
-- source_match_id        = stabil sammensat noegle "draw#runde#ordinal" pr. kamp,
--                          saa gen-import kan matche eksisterende kampe paalideligt
--                          (TS eksponerer ingen per-kamp GUID paa kamp-listen).
-- NB undgaa semikolon-tegn i kommentarer (migrations-runneren splitter paa det).

ALTER TABLE tournaments
    ADD COLUMN source_tournament_id VARCHAR(64) NULL;

ALTER TABLE tournament_matches
    ADD COLUMN source_match_id VARCHAR(120) NULL;

ALTER TABLE tournament_matches
    ADD INDEX idx_source_match (tournament_id, source_match_id);
