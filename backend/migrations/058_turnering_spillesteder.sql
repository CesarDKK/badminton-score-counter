-- Migration 058: turnering fra Tournament Software — kun valgte spillesteder
--
-- En TS-turnering kan spilles flere steder på én gang (fx Valbyhallen, KMB 2010,
-- BC37). Klubben afvikler kun sin egen del, så ved importen vælges de
-- spillesteder, der skal med. Valget gemmes, så "Opdater" og den automatiske
-- opdatering heller ikke henter kampe fra de andre steder ind.
--
-- tournaments.source_locations: JSON-liste med spillestedernes navne, som TS
--                               skriver dem (fx ["Valbyhallen"]).
--                               NULL = alle spillesteder (som før).
--
-- Kan køres igen: 1060 (kolonnen findes) springes over.

ALTER TABLE tournaments ADD COLUMN source_locations TEXT NULL DEFAULT NULL;
