-- Migration 043: skifer bliver det nye standardtema
--
-- Standard var lilla (#533483 / #1a1a2e / #16213e / #252347). Fra nov. 2026 er
-- Standard skifer-paletten, og det lilla tema hedder Klassisk (kan vælges under
-- Tema i admin). Kun klubber, der stadig har ALLE fem gamle standardfarver
-- (dvs. aldrig har valgt andet), flyttes til det nye. Klubber med egne farver
-- røres ikke. Kan køres igen uden virkning.

SET @gammel_standard = (
    SELECT COUNT(*) FROM settings WHERE
        (setting_key = 'color_primary'      AND LOWER(setting_value) = '#533483') OR
        (setting_key = 'color_accent'       AND LOWER(setting_value) = '#e94560') OR
        (setting_key = 'color_bg_dark'      AND LOWER(setting_value) = '#1a1a2e') OR
        (setting_key = 'color_bg_container' AND LOWER(setting_value) = '#16213e') OR
        (setting_key = 'color_bg_card'      AND LOWER(setting_value) = '#252347')
);

UPDATE settings SET setting_value = CASE setting_key
        WHEN 'color_primary'      THEN '#4a5c6a'
        WHEN 'color_bg_dark'      THEN '#11212d'
        WHEN 'color_bg_container' THEN '#253745'
        WHEN 'color_bg_card'      THEN '#06141b'
        ELSE setting_value END
    WHERE @gammel_standard = 5
      AND setting_key IN ('color_primary', 'color_bg_dark', 'color_bg_container', 'color_bg_card');

UPDATE settings SET setting_value = 'default'
    WHERE @gammel_standard = 5 AND setting_key = 'theme_name';

-- Klubber, der valgte det kortlivede "Skifer"-preset, har nu Standard
UPDATE settings SET setting_value = 'default'
    WHERE setting_key = 'theme_name' AND setting_value = 'slate';

-- En klub med navnet "default", men andre farver end den nye standard, har
-- tilpasset farverne. Vis den som Tilpasset frem for som Standard.
SET @ny_standard = (
    SELECT COUNT(*) FROM settings WHERE
        (setting_key = 'color_primary'      AND LOWER(setting_value) = '#4a5c6a') OR
        (setting_key = 'color_accent'       AND LOWER(setting_value) = '#e94560') OR
        (setting_key = 'color_bg_dark'      AND LOWER(setting_value) = '#11212d') OR
        (setting_key = 'color_bg_container' AND LOWER(setting_value) = '#253745') OR
        (setting_key = 'color_bg_card'      AND LOWER(setting_value) = '#06141b')
);

UPDATE settings SET setting_value = 'custom'
    WHERE @ny_standard < 5 AND setting_key = 'theme_name' AND setting_value = 'default';
