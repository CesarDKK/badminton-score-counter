-- Migration 038: TV-PC'en sætter selv sit kamera på sin bane
--
-- Melder en TV-PC et USB-kamera, og står dens adgangslink til en bane (tv/N),
-- sættes camera_court = N af sig selv — hvis banen ikke har et kamera, og admin
-- aldrig selv har valgt for linket. camera_manual = 1, når admin har valgt
-- under Livestream (også "Intet kamera"): så rører den automatiske ikke linket.
-- Eksisterende valg (camera_court sat) tæller som admins.

ALTER TABLE device_tokens ADD COLUMN camera_manual TINYINT(1) NOT NULL DEFAULT 0;
UPDATE device_tokens SET camera_manual = 1 WHERE camera_court IS NOT NULL;
