-- Tilføj flag til at styre om et TV-link viser QR-koden i klub-mode.
-- Default TRUE så eksisterende TV-links bevarer deres nuværende opførsel.
-- Kun relevant for destinationer der starter med 'tv/'; andre destinationer
-- (court/*, oversigt) bruger aldrig feltet.

ALTER TABLE device_tokens
ADD COLUMN show_qr_on_tv BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Vis QR-kode på TV (kun relevant for tv/*-destinationer)' AFTER locked;
