-- Migration 035: indstillinger for livestreamen (admin → Livestream)
--
-- Pr. bane, fordi det afhænger af, hvordan kameraet sidder:
--   flip_180     billedet vendes 180° (kameraet hænger på hovedet)
--   mirror       spejlvendt vandret
--   autofocus    kameraets autofokus (ellers fast fokus på lang afstand)
--   sound        kameraets mikrofon med (ellers et lydløst lydspor)
--   logo         'ingen', 'sponsor' (banens sponsor-banner) eller 'klub'
--                (klubbens logo, uploadet i admin)
--
-- Fælles for klubben (opløsning, billeder i sekundet, kvalitet, overlayets
-- placering og størrelse, minutter efter kampen og klubbens logo) ligger som
-- JSON i settings under 'livestream'.

ALTER TABLE court_streams ADD COLUMN flip_180 BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE court_streams ADD COLUMN mirror BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE court_streams ADD COLUMN autofocus BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE court_streams ADD COLUMN sound BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE court_streams ADD COLUMN logo ENUM('ingen','sponsor','klub') NOT NULL DEFAULT 'ingen';
