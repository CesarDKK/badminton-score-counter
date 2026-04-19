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
  ('court_count', '5'),
  ('show_reset_button', 'true'),
  ('court_version', 'v3'),
  ('tv_version', 'v3'),
  ('theme_name', 'default'),
  ('color_primary', '#533483'),
  ('color_accent', '#e94560'),
  ('color_bg_dark', '#1a1a2e'),
  ('color_bg_container', '#16213e'),
  ('color_bg_card', '#0f3460')
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

  -- Serving state (for proper doubles and set transitions)
  serving_player INT DEFAULT NULL COMMENT '1 or 2, which player/team is serving',
  initial_server INT DEFAULT NULL COMMENT 'Who served first (for tracking)',
  serving_team INT DEFAULT NULL COMMENT 'For doubles: which team is serving (1 or 2)',
  serving_player_on_team INT DEFAULT NULL COMMENT 'For doubles: which player on team (1=main, 2=partner)',
  team1_right_court INT DEFAULT 1 COMMENT 'For doubles: which player on team 1 is in right court (1=main, 2=partner)',
  team2_right_court INT DEFAULT 1 COMMENT 'For doubles: which player on team 2 is in right court (1=main, 2=partner)',
  between_sets BOOLEAN DEFAULT FALSE COMMENT 'True when between sets, allows position swapping in doubles',

  -- Rest break data
  rest_break_active BOOLEAN DEFAULT FALSE,
  rest_break_seconds_left INT DEFAULT 0,
  rest_break_title VARCHAR(200) DEFAULT '',

  -- Set scores history (JSON array stored as text)
  set_scores_history TEXT,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  match_start_time TIMESTAMP NULL,
  match_end_time TIMESTAMP NULL,
  match_completed BOOLEAN DEFAULT FALSE,

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
  type ENUM('slideshow', 'court') DEFAULT 'slideshow',
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  mime_type VARCHAR(50) NOT NULL,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  display_order INT DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expiration_date TIMESTAMP NULL DEFAULT NULL,

  INDEX idx_display_order (display_order),
  INDEX idx_upload_date (upload_date DESC),
  INDEX idx_type (type),
  INDEX idx_sponsor_type (type, display_order, upload_date DESC),
  INDEX idx_sponsor_active_filter (type, is_active, expiration_date)
) ENGINE=InnoDB;

-- Sponsor image to court assignments (for court banner images)
CREATE TABLE IF NOT EXISTS sponsor_image_courts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  sponsor_image_id INT NOT NULL,
  court_number INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (sponsor_image_id) REFERENCES sponsor_images(id) ON DELETE CASCADE,
  UNIQUE KEY unique_court_assignment (court_number),
  INDEX idx_sponsor_image_id (sponsor_image_id),
  INDEX idx_court_number (court_number)
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

-- Team matches table (holdkamp)
CREATE TABLE IF NOT EXISTS team_matches (
  id INT PRIMARY KEY AUTO_INCREMENT,
  format VARCHAR(20) NOT NULL,
  team1_name VARCHAR(100) NOT NULL,
  team2_name VARCHAR(100) NOT NULL,
  status ENUM('active', 'finished') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Team match games table (individual games within a holdkamp)
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

-- Device tokens table (adgangsnøgler til tablets og TV-skærme)
CREATE TABLE IF NOT EXISTS device_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  token VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  destination VARCHAR(100) NOT NULL COMMENT 'fx court/1, tv, oversigt',
  token_type ENUM('permanent', 'match_session') DEFAULT 'permanent' COMMENT 'permanent = manuelt oprettet, match_session = auto-genereret QR-token per kamp',
  court_number INT DEFAULT NULL COMMENT 'Bane-nummer for match-session tokens',
  locked BOOLEAN DEFAULT FALSE COMMENT 'true = låst til destination, false = fri navigation',
  show_qr_on_tv BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Vis QR-kode på TV (kun relevant for tv/*-destinationer)',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  consumed_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Tidspunkt for første brug (sporing)',
  INDEX idx_token (token),
  INDEX idx_is_active (is_active),
  INDEX idx_court_number (court_number),
  INDEX idx_token_type (token_type)
) ENGINE=InnoDB;

-- Club admins table (bruges i multi-tenant mode)
CREATE TABLE IF NOT EXISTS club_admins (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(200) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username)
) ENGINE=InnoDB;

-- Player info table (stores player information)
CREATE TABLE IF NOT EXISTS player_info (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  club VARCHAR(100) NOT NULL,
  gender ENUM('Herre', 'Dame') NOT NULL,
  age_group ENUM('U9', 'U11', 'U13', 'U15', 'U17', 'U19') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_name (name),
  INDEX idx_club (club),
  INDEX idx_gender (gender),
  INDEX idx_age_group (age_group)
) ENGINE=InnoDB;
