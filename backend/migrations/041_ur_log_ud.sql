-- Migration 041: uret logges ud, når det ikke bruges (routes/urTaeller.js)
--
-- tryk_at: hvornår urets seneste tryk (tryk_taeller) kom. Har uret ikke trykket
-- i 15 minutter og tæller ikke en kamp, der er i gang, er det logget ud og skal
-- taste koden fra TV'et igen. Ellers kunne et glemt ur tælle på banen resten af
-- dagen efter "Ny kamp".

ALTER TABLE game_states ADD COLUMN tryk_at DATETIME NULL DEFAULT NULL;
