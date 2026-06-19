# Design: Flere samtidige holdkampe

**Dato:** 2026-06-19
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

I dag kan der kun køre **én** aktiv holdkamp ad gangen. Når en ny holdkamp
oprettes, auto-afsluttes den forrige. Vi vil tillade **flere samtidige
holdkampe** (realistisk 2-3) så en hal kan afvikle flere holdkampe parallelt:

- Opret flere holdkampe på Admin → Holdkamp-siden.
- Vælg den rigtige delkamp på Court v3 uden en uoverskuelig liste (to-trins valg).
- Vis flere aktive holdkampe live på Oversigt.html i et 50/50-layout.

## 2. Beslutninger (truffet under brainstorm)

1. **Turnering ↔ holdkamp forbliver gensidigt blokerende.** Flere holdkampe må
   køre samtidig indbyrdes, men en aktiv turnering blokerer stadig oprettelse af
   holdkampe (og omvendt). Turnerings-flowet røres ikke.
2. **Court v3: to-trins valg** — vælg holdkamp, derefter dens delkamp.
3. **Skala 2-3 samtidige.** Oversigt optimeres til 50/50 + scroll. Ingen
   paginering/auto-scroll.
4. **Bane-konflikt (valg B):** en bane kan kun gen-tildeles hvis den delkamp der
   står på den ikke er gået i gang endnu (ingen point/sæt/timer). Så frigøres den
   gamle automatisk. Er kampen i gang → afvis.
5. **Verificering:** manuel (deploy lokalt + test i browser). Ingen ny
   test-infrastruktur.

## 3. Non-goals (YAGNI)

- Ingen auto-scroll/paginering på Oversigt.
- Ingen samtidig turnering + holdkamp.
- Ingen DB-migration (skemaet bærer allerede flere aktive — se §4).
- Ingen automatiseret test-suite i denne omgang.

## 4. Datamodel — ingen ændringer nødvendige

Skemaet understøtter allerede flere aktive holdkampe:

- `team_matches`: `id, format, team1_name, team2_name, status ENUM('active','finished'), created_at`.
  Flere rækker kan have `status='active'` samtidig — der er ingen DB-constraint
  der forhindrer det. Det er kun applikationskoden der antager én.
- `team_match_games`: `id, team_match_id, game_number, category,
  team1_player1/2, team2_player1/2, court_number (NULL), status
  ENUM('pending','active','finished'), winner_team, set_scores, finished_at`.
  `court_number` på delkampen er den naturlige routing-nøgle bane→kamp.

**Invariant vi indfører i koden:** på tværs af alle aktive holdkampe må højst
én delkamp have et givent `court_number` med `status='active'` ad gangen.

## 5. Nuværende "kun én aktiv"-antagelser (skal fjernes)

Backend (`backend/routes/teamMatches.js`):
- `GET /active` (~linje 35-61): `WHERE status='active' ... LIMIT 1`.
- `POST /` (~linje 64-84): `UPDATE team_matches SET status='finished' WHERE status='active'` (auto-afslut).
- `PUT /:id/games/:gameId` (~linje 113-173): frigør kun baner inden for *samme* holdkamp.

Frontend court (`frontend/court-script-v3.js`): `initHoldkampPanel` (~2070),
`refreshHoldkampPanel` (~2202), sync-loop (~1869-1911), `saveMatchResult`-fallback
(~1700-1710) — alle bruger `getActiveTeamMatch()` (singular) + global `activeTeamMatch`.

Frontend admin (`frontend/admin-script.js`): `loadActiveHoldkamp` (~1089),
`renderActiveHoldkamp` (~1155), `assignCourtToGame` (~1470).

Frontend oversigt (`frontend/oversigt-script.js`): `loadHoldkamp` (~44),
`renderHoldkampGames` (~85), stor rubrik `#holdkampOverview` i `oversigt.html` (~25-38).

## 6. Design

### 6.1 Backend (`backend/routes/teamMatches.js`)

- **Ny `GET /team-matches/active-all`** → array af alle `status='active'`
  holdkampe, hver med sine delkampe (samme form som dagens `/active`, blot uden
  `LIMIT 1`, sorteret `created_at ASC`). Behold `/active` for bagudkompatibilitet
  indtil alle kald er migreret.
- **Ny `GET /team-matches/by-court/:courtId`** → den ene aktive delkamp på den
  bane (`status='active' AND court_number=?`) + dens holdkamp-felter, eller
  `null`. Court v3's primære kilde til "min banes kamp".
- **`POST /`:** fjern auto-afslutningen af andre aktive holdkampe. Behold
  tournament-409-tjekket uændret.
- **`PUT /:id/games/:gameId` — cross-match bane-guard (valg B):** når
  `courtNumber` sættes (ikke null):
  1. Find anden aktiv delkamp på samme bane på tværs af ALLE aktive holdkampe
     (`SELECT ... WHERE court_number=? AND status='active' AND id != ?`).
  2. Findes en: slå banens game_state op. Hvis "i gang" (samme definition som
     admin-dropdownen: `player1.score>0 || player2.score>0 || player1.games>0 ||
     player2.games>0 || timerSeconds>0`) → returnér **409 "Bane optaget"**.
     Ellers frigør den (`court_number=NULL, status='pending'`) og fortsæt.
  3. Behold den eksisterende frigørelse inden for samme holdkamp.
  Game-state-opslaget sker via samme datakilde som `gameStates`-ruten bruger.

### 6.2 API-klient (`frontend/js/api.js`)

- `getActiveTeamMatches()` → `GET /team-matches/active-all`.
- `getTeamMatchByCourt(courtId)` → `GET /team-matches/by-court/:courtId`.

### 6.3 Admin "Holdkamp"-side (`frontend/admin-script.js`)

- `loadActiveHoldkamp`: hent `active-all`, loop og render et
  `renderActiveHoldkamp`-blok pr. holdkamp i `activeHoldkampContainer`.
  `renderActiveHoldkamp` tager allerede `teamMatch` som parameter og kan
  stort set genbruges.
- Opret-formularen (`createHoldkampForm`) er **altid synlig** (skjules ikke
  længere når der er en aktiv holdkamp).
- Bane-dropdown pr. delkamp: "optaget"-sættet beregnes på tværs af *alle*
  aktive holdkampes delkampe + aktive game states. En bane med en tildelt-men-
  ikke-startet delkamp vises som valgbar (evt. markeret "ikke startet"), i tråd
  med valg B.
- Bevar de eksisterende fixes: bane-dropdown nulstilles/lukkes ikke under
  3-sek-refresh (selectedCourts-bevarelse + `holdkampCourtSelectOpen`-fokusflag).

### 6.4 Court v3 (`frontend/court-v3.html`, `frontend/court-script-v3.js`)

- Panelet får **to dropdowns**: holdkamp (`holdkampMatchSelect`) → delkamp
  (`holdkampGameSelect`). Når en holdkamp vælges, fyldes delkamp-listen med dens
  ventende delkampe (per-kategori-nummerering, som allerede rettet). Begge
  dropdowns har fokus-pause så sync-loopet ikke lukker/blinker dem.
- "Min banes kamp" hentes via `getTeamMatchByCourt(courtId)` i:
  `initHoldkampPanel`, sync-loop og `saveMatchResult`-fallback.
- De to dropdowns fyldes via `getActiveTeamMatches()`.
- Resultatrapportering (`reportHoldkampResult`) bruger fortsat de fangede
  `teamMatchId`/`gameId` — uændret, men kilden er nu by-court i stedet for den
  globale singular.

### 6.5 Oversigt.html (`frontend/oversigt.html`, `frontend/oversigt-script.js`)

- Fjern den store rubrik `#holdkampOverview` (de kæmpe scoretal).
- Tilføj et holdkamp-grid med `grid-template-columns: 1fr 1fr` (50/50). Hver
  aktiv holdkamp = et kort: lille header (holdnavne + stilling) + dens
  delkamp-rubrikker (lidt større end i dag, live-opdaterede).
- `loadHoldkamp`: hent `active-all`, render et kort pr. holdkamp.
- **Live uden flicker:** ved refresh patches kun ændrede værdier (score, status,
  vinder) i eksisterende DOM-noder; fuld genrender kun når antallet af
  holdkampe/delkampe ændrer sig. Bevarer scroll-position.
- >2 holdkampe: grid wrapper til næste række, siden scroller.
- Genbrug den allerede rettede score-orientering (team1 på venstre side).

## 7. Implementeringsrækkefølge (uafhængige, manuelt testbare faser)

1. **Backend:** `active-all`, `by-court`, fjern auto-afslut, cross-match bane-guard.
2. **Admin:** liste over aktive holdkampe + altid-synlig opret-formular + cross-match optaget-baner.
3. **Court v3:** to-trins valg + by-court binding i init/sync/fallback.
4. **Oversigt:** 50/50-kort, live patch-opdatering, fjern stor rubrik.

Hver fase deployes lokalt og verificeres manuelt i browseren før den næste.

## 8. Manuel verificering (acceptkriterier)

- Opret 2 holdkampe samtidig på Admin; begge vises, opret-formular forbliver synlig.
- Tildel baner i begge holdkampe; forsøg at tildele en allerede-i-gang bane →
  afvises med "Bane optaget". Tildel en tildelt-men-ikke-startet bane → den gamle
  frigøres automatisk.
- På Court v3: vælg holdkamp, derefter delkamp; spil færdig; resultat lander på
  den rigtige holdkamp/delkamp. Dropdowns blinker/nulstilles ikke under refresh.
- Oversigt viser begge holdkampe side om side (50/50), opdateres live mens der
  spilles, uden at blinke eller hoppe i scroll. En 3. holdkamp får siden til at
  scrolle.
- En aktiv turnering blokerer stadig oprettelse af holdkamp (og omvendt).

## 9. Risici / opmærksomhedspunkter

- **Bane-guard kræver game-state-opslag i backend** — sørg for at bruge samme
  datakilde/definition af "i gang" som frontend, så de ikke divergerer.
- **Race:** to baner der næsten samtidig tildeles samme bane — guarden afgør på
  serversiden; sidste skriver vinder, men en i-gang-kamp beskyttes altid.
- **Bagudkompatibilitet:** behold `/active` indtil alle frontend-kald er flyttet,
  så intet går i stykker midt i en fase.
- **Cache-busting:** husk at bumpe `?v=` på ændrede JS-filer (admin-script,
  court-script-v3, oversigt-script, api.js) så tablets henter nyt.
- **Produktion (Pi):** backend-ændringer kræver `docker-compose build backend
  frontend` på Pi'en, ikke kun frontend.
