-- Migration: Add player_info table for storing player information
-- Run this once on existing databases

CREATE TABLE IF NOT EXISTS player_info (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  club VARCHAR(100) NOT NULL,
  age_group ENUM('U9', 'U11', 'U13', 'U15', 'U17', 'U19') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name (name),
  INDEX idx_club (club),
  INDEX idx_age_group (age_group)
) ENGINE=InnoDB;
