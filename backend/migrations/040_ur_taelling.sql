-- Migration 040: tæl fra uret (routes/urTaeller.js)
--
-- ur_kode: en kort kode til banens QR-session (device_tokens, token_type
-- 'match_session'), som TV'et viser under QR-koden. Uret taster den (eller får
-- den i linket fra telefonen) og får samme adgang som QR-koden: kun banen, kun
-- almindelig tælling, og den ophører med sessionen (rækken slettes, når banen
-- ryddes eller tildeles en holdkamp/turnering).
--
-- tryk_taeller/tryk_nr: urets seneste tryk på banen (enhedens id og løbenummer),
-- så et tryk, der sendes igen, fordi svaret gik tabt, ikke tæller to gange.
-- fortryd_historik: reglernes fortryd-historik (højst 20 tryk), som tabletten
-- har i hukommelsen — uret har ingen hukommelse mellem trykkene.
--
-- Slås til pr. klub i Indstillinger (settings 'ur_taelling'), fra som standard.

ALTER TABLE device_tokens ADD COLUMN ur_kode CHAR(6) NULL DEFAULT NULL;
ALTER TABLE device_tokens ADD INDEX idx_device_tokens_ur_kode (ur_kode);
ALTER TABLE game_states ADD COLUMN tryk_taeller VARCHAR(64) NULL DEFAULT NULL;
ALTER TABLE game_states ADD COLUMN tryk_nr INT NULL DEFAULT NULL;
ALTER TABLE game_states ADD COLUMN fortryd_historik MEDIUMTEXT NULL;
