# Design: Klub-logoer — Del B (matching + tildeling/overrides)

**Dato:** 2026-06-23
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

Knyt klub-logoer (fra det centrale bibliotek bygget i del A) til **hold** (holdkampe)
og **spillere** (turneringer + Spiller info). Logoer udledes automatisk ud fra
navne, med manuel override hvor det ikke kan gennemskues. **Del C** (visning af
logoer ved kampene på bane/TV/oversigt) er en separat senere spec.

## 2. Beslutninger (truffet under brainstorm)

1. **To tilknytnings-niveauer:** logo pr. **hold** (holdkamp) og pr. **spiller**
   (turneringer + Spiller info).
2. **Matching:** delvist match — navnet **indeholder** logoets klubnavn eller alias
   (normaliseret). Ved flere match vinder **længste** match.
3. **Lagring:** dynamisk auto + gemt override. Vi gemmer KUN manuelle overrides;
   findes ingen override, udledes logoet dynamisk hver gang ud fra navnet.
4. **Spiller-logo = én kilde** gemt pr. spillernavn, redigerbar både i Spiller info
   OG inline i turneringskampe; en ændring slår igennem alle steder spilleren
   optræder (opretter override-rækken hvis den mangler).
5. **Verificering:** manuel (deploy lokalt + browser/curl). Ingen ny test-infra.

## 3. Arkitektur-kontekst (relevant fra del A + eksisterende)

- Del A: master-DB-tabel `club_logos(id, club_name, aliases, filename, original_name,
  file_path, file_size, width, height, mime_type, upload_date)`; filer i
  `/uploads/central_logos/`; Superadmin-CRUD på `/api/super-admin/logos`.
- Multi-tenant: master-DB (`masterDb`) + klub-DB (tenant-scoped `query`/`queryOne`).
  Klub-migrationer køres af `backend/config/migrationRunner.js` for default-DB +
  alle aktive klub-DB'er ved opstart; nye klub-DB'er får hele `init.sql`.
- `team_matches(team1_name, team2_name, …)` + `team_match_games` (holdkamp).
- `tournaments` + `tournament_matches(side1_player1, side1_player2, side2_player1,
  side2_player2, label, doubles, …)` — **kun spillernavne, ingen hold/klub-navne**.
- `player_info(id, name, club, gender, age_group, …)` pr. klub-DB.
- Eksisterende `normalizeName()` i `backend/routes/tournaments.js` (fjerner `[seed]`,
  saml mellemrum, lowercase) — inspiration; del B's matcher er en frontend-funktion.
- `GET /api/logos` findes IKKE endnu (kun superadmin-ruter). Offentlige læse-ruter
  følger mønstret fra `GET /api/sponsors/images` / `GET /api/player-info`.

## 4. Matching-motor

Delt **frontend**-funktion, fx `frontend/js/logo-match.js`:

```
normalizeLogoName(s):
  - String(s) -> lowercase
  - fjern seed-suffiks "[n]"
  - fjern endelses-holdnummer/romertal: trailing " 1".." 99", " i".." iv"
  - saml mellemrum, trim

matchLogo(name, logos) -> logo | null:
  - n = normalizeLogoName(name); hvis tom -> null
  - for hvert logo: byg kandidat-nøgler = [club_name, ...aliases.split(',')]
    normaliseret (uden number-strip — klubnavnet i biblioteket er kanonisk)
  - et logo matcher hvis n INDEHOLDER en nøgle (substring)
  - blandt alle match: vælg det med den LÆNGSTE matchende nøgle
  - returnér bedste logo eller null
```

Genbruges af override-vælgerne (del B) og visningen (del C).

## 5. Klub-vendt API

- **`GET /api/logos`** (offentlig læsning) → `[{ id, club_name, aliases, url,
  width, height }]` fra master-DB (`masterDb`). `url = /uploads/<filename>`.
  Frontend henter listen og kører `matchLogo` lokalt.
- `frontend/js/api.js`: `getPublicLogos()` (GET /api/logos).

## 6. Datamodel (overrides — kun manuelle)

Pr. klub-DB (migration + `init.sql`):

```
-- Holdkamp: override pr. hold (null = auto-match paa holdnavn)
ALTER TABLE team_matches ADD COLUMN team1_logo_id INT NULL;
ALTER TABLE team_matches ADD COLUMN team2_logo_id INT NULL;

-- Spiller-logo: én kilde pr. spillernavn (null/ingen raekke = auto via klub)
CREATE TABLE player_logos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  player_name VARCHAR(100) NOT NULL,
  logo_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_player_name (player_name)
);
```

`logo_id` er en løs reference til master-DB'ens `club_logos.id` (ingen cross-DB FK).
`player_name` gemmes som indtastet; opslag sker case-insensitivt på normaliseret navn
(applikationen normaliserer ved læsning/skrivning, fx trim + lowercase nøgle).

## 7. Opslags-rækkefølge (bruges i pickers nu; visning i del C)

- **Hold (holdkamp):** `teamN_logo_id` hvis sat → ellers `matchLogo(teamN_name, logos)`.
- **Spiller:** override i `player_logos` for navnet hvis sat → ellers slå spilleren op
  i `player_info` på navn → `matchLogo(club, logos)` → ellers intet logo.

## 8. Backend-API

- `GET /api/logos` (offentlig) — se §5.
- **Player-logos** (klub-DB, offentlig læsning / `authMiddleware` ved skrivning):
  - `GET /api/player-logos` → `[{ player_name, logo_id }]` (til opslag/visning).
  - `PUT /api/player-logos` (body `{ playerName, logoId }`) — upsert override for navnet.
  - `DELETE /api/player-logos?name=<navn>` — fjern override (tilbage til auto).
- **Holdkamp** (`teamMatches.js`):
  - `POST /api/team-matches` accepterer `team1LogoId` / `team2LogoId`.
  - `PUT /api/team-matches/:id/logos` (body `{ team1LogoId, team2LogoId }`) — ret på
    aktiv holdkamp (null rydder).
  - `GET /active` og `/active-all` returnerer `team1_logo_id` / `team2_logo_id`.

## 9. UI-flader

- **Spiller info** (`player-info.html` / `player-info-script.js`): i rediger-spiller-
  modalen en logo-vælger der viser det auto-matchede logo som forvalg (ud fra spillerens
  klub) og lader brugeren vælge et andet eller rydde. Gemmer via `PUT /api/player-logos`
  (eller DELETE ved rydning). Henter logo-listen ved load.
- **Holdkamp** (`admin.html` / `admin-script.js`): i "Opret ny Holdkamp" en logo-vælger
  pr. hold (forvalg = `matchLogo(holdnavn)`, kan ændres) → sendes som `team1LogoId`/
  `team2LogoId`. På en aktiv holdkamp kan logoerne ændres (kald `PUT .../logos`).
- **Turnering** (`admin.html` / `admin-script.js`): i turnerings-kampvisningen en lille
  "sæt logo"-handling pr. spiller (forvalg = nuværende opslag) → `PUT /api/player-logos`
  for spillernavnet, så det slår igennem alle kampe spilleren er i.
- Alle vælgere bruger den delte `matchLogo` til at vise forvalget og `getPublicLogos`
  til at fylde valgmulighederne (thumbnail + klubnavn).

## 10. Manuel verificering (acceptkriterier)

- `GET /api/logos` returnerer det centrale bibliotek offentligt.
- Opret holdkamp "Lyngby 1" vs "Roskilde 2" hvor begge klubber har logo i biblioteket →
  vælgeren forvælger korrekt logo automatisk; kan ændres; valget gemmes og returneres i
  `active-all`.
- Et tvetydigt/ukendt holdnavn → intet auto-forvalg; manuelt valg kan sættes.
- Spiller info: rediger en spiller → auto-logo (ud fra klub) vises; override gemmes; kan
  ryddes tilbage til auto.
- Turnering: sæt en spillers logo inline → samme spiller viser nu logoet i en anden
  turneringskamp (og i Spiller info), fordi det er gemt pr. navn.
- Tilføjer Superadmin et nyt logo i biblioteket, slår auto-match igennem uden at røre
  eksisterende hold/spillere (dynamisk).

## 11. Risici / opmærksomhedspunkter

- **Navne-kollision:** to forskellige spillere med samme navn deler override (samme
  begrænsning som player_info-opslag på navn). Accepteret.
- **Delvist match → falske match:** afbødet af længste-match + manuel override. Vælgerne
  viser altid det forvalgte logo, så fejl er synlige og kan rettes.
- **Løs reference:** sletter Superadmin et logo (del A, hård sletning), kan en override
  pege på et ikke-eksisterende id → opslaget giver "intet logo" (frontend ignorerer
  manglende id). Acceptabelt i del B; evt. oprydning kan tilføjes senere.
- **Migrationer:** kør for default-DB + alle klub-DB'er via migrationRunner; ingen
  semikoloner i SQL-kommentarer (kendt fælde i splitStatements).
- **Stor leverance:** kan implementeres i faser (matcher+API → spiller/Spiller info →
  holdkamp → turnering), men udgør én spec.
- **Produktion (Pi):** backend + frontend ændres → `docker-compose build backend
  frontend && docker-compose up -d backend frontend`.
