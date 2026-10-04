-- Migration 031: kun én tæller ad gangen pr. bane
--
-- Tælleren gemmer hele banens tilstand, så to enheder der tæller samme kamp
-- overskrev hinandens point. Nu husker banen, hvilken enhed der tæller
-- (taeller_id er et tilfældigt id, enheden selv har lavet), og hvornår den
-- sidst gav lyd. Andre enheder ser med og kan trykke "Overtag tællingen" —
-- den der tællede, får så besked og kan tage den tilbage (forrige_*).
-- Kolonnerne ligger på game_states, så de forsvinder med rækken, når banen
-- ryddes eller frigives.

ALTER TABLE game_states ADD COLUMN taeller_id VARCHAR(64) NULL;
ALTER TABLE game_states ADD COLUMN taeller_navn VARCHAR(100) NULL;
ALTER TABLE game_states ADD COLUMN taeller_set_at DATETIME(3) NULL;
ALTER TABLE game_states ADD COLUMN forrige_taeller_id VARCHAR(64) NULL;
ALTER TABLE game_states ADD COLUMN forrige_taeller_navn VARCHAR(100) NULL;
ALTER TABLE game_states ADD COLUMN overtaget_at DATETIME(3) NULL;
