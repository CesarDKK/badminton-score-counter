-- Migration 027: Integration med badmintonplanner.dk
--
-- badmintonplanner.dk sender en "runde" (spillernavne pr. bane) ved hver
-- rundestart på en træningsaften. Adgang sker med en API-nøgle, som klubbens
-- admin opretter under fanen Badmintonplanner, og kun inden for de ugentlige
-- tidsvinduer klubben har sat op (selve ugeplanen gemmes som JSON i settings
-- under nøglen planner_config).
--
--   planner_tokens             API-nøgler (én klub = én database, så nøglen er
--                              automatisk låst til klubben)
--   planner_rounds             Den aktuelt viste runde (kun én række ad gangen)
--   planner_court_assignments  Navne, udskiftere og note pr. bane i den runde
--   planner_log                De seneste kald til API'et, til fejlsøgning

CREATE TABLE IF NOT EXISTS planner_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT,
  token VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  INDEX idx_planner_token (token)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS planner_rounds (
  id INT PRIMARY KEY AUTO_INCREMENT,
  round_id VARCHAR(100) NULL COMMENT 'Afsenderens id for runden (idempotens)',
  sequence INT NULL COMMENT 'Afsenderens loebenummer (aeldre runder afvises)',
  label VARCHAR(100) NULL,
  note VARCHAR(500) NULL,
  next_round_at TIMESTAMP NULL COMMENT 'UTC. NULL i sidste runde',
  token_id INT NULL,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  result_json TEXT NULL COMMENT 'Svaret vi gav, saa et gentaget kald faar samme svar'
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS planner_court_assignments (
  court_number INT PRIMARY KEY,
  round_id INT NOT NULL,
  side1_player1 VARCHAR(100) NULL,
  side1_player2 VARCHAR(100) NULL,
  side2_player1 VARCHAR(100) NULL,
  side2_player2 VARCHAR(100) NULL,
  substitutes TEXT NULL COMMENT 'JSON-array af navne',
  note VARCHAR(200) NULL,
  FOREIGN KEY (round_id) REFERENCES planner_rounds(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS planner_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  token_name VARCHAR(100) NULL,
  ip VARCHAR(64) NULL,
  endpoint VARCHAR(60) NOT NULL,
  http_status INT NOT NULL,
  round_id VARCHAR(100) NULL,
  label VARCHAR(100) NULL,
  match_count INT NULL,
  result_json TEXT NULL,
  error_text VARCHAR(255) NULL,
  INDEX idx_planner_log_received (received_at DESC)
) ENGINE=InnoDB;
