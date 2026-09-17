-- Migration 028: reparation — turneringstabeller på klubber der mangler dem.
--
-- Klubber oprettet før 2026-09-07 fik kun init.sql, og migrationerne blev
-- markeret som kørte uden at blive kørt (rettet i createClubDatabase). init.sql
-- indeholder ikke turneringstabellerne (kun migration 012/021), så de klubber
-- står uden tournaments/tournament_matches/tournament_player_clubs — og alt der
-- rører dem fejler med "Table 'x.tournament_matches' doesn't exist"
-- (turneringsfanen, Ryd bane-frigivelse, badmintonplanner-integrationen).
--
-- Denne migration opretter tabellerne med det FULDE nuværende skema (012 +
-- 015 finished_at + 016 set_scores TEXT + 017 source-id'er + 021 + 023
-- auto_sync + 026 started_at). På klubber der allerede har tabellerne er
-- CREATE TABLE IF NOT EXISTS en no-op, og de mangler ingen kolonner, fordi de
-- reelt har kørt 012–026.

CREATE TABLE IF NOT EXISTS tournaments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  status ENUM('active', 'finished') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source_tournament_id VARCHAR(64) NULL,
  auto_sync TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tournament_matches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  tournament_id INT NOT NULL,
  match_order INT NOT NULL,
  label VARCHAR(100) NULL,
  doubles TINYINT(1) NOT NULL DEFAULT 0,
  side1_player1 VARCHAR(100),
  side1_player2 VARCHAR(100),
  side2_player1 VARCHAR(100),
  side2_player2 VARCHAR(100),
  court_number INT NULL,
  status ENUM('pending', 'active', 'finished') DEFAULT 'pending',
  winner_team TINYINT NULL,
  set_scores TEXT DEFAULT NULL,
  finished_at TIMESTAMP NULL,
  started_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source_match_id VARCHAR(120) NULL,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  INDEX idx_tournament_status (tournament_id, status),
  INDEX idx_source_match (tournament_id, source_match_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tournament_player_clubs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  tournament_id INT NOT NULL,
  player_name VARCHAR(100) NOT NULL,
  club VARCHAR(100) NOT NULL,
  source_player_id VARCHAR(40) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tournament_player (tournament_id, player_name),
  INDEX idx_player_name (player_name),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB;
