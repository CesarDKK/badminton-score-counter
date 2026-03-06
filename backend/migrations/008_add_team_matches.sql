-- Migration 008: Add team matches (holdkamp) tables
-- Run this on existing installations

CREATE TABLE IF NOT EXISTS team_matches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  format VARCHAR(20) NOT NULL,
  team1_name VARCHAR(100) NOT NULL,
  team2_name VARCHAR(100) NOT NULL,
  status ENUM('active', 'finished') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS team_match_games (
  id INT PRIMARY KEY AUTO_INCREMENT,
  team_match_id INT NOT NULL,
  game_number INT NOT NULL,
  category VARCHAR(10) NOT NULL,
  team1_player1 VARCHAR(100),
  team1_player2 VARCHAR(100),
  team2_player1 VARCHAR(100),
  team2_player2 VARCHAR(100),
  court_number INT NULL,
  status ENUM('pending', 'active', 'finished') DEFAULT 'pending',
  winner_team TINYINT NULL,
  set_scores VARCHAR(200) NULL,
  FOREIGN KEY (team_match_id) REFERENCES team_matches(id) ON DELETE CASCADE
) ENGINE=InnoDB;
