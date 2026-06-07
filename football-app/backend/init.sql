CREATE DATABASE IF NOT EXISTS football_tournament
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE football_tournament;

-- ──────────────────────────────────────────────────────────────────────
-- Self-healing migration: hvis et legacy single-tenant skema findes
-- (tournaments uden club_id-kolonne), wipes vi alle tabeller og bygger
-- multi-tenant skemaet fra bunden. Brugeren har accepteret destruktiv
-- migrering. Efter første kørsel er init.sql idempotent.
-- ──────────────────────────────────────────────────────────────────────
SET @table_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                     WHERE TABLE_SCHEMA = 'football_tournament'
                       AND TABLE_NAME = 'tournaments');
SET @club_col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_SCHEMA = 'football_tournament'
                          AND TABLE_NAME = 'tournaments'
                          AND COLUMN_NAME = 'club_id');
SET @needs_wipe = (@table_exists > 0 AND @club_col_exists = 0);

SET @wipe_sql = IF(@needs_wipe,
  'DROP TABLE IF EXISTS cup_matches, cups, pool_matches, teams, pools, tournaments, football_club_admins, football_clubs',
  'DO 0');
PREPARE stmt FROM @wipe_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ──────────────────────────────────────────────────────────────────────
-- Multi-tenancy: klubber + per-klub admins
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS football_clubs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  subdomain   VARCHAR(63) NOT NULL UNIQUE,
  name        VARCHAR(100) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS football_club_admins (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  club_id        INT NOT NULL,
  username       VARCHAR(50) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  email          VARCHAR(100) DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (club_id) REFERENCES football_clubs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_club_username (club_id, username)
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────────────────────────────
-- Turneringer + relaterede tabeller — alle scoped pr. klub via club_id
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tournaments (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  club_id        INT NOT NULL,
  name           VARCHAR(255) NOT NULL,
  logo_path      VARCHAR(500) DEFAULT NULL,
  status         ENUM('setup', 'pool_stage', 'cup_stage', 'finished') NOT NULL DEFAULT 'setup',
  num_pools      INT NOT NULL,
  teams_per_pool INT NOT NULL,
  points_win     INT NOT NULL DEFAULT 3,
  points_draw    INT NOT NULL DEFAULT 1,
  points_loss    INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_tournaments_club (club_id),
  FOREIGN KEY (club_id) REFERENCES football_clubs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pools (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  club_id       INT NOT NULL,
  tournament_id INT NOT NULL,
  name          VARCHAR(50) NOT NULL,
  pool_index    INT NOT NULL,
  KEY idx_pools_club (club_id),
  FOREIGN KEY (club_id) REFERENCES football_clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  UNIQUE KEY uq_pool (tournament_id, pool_index)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teams (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  club_id    INT NOT NULL,
  pool_id    INT NOT NULL,
  name       VARCHAR(255) NOT NULL,
  logo_path  VARCHAR(500) DEFAULT NULL,
  team_index INT NOT NULL,
  KEY idx_teams_club (club_id),
  KEY idx_teams_pool (pool_id),
  FOREIGN KEY (club_id) REFERENCES football_clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pool_matches (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  club_id       INT NOT NULL,
  pool_id       INT NOT NULL,
  match_order   INT NOT NULL,
  home_team_id  INT NOT NULL,
  away_team_id  INT NOT NULL,
  home_score    INT DEFAULT NULL,
  away_score    INT DEFAULT NULL,
  played        BOOLEAN NOT NULL DEFAULT FALSE,
  played_at     TIMESTAMP NULL DEFAULT NULL,
  KEY idx_pool_matches_club (club_id),
  KEY idx_pool_matches_pool (pool_id),
  FOREIGN KEY (club_id)      REFERENCES football_clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (pool_id)      REFERENCES pools(id) ON DELETE CASCADE,
  FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cups (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  club_id            INT NOT NULL,
  tournament_id      INT NOT NULL,
  name               VARCHAR(255) NOT NULL,
  cup_index          INT NOT NULL,
  source_placements  JSON NOT NULL,
  total_teams        INT NOT NULL,
  KEY idx_cups_club (club_id),
  FOREIGN KEY (club_id) REFERENCES football_clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────────────────────────────
-- Logo-bibliotek: klub-uploadede logoer + globale landeflag.
-- club_id = NULL → globalt logo synligt for alle klubber (typisk flag).
-- club_id sat → klub-privat logo (kun synligt og editérbart for ejer).
-- ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS football_logos (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  club_id     INT NULL,
  name        VARCHAR(150) NOT NULL,
  url         VARCHAR(500) NOT NULL,
  kind        ENUM('flag', 'club', 'sponsor', 'other') NOT NULL DEFAULT 'club',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_logos_club_kind (club_id, kind),
  KEY idx_logos_name (name),
  FOREIGN KEY (club_id) REFERENCES football_clubs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cup_matches (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  club_id           INT NOT NULL,
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
  KEY idx_cup_matches_club (club_id),
  KEY idx_cup_matches_cup (cup_id),
  FOREIGN KEY (club_id)       REFERENCES football_clubs(id) ON DELETE CASCADE,
  FOREIGN KEY (cup_id)        REFERENCES cups(id) ON DELETE CASCADE,
  FOREIGN KEY (home_team_id)  REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (away_team_id)  REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (next_match_id) REFERENCES cup_matches(id) ON DELETE SET NULL
) ENGINE=InnoDB;
