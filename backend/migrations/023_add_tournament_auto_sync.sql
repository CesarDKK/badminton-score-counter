-- Migration 023: serverbaseret auto-opdatering fra Tournament Software
-- Flaget gemmes i databasen (ikke i browseren) saa schedulerens 4-minutters
-- job kan synce turneringen selv naar admin-siden er lukket.
ALTER TABLE tournaments ADD COLUMN auto_sync TINYINT(1) NOT NULL DEFAULT 0;
