-- Add tv_version setting to allow switching between classic (v2) and new (v3) TV views
-- Follows the same pattern as court_version setting

INSERT INTO settings (setting_key, setting_value)
VALUES ('tv_version', 'v2')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
