-- Migration 046: sidernes orientering og golden set gemmes (pakke J, nr. 28 og 30)
--
-- Nr. 28 — game_states.sides_swapped: uret og TV'et fandt ud af, hvilken side der
-- står hvor, ved at sammenligne navnene. Med ens navne på begge sider ("Emil" mod
-- "Emil") gik det galt: uret gav begge knapper til side 1, og TV'et troede, siderne
-- altid var byttet. sides_swapped = den side, der begyndte kampen som player2, står
-- nu i player1. Reglerne (frontend/js/taeller-regler.js) skifter den ved hvert
-- sideskift, og en ny kamp begynder med FALSE. Navnene bruges stadig, når de er
-- forskellige.
--
-- Nr. 30 — game_states.sets_to_win: golden set (ét sæt, 1) kendtes kun i
-- tablettens hukommelse og forsvandt ved genindlæsning, til holdkamp-synken
-- bandt delkampen igen — og uret talte altid bedst af tre. 2 = bedst af tre.
--
-- Kan køres igen: 1060 (kolonnen findes) springes over.

ALTER TABLE game_states ADD COLUMN sides_swapped BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE game_states ADD COLUMN sets_to_win TINYINT NOT NULL DEFAULT 2;
