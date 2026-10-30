-- Migration 037: klubbens logo i hjørnet af streamen som standard
--
-- Banerne stod til 'ingen', så et logo valgt under "Klubbens logo i streamen"
-- ikke kom med, før det også blev valgt under hver bane. Nu er 'klub' standard
-- (har klubben intet logo, vises intet), og eksisterende baner flyttes over —
-- valget fandtes kun i et par dage (migration 035).

ALTER TABLE court_streams MODIFY COLUMN logo ENUM('ingen','sponsor','klub') NOT NULL DEFAULT 'klub';
UPDATE court_streams SET logo = 'klub' WHERE logo = 'ingen';
