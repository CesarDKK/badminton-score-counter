-- Migration script for adding theme settings to existing installations
-- Run this script if upgrading from v1.2.0 to v1.3.0

USE badminton_counter;

-- Add theme settings if they don't exist
INSERT INTO settings (setting_key, setting_value) VALUES
  ('theme_name', 'default'),
  ('color_primary', '#533483'),
  ('color_accent', '#e94560'),
  ('color_bg_dark', '#1a1a2e'),
  ('color_bg_container', '#16213e'),
  ('color_bg_card', '#0f3460')
ON DUPLICATE KEY UPDATE setting_key=setting_key;

SELECT 'Theme settings migration completed!' as Status;
SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'theme_%' OR setting_key LIKE 'color_%';
