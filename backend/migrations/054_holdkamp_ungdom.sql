-- Migration 054: ungdomsholdkampe sendes ikke automatisk på livestream
--
-- Badminton Danmark følger DIF's anbefaling om som udgangspunkt ikke at
-- livestreame kampe for børn og unge under 18 (Jesper 2026-11-21). Holdkampe
-- sendes ellers af sig selv på en bane med kamera — en ungdomsholdkamp gør ikke.
-- Den kan stadig startes med vilje (tabletten eller "Send hele dagen" i admin).
--
-- team_matches.ungdom: 1 = ungdomsholdkamp. Sættes ved import fra
-- badmintonplayer.dk ud fra rækkens aldersgruppe (U09 … U17/U19 = ungdom,
-- SEN = senior) eller af admin i formularen. Eksisterende holdkampe får 0
-- (som før).
--
-- Kan køres igen: 1060 (kolonnen findes) springes over.

ALTER TABLE team_matches ADD COLUMN ungdom TINYINT(1) NOT NULL DEFAULT 0;
