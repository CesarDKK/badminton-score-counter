-- Migration 012: Add tournaments (planlagte kampe) tables
-- Run this on existing installations

CREATE TABLE IF NOT EXISTS tournaments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  status ENUM('active', 'finished') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
  set_scores VARCHAR(200) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  INDEX idx_tournament_status (tournament_id, status)
) ENGINE=InnoDB;
