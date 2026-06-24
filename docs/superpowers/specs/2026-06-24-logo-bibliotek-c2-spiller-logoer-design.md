# Design: Klub-logoer — C2 (individuelle/turnerings-spiller-logoer)

**Dato:** 2026-06-24
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

Vis klub-logoer pr. **spiller** i individuelle/turneringskampe på **TV** og
**Oversigt**, bygget oven på det centrale logo-bibliotek (del A), matching/overrides
(del B) og holdkamp-visningen (del C). Dette er det trin der i del C blev udskudt som
"C2". Holdkamp-team-logoer (del C) er uændrede.

## 2. Forudgående undersøgelse (a) — afgørende fund

Fra inspektion af den faktiske tournamentsoftware-turnering:
- Kamp-listen (det importen læser) eksponerer pr. spiller: navnet, et **tournament-
  lokalt klub-ID** (`data-club-id`), og et spiller-ID (`data-player-id`) — **men ikke
  klubnavnet**. Der er intet klub-filter eller id→navn-tabel på Matches-siden.
- Klubnavnet findes på **spillerens profilside** (`/sport/player.aspx?id=<turnering>
  &player=<N>`) i `<h2 class="media__title--large">…<span class="nav-link__value">
  KLUBNAVN</span>`.
- TS's eget klub-logo (`content.tournamentsoftware.com/images/club/<guid>.jpg`) er
  **ubrugeligt**: URL'en er efemerisk (GUID skifter hvert kald), giver 404 selv med
  consent-cookie + referer, og mange klubber har slet intet logo uploadet. Logo-kilden
  er derfor **dit centrale bibliotek matchet på klubnavn** — samme model som del C.

## 3. Beslutninger (truffet under brainstorm)

1. **Flader:** TV + Oversigt. **Ingen logoer på Court v3** (som del C).
2. **Doubles:** **ét logo pr. spiller** (op til to pr. side), vist ud for hvert navn.
3. **Klub-opsamling:** **automatisk under import** (henter klub via profilsider).
4. **Arkitektur:** tilgang A — dedikeret turnerings-klub-mapping + samlet
   navn→klub-endpoint + delt frontend-resolver. (Fravalgt: berige `player_info`
   ved import — kæmper mod `gender`/`age_group NOT NULL` og forurener registret; samt
   klub-kolonner på `tournament_matches` — duplikeret og kræver ekstra plumbing.)
5. **Verificering:** manuel (browser + curl). Ingen ny test-infra.

## 4. Eksisterende byggeklodser (genbruges uændret)

- `club_logos` (master-DB) + `GET /api/logos` (public) → `{ id, club_name, aliases,
  url, … }`.
- `window.LogoMatch.matchLogo(name, logos)` — delvist match på klubnavn/alias.
- `player_logos (player_name UNIQUE, logo_id)` + `GET/PUT/DELETE /api/player-logos`
  (override pr. spillernavn; `logo_id > 0` = bestemt, `0` = intet, ingen række = auto).
- `player_info (name, club, gender, age_group)` + offentlige GET-endpoints
  (`/`, `/search`, `/:id`).
- Import: `importTournament.js` (`/preview`, `fetchAndParseTournamentMatches`,
  `parseMatchesHtml`, `extractPlayerNames`), og `tournaments.js`
  (`POST /:id/matches/bulk`, `POST /:id/sync-import`, `source_tournament_id`).
- Admin kan allerede sætte turnerings-spiller-logo (`setTournamentPlayerLogo` →
  `player_logos`).

## 5. Datamodel

Ny tabel (pr. klub-DB; oprettes via nummereret migration):

```sql
CREATE TABLE IF NOT EXISTS tournament_player_clubs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  tournament_id INT NOT NULL,
  player_name VARCHAR(100) NOT NULL,
  club VARCHAR(100) NOT NULL,
  source_player_id VARCHAR(40) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tournament_player (tournament_id, player_name),
  INDEX idx_player_name (player_name),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

Bemærk: ingen semikolon i `.sql`-kommentarer (migration-runner splitter på `;`).

Nyt offentligt endpoint **`GET /api/player-clubs`**:
- Returnerer en samlet liste `[{ name, club }]` = union af `player_info(name, club)` og
  `tournament_player_clubs(player_name, club)`.
- **Konfliktregel:** findes samme navn begge steder, vinder `player_info` (manuelt
  kurateret). Implementeres ved at lægge `tournament_player_clubs` ind først og lade
  `player_info` overskrive pr. navn (case-insensitiv på normaliseret navn).

## 6. Import — automatisk klub-opsamling

### 6.1 Parser fanger ID'er
`parseMatchesHtml`/`extractPlayerNames` i `importTournament.js` udvides til pr. spiller
at returnere `{ name, playerId, clubId }` i stedet for kun navnet. De eksisterende
flade felter (`side1Player1` … `side2Player2`) bevares uændret for bagudkompatibilitet;
de nye data tilføjes som `side1` / `side2` arrays af spiller-objekter på hver match.

Regex-kilde (bekræftet i undersøgelse a):
`data-player-id="(\d+)"[^>]*data-club-id="(\d*)"[^>]*>\s*<span class="nav-link__value">\s*([^<]+?)\s*</span>`
(klub-id kan være tomt → ingen klub for den spiller).

### 6.2 Klubnavn-opslag
Ny funktion `resolveClubNames(tournamentId, matches)` i `importTournament.js`:
- Saml distinkte `clubId` (ikke-tomme) på tværs af alle kampe, med én repræsentativ
  `playerId` pr. `clubId`.
- Hent profilsiden for hver repræsentativ spiller **parallelt** (`Promise.all`) via den
  eksisterende `fetchTournamentPage`/consent-session; parse klubnavnet med
  `/<h2[^>]*media__title--large[\s\S]*?nav-link__value">\s*([^<]+?)\s*</`.
- Returnér `Map<clubId, clubName>`. Fejl pr. klub er ikke-fatale (logges, klub udelades).

### 6.3 Persistering
Eksportér en hjælper `buildPlayerClubRows(matches, clubIdToName)` der mapper hver
spiller (med ikke-tom `clubId` og kendt klubnavn) til `{ player_name, club,
source_player_id }`, dedupliceret pr. `player_name`.

I `tournaments.js`:
- Efter `POST /:id/matches/bulk` (og i `POST /:id/sync-import`): kald
  `resolveClubNames` + `buildPlayerClubRows`, og upsert ind i
  `tournament_player_clubs` med `INSERT … ON DUPLICATE KEY UPDATE club = VALUES(club),
  source_player_id = VALUES(source_player_id)`.
- Hele klub-opsamlingen wrappes i try/catch: en fejl må **ikke** vælte selve importen
  (kampe gemmes uanset; logoer er sekundære).

## 7. Resolution-model + delt resolver

Udvid `frontend/js/logo-match.js`:

```
LogoMatch.resolvePlayerLogo(playerName, { playerLogos, clubByName, logos }) -> logo | null
  n = normalizeName(playerName)               // genbruger eksisterende normalizeName
  override = playerLogos finder match paa playerName (raa, trimmet)
    findes & logo_id === 0  -> null            (intet logo)
    findes & logo_id  >  0  -> logos.find(id === logo_id) || null
  ellers (auto):
    club = clubByName[n]                       // navn->klub (normaliseret noegle)
    club ? matchLogo(club, logos) : null
```

- `playerLogos` = `api.getPlayerLogos()` (`[{player_name, logo_id}]`).
- `clubByName` = map bygget af `api.getPlayerClubs()` (normaliseret navn → klub).
- `logos` = `api.getPublicLogos()`.
- Samme 3-tilstands-semantik som del C. Override (admin) vinder altid over auto.

Ny API-klient-metode `getPlayerClubs()` i både `js/api.js` og `js/api-v2.js` (TV):
`return this.request('/player-clubs', { requiresAuth: false })`.

## 8. Visning

### 8.1 TV (`tv-script-v3.js` / `tv-v3.html`)
- Hent + cache `getPublicLogos`, `getPlayerLogos`, `getPlayerClubs` én gang (lazy, som
  del C's `_tvLogos`).
- I poll-loopet, **når banen IKKE er en holdkamp-delkamp** (`byCourt`/`byCourt.game`
  falsy — samme tjek som del C): vis spiller-logoer.
  - Singler: ét logo ud for hver sides spillernavn.
  - Doubles: ét logo ud for hvert af de to navne på hver side (`name` og `name2`).
- **Gensidig udelukkelse med del C:** er banen en holdkamp-delkamp → vis hold-logoer
  (del C, `#team1Logo`/`#team2Logo`) og skjul spiller-logoer; ellers omvendt.
- Egne `<img>`-elementer pr. spillernavn (fx `.tv-player-logo` i `.team-names` ved hvert
  `.player-name`), adskilt fra del C's per-row hold-logo. Idempotent `src`-opdatering
  (kun ved ændring → ingen flicker), `<img onerror>` skjuler.
- Navne-mapping/side-skift følger den eksisterende `playersSwapped`-logik, så logoet
  følger det viste navn.

### 8.2 Oversigt (`oversigt-script.js` / `oversigt-styles.css`)
- Hent + cache de samme tre lister i `initialize` (ved siden af `_overviewLogos`).
- I de **individuelle bane-kort** (ikke holdkamp-kortet) vises et spiller-logo ud for
  hvert spillernavn via `resolvePlayerLogo`. Doubles: ét pr. navn.
- Holdkamp-kortet (del C) er uændret.
- Logoer sættes i struktur-renderen; live-score-patch rører dem ikke.

### 8.3 Court v3
Ingen ændringer — bevidst ingen logoer på scoringsskærmen.

## 9. Fejl / edge-cases

- Spiller uden klub (ikke i `player_info`, ingen importeret klub) → intet logo.
- Klub uden bibliotekslogo → `matchLogo` = null → intet logo.
- TS-profil utilgængelig/uden klub under import → klub udelades (ikke-fatal; importen
  gennemføres).
- Ukendt/slettet `logo_id` i override → `logos.find` = undefined → intet logo.
- Billede kan ikke hentes → `<img onerror>` skjuler elementet.
- Navne fra TS gemmes verbatim → eksakt match mellem name→club og display; manuelt
  indtastede navne resolves via `player_info`.
- Admin-override (`player_logos`) vinder altid over auto-match.

## 10. Manuel verificering (acceptkriterier)

- Importér en TS-turnering → `tournament_player_clubs` fyldes (verificér med
  `SELECT COUNT(*)`), og `GET /api/player-clubs` returnerer navn→klub.
- En single-kamp med spillere fra klubber der har bibliotekslogo: TV + Oversigt viser
  hver spillers logo.
- En double-kamp: op til to logoer pr. side (ét pr. spiller), korrekt klub pr. spiller.
- En spiller sat til "intet logo" (override 0) viser intet, selv hvis klubben matcher.
- En spiller med bestemt override viser det valgte logo.
- Holdkamp: uændret (hold-logoer via del C, ingen spiller-logoer).
- Court v3: ingen spiller-logoer.
- `/sync-import` på en eksisterende turnering opdaterer `tournament_player_clubs` uden
  dubletter.

## 11. Risici / opmærksomhedspunkter

- **Import-latens:** klub-opslag tilføjer ~1 profil-hentning pr. distinkt klub (typisk
  20–40, parallelt). Acceptabelt; klub-opsamling er try/catch-isoleret fra kamp-gemning.
- **TS-markup-skift:** profil-klub-parsing afhænger af `media__title--large` — samme
  skrøbelighed som den eksisterende kamp-parsing; regex er centraliseret i
  `importTournament.js`.
- **Tre ekstra offentlige lister på fladerne:** caches og opdateres idempotent for at
  undgå flicker (som del C).
- **Produktion (Pi):** backend (parser, endpoint, migration) + frontend ændres →
  `docker-compose build backend frontend && docker-compose up -d backend frontend`.
- **Navne-normalisering:** `clubByName` nøgles på `normalizeName` for robust opslag på
  tværs af små variationer; rå navn bruges til `player_logos`-override (som i dag).
