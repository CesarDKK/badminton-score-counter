-- Migration 047: admin kan vælge, hvilket af TV-PC'ens kameraer der sender
--
-- Nogle webcams (Windows Hello, fx Lenovo 500 FHD) er to videoenheder med samme
-- navn: billedet og et infrarødt kamera. TV-PC'en vælger selv billedet (navn,
-- formater og et prøvebillede), men vælger den en dag forkert, kan admin under
-- Livestream sætte en bestemt enhed (by-id-linket, fx
-- usb-17ef_Lenovo_500_RGB_Camera_…-if00-video-index0). NULL = automatisk.

ALTER TABLE device_tokens ADD COLUMN camera_device VARCHAR(160) NULL DEFAULT NULL;
