# Design: SuperAdmin — manglende klub-logoer + seed-eksport

**Dato:** 2026-06-24
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

Giv SuperAdmin ét sted hvor alle kendte klubnavne **uden auto-matchet logo** vises,
så logoer kan uploades/tildeles samlet i stedet for at jagte dem pr. turnering. Og en
**eksport** af hele det centrale logo-bibliotek (inkl. aliasser) som et seed-bundt, så
det manuelle arbejde kun gøres én gang og overlever fremtidige deploys.

## 2. Beslutninger (truffet under brainstorm)

1. **Kilde til navne:** alle kendte navne — `tournament_player_clubs.club`,
   `team_matches.team1_name`/`team2_name`, og `player_info.club` — på tværs af alle
   aktive klubber (tenants).
2. **Tildel-flow:** begge dele — upload nyt logo (klubnavn forudfyldt) ELLER knyt
   klubben til et eksisterende logo som alias.
3. **Eksport:** download-bundle som ægte `.zip` (billeder + `aliases.json`) via ny
   ren-JS-dependency `adm-zip`. Seederen udvides til at læse aliasser fra manifesten.
4. **Verificering:** manuel (browser + curl). Ingen ny test-infra.

## 3. Eksisterende byggeklodser (genbruges)

- Centralt bibliotek `club_logos` (master-DB) + SuperAdmin-CRUD:
  - `POST /api/super-admin/logos` (clubName + aliases + image, `logoUpload.js`)
  - `GET /api/super-admin/logos`, `PUT /api/super-admin/logos/:id` (clubName + aliases),
    `DELETE /api/super-admin/logos/:id`.
- Tenant-adgang: `masterDb.query('SELECT ... FROM clubs')` + `clubConn(db_name)`
  (samme mønster som backup-endpointet i `superAdmin.js`).
- `window.LogoMatch.matchLogo(name, logos)` (frontend) afgør auto-match.
- Seed: `backend/assets/seed_logos/*` seedes idempotent ved opstart af
  `backend/config/seedLogos.js` (png/jpg/jpeg/webp; skip på `seed_key`/`club_name`).
- Super-admin-frontend (`super-admin.html` + `super-admin-script.js`) har allerede en
  logo-sektion (`loadLogos`/`renderLogos`/`handleUploadLogo`, `api.getLogos`).

## 4. "Manglende logo"-liste

### 4.1 Backend — `GET /api/super-admin/known-club-names`
- `superAdminAuth`-beskyttet.
- Henter alle aktive klubber: `SELECT db_name FROM clubs WHERE is_active = 1`.
- For hver klub, via `clubConn(db_name)`, hent distinkte navne fra tre kilder (hver i
  egen try/catch — en manglende tabel/utilgængelig tenant springes over, logges):
  - `SELECT DISTINCT club AS name FROM tournament_player_clubs` → kilde `turnering`
  - `SELECT DISTINCT team1_name AS name FROM team_matches` +
    `SELECT DISTINCT team2_name AS name FROM team_matches` → kilde `holdkamp`
  - `SELECT DISTINCT club AS name FROM player_info` → kilde `spiller`
- Aggregér på tværs af tenants til en map nøglet på **trimmet navn** (case-bevarende):
  `{ name, sources: Set, count }` hvor `count` øges pr. forekomst (tenant×kilde).
- Returnér `[{ name, sources: ["turnering","holdkamp","spiller"], count }]` sorteret
  efter `count` faldende. Tomme/whitespace-navne og `'?'` udelades.
- Tenant-queries køres parallelt (`Promise.all` over klubberne).

### 4.2 Frontend — filtrering + visning (super-admin)
- Ny sektion "Klubber uden logo" på SuperAdmin-siden.
- Henter parallelt: `api.getKnownClubNames()` + `api.getLogos()` (begge findes/ny).
- Filtrér til navne hvor `window.LogoMatch.matchLogo(name, logos) === null`
  (matching-logik ikke duplikeret i backend).
- Render hver række: klubnavn, kilde-tags (turnering/holdkamp/spiller), `count`, og to
  knapper: **Upload logo** og **Knyt til eksisterende**.
- Tom liste → "Alle kendte klubber har et logo 🎉".
- `super-admin.html` indlæser i dag IKKE `js/logo-match.js` (bekræftet) → det tilføjes
  før `super-admin-script.js`, så `window.LogoMatch.matchLogo` er tilgængelig til
  frontend-filtreringen.

## 5. Tildel-flow (pr. række)

- **Upload nyt:** åbner det eksisterende upload-UI med `clubName` forudfyldt til
  rækkens navn → `POST /api/super-admin/logos` (uændret). Efter succes: genindlæs både
  logo-listen og "mangler"-listen.
- **Knyt til eksisterende:** en dropdown med alle bibliotekslogoer. Ved valg henter
  frontend logoets nuværende `aliases`, tilføjer rækkens klubnavn (kommasepareret, undgå
  dublet), og kalder `PUT /api/super-admin/logos/:id` med uændret `clubName` + ny
  `aliases`. Efter succes: genindlæs begge lister.
- Begge handlinger fjerner klubben fra "mangler"-listen (den auto-matcher nu).

## 6. Eksport-bundt

### 6.1 Backend — `GET /api/super-admin/logos/seed-bundle`
- `superAdminAuth`-beskyttet. Ny dependency: `adm-zip` (ren JS, ingen native build).
- Hent alle `club_logos` (`club_name, aliases, filename, file_path`).
- Byg en `AdmZip` i hukommelsen:
  - For hvert logo: tilføj billedfilen under navnet `<saniteret-unikt-klubnavn><ext>`
    (`ext` fra `filename`). Filer der mangler på disk udelades (logges).
  - Navnekollision (samme klubnavn): suffiks `_2`, `_3`, … på filnavnet.
  - Tilføj `aliases.json` = `{ "<brugt-filnavn>": "<aliases>", ... }` for de logoer der
    har aliasser (nøgle = det filnavn der blev brugt i zip'en).
- Send `zip.toBuffer()` med
  `Content-Type: application/zip` og
  `Content-Disposition: attachment; filename="seed_logos_bundle.zip"`.

### 6.2 Brug
SuperAdmin → "Download seed-bundle" → udpak zip-indholdet ind i
`backend/assets/seed_logos/` (overskriv) → commit → næste deploy seeder alt inkl.
aliasser. Bundtet afspejler hele biblioteket, så det er det samlede sandheds-snapshot.

## 7. Seeder udvides til aliasser

`backend/config/seedLogos.js`:
- Ved start af `seedClubLogos()` indlæses `backend/assets/seed_logos/aliases.json` (hvis
  den findes) én gang til en `aliasesByFile`-map. Fejl/ugyldig JSON → tom map (logges).
- Fil-filteret skal **ignorere** `aliases.json` (kun billedfiler seedes — filteret er
  allerede `/\.(png|jpe?g|webp)$/i`, så JSON udelades automatisk).
- Ved `INSERT` sættes `aliases` = `aliasesByFile[file] || null` (i stedet for altid
  `null`).
- Eksisterende skip-regler (`seed_key`/`club_name`) uændrede → re-sync stadig idempotent.
  Aliasser anvendes kun ved nyt `INSERT` (på en frisk instans); på eksisterende instans
  bevares admins DB-aliasser.

## 8. Flader / afgrænsning

Kun `backend/routes/superAdmin.js`, `backend/config/seedLogos.js`,
`backend/package.json` (+ `adm-zip`), `frontend/super-admin.html`,
`frontend/super-admin-script.js`, `frontend/js/api.js` (nye klient-metoder). Ingen
ændring på TV/Oversigt/admin/Court.

## 9. Fejl / edge-cases

- **Tenant-DB utilgængelig / mangler tabel** (fx ældre klub uden
  `tournament_player_clubs`) → den kilde/tenant springes over (try/catch pr. query),
  resten bygger listen.
- **Navn der auto-matcher** → vises ikke (frontend-filter).
- **Logo-fil mangler på disk ved eksport** → udelades fra zip, logges.
- **Tomt bibliotek** → zip med kun (tom) `aliases.json`.
- **`aliases.json` med filnavn der ikke seedes** → ignoreres af seederen.
- **Navnekollision i zip** → `_2`-suffiks + matchende manifest-nøgle.
- **Dublet-alias** ved "knyt til eksisterende" → frontend tilføjer kun hvis ikke
  allerede til stede.

## 10. Manuel verificering (acceptkriterier)

- Importér turnering med klubber uden bibliotekslogo → de fremgår af SuperAdmin-listen
  "Klubber uden logo"; auto-matchede klubber vises IKKE.
- Upload nyt logo for en klub i listen → den forsvinder fra listen og vises på
  TV/Oversigt.
- Knyt en klubvariant til et eksisterende logo (alias) → den forsvinder fra listen.
- "Download seed-bundle" → zip indeholder `<klub>.<ext>`-filer + `aliases.json` med de
  satte aliasser.
- Udpak bundtet i `backend/assets/seed_logos/`, kør mod en frisk DB/genstart → logoerne
  seedes med korrekte aliasser (verificér via `GET /api/logos`).
- En klub knyttet via alias i bundtet auto-matcher efter seed på frisk instans.

## 11. Risici / opmærksomhedspunkter

- **Cross-tenant-iteration** kan tage tid ved mange klubber → parallel (`Promise.all`).
  SuperAdmin-handling (sjælden) → acceptabelt.
- **`adm-zip`** ny dependency → installeres ved `docker-compose build backend`.
- **Seed-scope:** kun `club_name` + `aliases` + billede bæres med. `player_logos`-
  overrides og per-hold `team_logo_id` er tenant-data og er bevidst uden for seed-scope.
- **Produktion (Pi):** backend + frontend ændres →
  `docker-compose build backend frontend && docker-compose up -d backend frontend`.
