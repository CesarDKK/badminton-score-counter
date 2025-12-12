-- ====================================
-- BADMINTON COUNTER DATABASE SCHEMA
-- ====================================

CREATE DATABASE IF NOT EXISTS badminton_counter
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE badminton_counter;

-- Settings table (replaces adminPassword and courtCount)
CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_setting_key (setting_key)
) ENGINE=InnoDB;

-- Insert default settings
-- Default password 'admin123' hashed with bcrypt
INSERT INTO settings (setting_key, setting_value) VALUES
  ('admin_password_hash', '$2b$10$q6TkK7O2BsYMOA3Z3BUZEekWMzOwMdbooBwrvngsnYWOhpPFeOqJC'),
  ('court_count', '5')
ON DUPLICATE KEY UPDATE setting_key=setting_key;

-- Courts table (stores court-specific settings)
CREATE TABLE IF NOT EXISTS courts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  court_number INT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  is_doubles BOOLEAN DEFAULT FALSE,
  game_mode ENUM('15', '21') DEFAULT '21',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_court_number (court_number),
  INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- Pre-populate 5 default courts
INSERT INTO courts (court_number) VALUES (1), (2), (3), (4), (5)
ON DUPLICATE KEY UPDATE court_number=court_number;

-- Game states table (replaces gameState_court{N})
CREATE TABLE IF NOT EXISTS game_states (
  id INT PRIMARY KEY AUTO_INCREMENT,
  court_id INT NOT NULL,

  -- Player 1 data
  player1_name VARCHAR(100) DEFAULT 'Spiller 1',
  player1_name2 VARCHAR(100) DEFAULT 'Makker 1',
  player1_score INT DEFAULT 0,
  player1_games INT DEFAULT 0,

  -- Player 2 data
  player2_name VARCHAR(100) DEFAULT 'Spiller 2',
  player2_name2 VARCHAR(100) DEFAULT 'Makker 2',
  player2_score INT DEFAULT 0,
  player2_games INT DEFAULT 0,

  -- Game metadata
  timer_seconds INT DEFAULT 0,
  deciding_game_switched BOOLEAN DEFAULT FALSE,

  -- Rest break data
  rest_break_active BOOLEAN DEFAULT FALSE,
  rest_break_seconds_left INT DEFAULT 0,
  rest_break_title VARCHAR(200) DEFAULT '',

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE,
  INDEX idx_court_id (court_id),
  UNIQUE KEY unique_court_state (court_id)
) ENGINE=InnoDB;

-- Match history table (replaces matchHistory_court{N})
CREATE TABLE IF NOT EXISTS match_history (
  id INT PRIMARY KEY AUTO_INCREMENT,
  court_id INT NOT NULL,

  winner_name VARCHAR(100) NOT NULL,
  loser_name VARCHAR(100) NOT NULL,
  games_won VARCHAR(10) NOT NULL,
  duration VARCHAR(20) NOT NULL,
  set_scores VARCHAR(200) DEFAULT NULL,

  match_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE,
  INDEX idx_court_id (court_id),
  INDEX idx_match_date (match_date DESC)
) ENGINE=InnoDB;

-- Sponsor images table (replaces sponsorImages localStorage)
CREATE TABLE IF NOT EXISTS sponsor_images (
  id INT PRIMARY KEY AUTO_INCREMENT,
  filename VARCHAR(255) UNIQUE NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  display_order INT DEFAULT 0,

  INDEX idx_display_order (display_order),
  INDEX idx_upload_date (upload_date DESC)
) ENGINE=InnoDB;

-- Sponsor settings table (replaces sponsorSlideDuration)
CREATE TABLE IF NOT EXISTS sponsor_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  slide_duration INT DEFAULT 10,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Insert default sponsor settings
INSERT INTO sponsor_settings (slide_duration) VALUES (10)
ON DUPLICATE KEY UPDATE id=id;
