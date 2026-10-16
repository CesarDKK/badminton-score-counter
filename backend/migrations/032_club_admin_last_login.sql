-- Migration 032: hvornår klub-admin sidst loggede ind
--
-- Super-admin viser, hvornår hver klub-admin sidst loggede ind (klubbens
-- seneste login står desuden på clubs-rækken i master-databasen).

ALTER TABLE club_admins ADD COLUMN last_login_at TIMESTAMP NULL DEFAULT NULL;
