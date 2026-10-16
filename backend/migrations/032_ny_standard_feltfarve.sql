-- Migration 032: ny standard-feltfarve i temaet (E3 i designgennemgangen)
--
-- Den gamle standard #0f3460 er en klar blå, der passer dårligt til den lilla
-- primærfarve. Ny standard er #252347 (lilla-navy). Kun klubber, der stadig har
-- den gamle standardværdi, flyttes med; klubber med deres egen felt-farve røres
-- ikke. Kan køres igen uden virkning.

UPDATE settings SET setting_value = '#252347' WHERE setting_key = 'color_bg_card' AND LOWER(setting_value) = '#0f3460';
