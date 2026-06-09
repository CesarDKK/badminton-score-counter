-- Migration 014: Skift standard kamptilstand fra 21/30 til 15/21
-- Ny default for app'en. Koerer en gang og flipper den persisterede vaerdi
-- saa nye baner faar 15/21 som default. Eksisterende baner i courts-tabellen
-- roeres ikke (admin kan stadig aendre pr bane via Rediger Bane).

UPDATE settings
SET setting_value = '15'
WHERE setting_key = 'default_game_mode' AND setting_value = '21';

INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('default_game_mode', '15');
