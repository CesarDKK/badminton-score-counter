-- Add court_version setting to settings table
-- Allows switching between classic (v2) and new (v3) court page

INSERT INTO settings (setting_key, setting_value)
VALUES ('court_version', 'v2')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
