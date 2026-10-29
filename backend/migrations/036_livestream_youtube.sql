-- Migration 036: klubbens YouTube-kanal forbundet med YouTube-API'et
--
-- Klubben trykker "Forbind YouTube-kanal" i admin (Livestream) og giver
-- Badmintonapp adgang til kanalen hos Google. Så opretter serveren selv en ny
-- udsendelse, hver gang en bane begynder at sende — ingen skal ind i YouTube
-- Studio først — og stream-nøglerne pr. bane.
--
--   livestream_youtube      Forbindelsen (én række, id = 1). refresh_token er
--                           krypteret (config/hemmelig.js). Ikke med i klubbens
--                           backup: adgangen hører til serveren, ikke data
--   court_streams.yt_*      Banens stream på kanalen (nøgle og adresse fra
--                           YouTube) og den igangværende udsendelse. Den
--                           indtastede stream_key bruges stadig, når kanalen
--                           ikke er forbundet

CREATE TABLE IF NOT EXISTS livestream_youtube (
  id TINYINT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  kanal_id VARCHAR(64) NULL,
  kanal_navn VARCHAR(255) NULL,
  fejl VARCHAR(255) NULL,
  forbundet TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE court_streams ADD COLUMN yt_stream_id VARCHAR(64) NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN yt_ingest_url VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN yt_stream_key VARCHAR(300) NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN yt_broadcast_id VARCHAR(64) NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN yt_broadcast_tjek TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN yt_fejl VARCHAR(255) NULL DEFAULT NULL;
ALTER TABLE court_streams ADD COLUMN yt_fejl_tid TIMESTAMP NULL DEFAULT NULL;
