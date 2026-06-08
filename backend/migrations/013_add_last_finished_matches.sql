-- Migration 013: Last finished match snapshot
-- Holder en kopi af resultatet fra den senest afsluttede kamp på banen,
-- så TV-visningen kan beholde resultatet i nogle minutter efter
-- at courten har trykket "Ryd bane".

CREATE TABLE IF NOT EXISTS last_finished_matches (
  court_id INT PRIMARY KEY,
  player1_name VARCHAR(100),
  player1_name2 VARCHAR(100),
  player2_name VARCHAR(100),
  player2_name2 VARCHAR(100),
  player1_games INT DEFAULT 0,
  player2_games INT DEFAULT 0,
  set_scores_history JSON,
  is_doubles BOOLEAN DEFAULT FALSE,
  match_end_time DATETIME NULL,
  cleared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (court_id) REFERENCES courts(id) ON DELETE CASCADE
) ENGINE=InnoDB;
