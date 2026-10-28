-- Migration 033: livestream fra TV-PC'ernes USB-kamera (YouTube, Facebook …)
--
-- Klubben indtaster en stream-nøgle pr. bane i admin (Adgangslinks →
-- Livestream). TV-PC'en med kameraet spørger serveren med sit adgangslink, om
-- den skal sende — nøglen ligger kun her, aldrig på USB-nøglen.
--
--   court_streams                 Opsætning pr. bane: til/fra, adresse, nøgle,
--                                 overlay med navne og stilling
--   device_tokens.camera_court    Kameraet ved denne TV-PC filmer bane N —
--                                 uafhængigt af, hvilken bane TV'et viser
--                                 (NULL = intet kamera)

CREATE TABLE IF NOT EXISTS court_streams (
  court_number INT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  stream_url VARCHAR(255) NOT NULL DEFAULT 'rtmps://a.rtmps.youtube.com:443/live2',
  stream_key VARCHAR(300) NULL,
  overlay BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE device_tokens ADD COLUMN camera_court INT NULL DEFAULT NULL;
