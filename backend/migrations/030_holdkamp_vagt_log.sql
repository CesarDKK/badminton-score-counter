-- Migration 030: log for den automatiske hentning af holdsedler (holdkamp-køen)
--
-- Hvert tjek hos badmintonplayer.dk og hver hændelse (sat i kø, vinduet åbnet,
-- oprettet, opgivet, fjernet, fejl) skrives her, så admin kan se i bunden af
-- Holdkamp-siden, hvad der skete med en kamp — uden adgang til serverens log.
-- Rækker ældre end 14 dage slettes løbende af vagten.

CREATE TABLE IF NOT EXISTS holdkamp_vagt_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  tid TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  watcher_id INT NULL,
  league_match_id VARCHAR(32) NULL,
  niveau ENUM('info','advarsel','fejl') NOT NULL DEFAULT 'info',
  besked VARCHAR(600) NOT NULL,

  INDEX idx_tid (tid),
  INDEX idx_watcher (watcher_id)
) ENGINE=InnoDB;
