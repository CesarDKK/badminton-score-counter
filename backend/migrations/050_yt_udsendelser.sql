-- Migration 050: de udsendelser, Badmintonapp har oprettet på klubbens YouTube-kanal
--
-- Nr. 12C (Jesper 2026-11-15): en udsendelse bliver automatisk "kun med
-- linket" (unlisted), når den er over 60 dage gammel og stadig offentlig — så
-- gamle kampe med børn og unge ikke ligger fremme på kanalen for altid. Kun
-- appens egne udsendelser: klubbens kanal kan have andre videoer, som ikke må
-- røres. Rækken skrives, når serveren opretter udsendelsen (routes/livestream.js
-- ytStyr); ældre udsendelser findes én gang via YouTube (appens faste sætning i
-- beskrivelsen, screens/livestream.js YT_KENDETEGN).
--
--   synlighed_sat_at  hvornår jobbet tog stilling (også når videoen ikke fandtes
--                     eller allerede ikke var offentlig) — så prøves den ikke igen
--   resultat          hvad der skete ('kun med linket', 'allerede unlisted',
--                     'findes ikke', en fejl fra YouTube …)
--
-- Ikke med i klubbens backup (som livestream_youtube): hører til kanalen.

CREATE TABLE IF NOT EXISTS yt_udsendelser (
  broadcast_id VARCHAR(64) NOT NULL PRIMARY KEY,
  bane INT NULL,
  titel VARCHAR(255) NULL,
  oprettet TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synlighed_sat_at TIMESTAMP NULL DEFAULT NULL,
  resultat VARCHAR(255) NULL,
  KEY idx_yt_udsendelser_ventende (synlighed_sat_at, oprettet)
) ENGINE=InnoDB;
