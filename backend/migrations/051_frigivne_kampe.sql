-- Migration 051: en kamp, der frigives efter inaktivitet, gemmes først
--
-- Rest af nr. 4 (pakke P): scheduleren (releaseInactiveCourts) frigiver en bane,
-- hvor en almindelig kamp har stået stille længe (skadespause, tablet uden net,
-- ur under opvarmning). Før blev rækken i game_states slettet uden spor. Nu
-- gemmes den her først, og en tablet, der kommer tilbage til den tomme bane med
-- kampen i gang, spørger "Fortsæt kampen?" i stedet for at begynde forfra.
--
--   data         banens række fra game_states, som den var (JSON)
--   frigivet_at  hvornår scheduleren frigav banen
--
-- Én række pr. bane (den seneste frigivelse). Ryddes ved midnats-nulstillingen
-- og når admin/tabletten rydder banen. Ikke med i klubbens backup.

CREATE TABLE IF NOT EXISTS frigivne_kampe (
  court_id INT NOT NULL PRIMARY KEY,
  data JSON NOT NULL,
  frigivet_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
