-- Migration 029: Resultater til badmintonplanner.dk
--
-- Kampe fra en badmintonplanner-runde kan nu både tælles point for point og
-- indtastes bagefter (fx "15-7 13-4", afsluttet før tid, eller walkover).
-- Resultatet gemmes i planner_results, som badmintonplanner.dk henter via
-- GET /api/integrations/results — løbende eller samlet for en aften.
--
--   planner_results               Ét resultat pr. bane pr. runde. Rettes der i
--                                 et resultat, opdateres rækken (samme id, ny
--                                 updated_at), så afhenteren kan se ændringen.
--   planner_court_assignments     match_ref: afsenderens id for kampen (valgfrit)
--   game_states.result_outcome    Hvordan kampen sluttede, når den ikke blev
--   game_states.result_winner     talt færdig (vinderen vælges ved indtastning)
--   game_states.result_history_id Rækken i match_history, så en rettelse
--                                 opdaterer kamphistorikken i stedet for at
--                                 lave en dublet

CREATE TABLE IF NOT EXISTS planner_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  round_pk INT NOT NULL COMMENT 'planner_rounds.id da resultatet blev til (rækken slettes ved næste runde)',
  token_id INT NULL,
  round_ref VARCHAR(100) NULL COMMENT 'Afsenderens roundId',
  round_sequence INT NULL,
  round_label VARCHAR(100) NULL,
  match_ref VARCHAR(100) NULL COMMENT 'Afsenderens matchId',
  court_number INT NOT NULL,
  side1_player1 VARCHAR(100) NULL,
  side1_player2 VARCHAR(100) NULL,
  side2_player1 VARCHAR(100) NULL,
  side2_player2 VARCHAR(100) NULL,
  outcome VARCHAR(20) NOT NULL COMMENT 'completed | ended_early | walkover | unfinished',
  winner TINYINT NULL COMMENT '1 = side1, 2 = side2, NULL = ingen vinder',
  sets_json TEXT NULL COMMENT '[{"side1":21,"side2":15}, ...] set fra side1/side2',
  source VARCHAR(10) NOT NULL COMMENT 'counted | entered',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_planner_result (round_pk, court_number),
  INDEX idx_planner_results_updated (token_id, updated_at),
  INDEX idx_planner_results_round (token_id, round_ref)
) ENGINE=InnoDB;

ALTER TABLE planner_court_assignments ADD COLUMN match_ref VARCHAR(100) NULL;

ALTER TABLE game_states ADD COLUMN result_outcome VARCHAR(20) NULL;
ALTER TABLE game_states ADD COLUMN result_winner TINYINT NULL;
ALTER TABLE game_states ADD COLUMN result_history_id INT NULL;
