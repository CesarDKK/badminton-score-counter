-- Spiller-logo overrides (en kilde pr. spillernavn) -- ingen semikolon i kommentarer
CREATE TABLE IF NOT EXISTS player_logos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  player_name VARCHAR(100) NOT NULL,
  logo_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_player_name (player_name)
) ENGINE=InnoDB;
