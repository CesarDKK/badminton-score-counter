CREATE DATABASE IF NOT EXISTS football_tournament
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE football_tournament;

CREATE TABLE IF NOT EXISTS tournaments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  logo_path      VARCHAR(500) DEFAULT NULL,
  status         ENUM('setup', 'pool_stage', 'cup_stage', 'finished') NOT NULL DEFAULT 'setup',
  num_pools      INT NOT NULL,
  teams_per_pool INT NOT NULL,
  points_win     INT NOT NULL DEFAULT 3,
  points_draw    INT NOT NULL DEFAULT 1,
  points_loss    INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Idempotent migration: add logo_path to tournaments if missing (for existing installs)
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = 'football_tournament'
                     AND TABLE_NAME = 'tournaments'
                     AND COLUMN_NAME = 'logo_path');
SET @ddl = IF(@col_exists = 0,
              'ALTER TABLE tournaments ADD COLUMN logo_path VARCHAR(500) DEFAULT NULL AFTER name',
              'DO 0');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS pools (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  name          VARCHAR(50) NOT NULL,
  pool_index    INT NOT NULL,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pool (tournament_id, pool_index)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teams (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  pool_id   INT NOT NULL,
  name      VARCHAR(255) NOT NULL,
  logo_path VARCHAR(500) DEFAULT NULL,
  team_index INT NOT NULL,
  KEY idx_teams_pool (pool_id),
  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pool_matches (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  pool_id       INT NOT NULL,
  match_order   INT NOT NULL,
  home_team_id  INT NOT NULL,
  away_team_id  INT NOT NULL,
  home_score    INT DEFAULT NULL,
  away_score    INT DEFAULT NULL,
  played        BOOLEAN NOT NULL DEFAULT FALSE,
  played_at     TIMESTAMP NULL DEFAULT NULL,
  KEY idx_pool_matches_pool (pool_id),
  FOREIGN KEY (pool_id)      REFERENCES pools(id) ON DELETE CASCADE,
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cups (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id      INT NOT NULL,
  name               VARCHAR(255) NOT NULL,
  cup_index          INT NOT NULL,
  source_placements  JSON NOT NULL,
  total_teams        INT NOT NULL,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cup_matches (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  cup_id            INT NOT NULL,
  round             INT NOT NULL,
  bracket_position  INT NOT NULL,
  home_seed         JSON DEFAULT NULL,
  away_seed         JSON DEFAULT NULL,
  home_team_id      INT DEFAULT NULL,
  away_team_id      INT DEFAULT NULL,
  home_score        INT DEFAULT NULL,
  away_score        INT DEFAULT NULL,
  played            BOOLEAN NOT NULL DEFAULT FALSE,
  played_at         TIMESTAMP NULL DEFAULT NULL,
  next_match_id     INT DEFAULT NULL,
  next_match_slot   ENUM('home','away') DEFAULT NULL,
  KEY idx_cup_matches_cup (cup_id),
  FOREIGN KEY (cup_id)        REFERENCES cups(id) ON DELETE CASCADE,
  FOREIGN KEY (home_team_id)  REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (away_team_id)  REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (next_match_id) REFERENCES cup_matches(id) ON DELETE SET NULL
) ENGINE=InnoDB;
