-- Migration 034: hvornår banen sendes (Jespers valg 2026-10-29)
--
-- Kun holdkampe sendes af sig selv. Ellers startes det med en knap:
--
--   court_streams.armed_until      Tablettens "Start livestream": den næste kamp
--                                  på banen sendes, hvis den starter inden da
--                                  (5 minutter) — ellers glemmes det
--   court_streams.manual_since     Kampen på banen blev valgt med knappen; den
--                                  sendes, til den er afgjort
--   court_streams.all_day_until    Admins "Send hele dagen": alt på banen, også
--                                  mellem kampene, til PC'en slukker om aftenen

ALTER TABLE court_streams ADD COLUMN armed_until TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN manual_since TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN all_day_until TIMESTAMP NULL DEFAULT NULL;
