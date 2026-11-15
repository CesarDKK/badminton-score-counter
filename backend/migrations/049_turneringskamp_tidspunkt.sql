-- Migration 049: TS' planlagte tidspunkt pr. turneringskamp
--
-- Import og opdatering fra Tournament Software gemmer kampens planlagte
-- tidspunkt ("YYYY-MM-DD HH:MM", som TS viser det - ingen tidszone), saa admin
-- kan sortere 200-300 kampe efter tid og vise det ved valget af kamp til en bane.
-- NULL for kampe uden tidspunkt (manuelt oprettede eller endnu ikke planlagt).

ALTER TABLE tournament_matches ADD COLUMN planned_time VARCHAR(16) NULL AFTER label;
