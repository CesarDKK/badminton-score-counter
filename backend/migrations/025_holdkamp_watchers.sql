-- Migration 025: automatisk hentning af holdsammensaetningen
--
-- Holdsedlen frigives foerst ca. 60 minutter foer kampstart. Starttidspunktet
-- staar derimod paa badmintonplayer.dk fra det oejeblik kampen er sat, saa vi
-- kan gemme linket med det samme og selv hente holdsedlen naar den kommer.
--
-- status:
--   venter   → vi holder oeje, holdsedlen er ikke frigivet endnu
--   oprettet → holdsedlen kom, og holdkampen er oprettet (team_match_id)
--   opgivet  → kampstart er passeret uden at holdsedlen dukkede op
--   fejl     → holdsedlen kom, men holdkampen kunne ikke oprettes (se last_error)

CREATE TABLE IF NOT EXISTS holdkamp_watchers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  league_match_id VARCHAR(32) NOT NULL,
  url VARCHAR(500) NOT NULL,
  team1_name VARCHAR(200) NOT NULL DEFAULT '',
  team2_name VARCHAR(200) NOT NULL DEFAULT '',
  venue VARCHAR(300) NULL,
  start_time DATETIME NULL,
  status ENUM('venter','oprettet','opgivet','fejl') NOT NULL DEFAULT 'venter',
  last_checked_at DATETIME NULL,
  last_error VARCHAR(400) NULL,
  team_match_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_league_match (league_match_id),
  INDEX idx_status_start (status, start_time)
) ENGINE=InnoDB;
