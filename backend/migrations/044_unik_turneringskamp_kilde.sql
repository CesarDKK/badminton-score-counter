-- Migration 044: en TS-kamp kan kun findes én gang pr. turnering (nr. 81)
--
-- Import, "Opdater" og den automatiske opdatering springer en kamp over, hvis
-- dens source_match_id allerede findes — men kun i koden. To samtidige kald
-- kunne indsætte den samme kamp to gange. Nu er (tournament_id,
-- source_match_id) unik i databasen; kampe uden kilde-id (manuelt oprettede,
-- NULL) er ikke omfattet.
--
-- Klubber, der allerede har dubletter, mister ingenting: den ældste række
-- beholder id'et, de øvrige får "~d<række-id>" bagpå (sync kender dem stadig
-- på draw og runde — se rundeScopeOf i routes/tournaments.js). Uden det ville
-- ADD UNIQUE fejle med 1062, som migrationsløberen opfatter som "findes
-- allerede" — og migrationen ville stå som kørt uden nøglen.
--
-- Kan køres igen: UPDATE'en finder ingen dubletter, og nøglen findes (1061).

UPDATE tournament_matches t
  JOIN (SELECT tournament_id, source_match_id, MIN(id) AS behold
          FROM tournament_matches
         WHERE source_match_id IS NOT NULL
         GROUP BY tournament_id, source_match_id
        HAVING COUNT(*) > 1) d
    ON t.tournament_id = d.tournament_id
   AND t.source_match_id = d.source_match_id
   AND t.id <> d.behold
   SET t.source_match_id = CONCAT(LEFT(t.source_match_id, 100), '~d', t.id);

ALTER TABLE tournament_matches
    ADD UNIQUE KEY uq_tournament_source_match (tournament_id, source_match_id);
