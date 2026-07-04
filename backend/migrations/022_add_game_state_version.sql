-- Migration 022: optimistic concurrency for game_states
-- Hver opdatering bumper version. Klienter medsender expectedVersion i PUT;
-- ved mismatch svarer serveren 409 med den aktuelle tilstand i stedet for
-- at overskrive i blinde (last write wins).
ALTER TABLE game_states ADD COLUMN version INT NOT NULL DEFAULT 0;
