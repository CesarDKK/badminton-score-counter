-- Migration 021: tournament_player_clubs
-- Gemmer klub pr spiller fanget ved TS-import saa auto-logo-resolution kan slaa op paa navn
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
