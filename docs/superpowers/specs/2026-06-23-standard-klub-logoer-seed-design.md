# Design: Standard klub-logoer (seed ved opstart)

**Dato:** 2026-06-23
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

Medlevér et fast sæt klub-logoer som standard-del af løsningen, så de ikke skal
uploades manuelt hver gang en ny instans deployes. Bygger oven på det eksisterende
centrale logo-bibliotek (`club_logos` i master-DB, Superadmin-CRUD, `GET /api/logos`,
filer i `uploads/central_logos/`, matching via `window.LogoMatch`).

Brugerens kilde-mappe (lokal, **iCloudDrive — upålidelig, må ikke læses ved deploy**):
`E:\iCloudDrive\iCloudDrive\Badminton\BadmintonApp\Logo\Logo` — pt. 63 PNG-filer.

## 2. Beslutninger (truffet under brainstorm)

1. **Tilgang A:** bundtede filer i repoet + idempotent seeder ved opstart. (Fravalgt:
   BLOB-i-DB og scan-mappe-ved-request — begge ændrer lagrings/serverings-modellen
   uden gevinst.)
2. **Re-sync hver opstart:** manglende standard-logoer gen-indsættes ved hver opstart.
   En Superadmin kan ikke permanent slette en standard-logo (den kommer igen ved næste
   deploy). Konsekvens: det bundtede sæt er reelt permanent.
3. **Filudvalg:** alle filer bundtes; byte-identiske dubletter slås sammen. **Efter
   hashing findes ingen byte-identiske dubletter** blandt de 63 aktuelle filer → alle
   63 bliver hver sin logo. Navne-varianter der kunne være samme klub (fx
   `Odense OBK` + `RSL ODENSE OBK`, `Hvidovre` + `Hvidovre HB2000`) er ikke identiske
   billeder og lades stå som separate; Superadmin kan tilføje alias bagefter.
4. **Verificering:** manuel (curl + browser). Ingen ny test-infra.

## 3. Eksisterende lagrings-model (uændret)

- Tabel `club_logos` (master-DB): `id, club_name, aliases, filename, original_name,
  file_path, file_size, width, height, mime_type, upload_date`.
- Filer på disk i `uploads/central_logos/` (Docker named volume `uploads_data`,
  persisterer på tværs af rebuilds; tom på en fresh instans).
- `filename` gemmes som `central_logos/<fil>`; serveres statisk på
  `/uploads/<filename>` (server.js: `app.use('/uploads', express.static(...))`).
- `GET /api/logos` (public) returnerer `{ id, club_name, aliases, width, height,
  url: '/uploads/'+filename }`.
- Opstart: `masterDb.initialize()` (server.js:176) opretter `club_logos` idempotent.

## 4. Bundtede seed-filer

- Ny mappe: `backend/assets/seed_logos/` med de 63 PNG'er kopieret fra iCloud-mappen,
  committet til git.
- Ligger i backend-byggekonteksten (`COPY backend/ ./` → `/app/assets/seed_logos/`),
  altså **uden for** `uploads`-volumet, så de altid følger med imaget.
- Ved kopiering verificeres at hver fil er reel (filstørrelse > 0, ikke en
  af-materialiseret iCloud-stub).

## 5. Schema-ændring (master-DB)

Tilføj én kolonne på `club_logos`:

```
seed_key VARCHAR(255) NULL UNIQUE
```

- Tilføjes **idempotent** i `masterDatabase.initialize()`: tjek
  `information_schema.columns` for `badminton_master.club_logos.seed_key`; hvis den
  mangler, kør `ALTER TABLE club_logos ADD COLUMN seed_key VARCHAR(255) NULL UNIQUE`.
  Samme placering/mønster som den eksisterende `CREATE TABLE IF NOT EXISTS club_logos`.
- Manuelt uploadede logoer har `seed_key = NULL`. Seedede logoer har kildefilnavnet
  som nøgle (fx `Lyngby.png`).
- Rationale: `seed_key` er den stabile identitet for en standard-logo, uafhængigt af
  `club_name` (som Superadmin kan omdøbe). Det muliggør re-sync uden dubletter.

## 6. Seeder-modul `backend/config/seedLogos.js`

Eksporterer `async function seedClubLogos()`.

Pseudokode:

```
const SEED_DIR = path.join(__dirname, '..', 'assets', 'seed_logos');
const baseUploadDir = process.env.UPLOAD_DIR || './uploads';
const logoDir = path.join(baseUploadDir, 'central_logos');

hvis SEED_DIR ikke findes -> log advarsel, return (ingen crash)
mkdir -p logoDir

for hver fil i SEED_DIR der matcher /\.png$/i:
  clubName = basename uden '.png', trimmet, whitespace kollapset
  seedKey  = filnavnet (fx 'Lyngby.png')

  hvis findes club_logos-række med seed_key = seedKey   -> skip (re-sync bevarer)
  hvis findes club_logos-række med club_name = clubName  -> skip (undgå dublet mod manuelt upload)

  slug = clubName.replace(/[^a-zA-Z0-9]/g,'_').substring(0,50)
  storedName = `seed_${slug}.png`
  destPath   = path.join(logoDir, storedName)
  copyFileSync(srcPath, destPath)                       (overskriver hvis findes)

  width/height = via sharp(destPath).metadata()         (try/catch; null hvis fejl)
  fileSize = statSync(destPath).size

  INSERT INTO club_logos
    (club_name, aliases, filename, original_name, file_path, file_size,
     width, height, mime_type, seed_key)
  VALUES
    (clubName, NULL, `central_logos/${storedName}`, filnavn, destPath, fileSize,
     width, height, 'image/png', seedKey)

  hver fil i egen try/catch -> én dårlig fil stopper ikke resten
log: "Seedede X klub-logoer (Y sprunget over)"
```

Detaljer:
- `sharp` er allerede en dependency (bruges i `routes/superAdmin.js`).
- Metadata er valgfri: hvis `sharp` fejler, indsættes `width/height = NULL` (samme
  tolerance som den eksisterende upload-rute).
- Skrivning sker i `uploads/central_logos/` (volumet), så filerne persisterer og
  serveres uændret via `/uploads/...`.

## 7. Tilkobling

`seedClubLogos()` kaldes til sidst i `masterDb.initialize()`, efter `club_logos`-tabel
og `seed_key`-kolonne er sikret. Hele kaldet wrappes i try/catch og logges; en
seed-fejl er **ikke** fatal for serverens opstart.

## 8. Idempotens / re-sync-semantik

- `seed_key UNIQUE` + skip-på-seed_key → ingen dublet-seed ved gentagne opstarter.
- Slettet seed-række → `seed_key` ikke fundet → gen-indsættes ved næste opstart; filen
  kopieres igen hvis den mangler i volumet.
- Admin omdøber/redigerer/tilføjer alias på en seed-række → bevares (matches på
  `seed_key` og springes over).
- Eksisterende manuelt upload med samme `club_name` → ikke dubleret (`club_name`-guard).

## 9. Visning / downstream — ingen ændring

`GET /api/logos` returnerer de seedede rækker; Oversigt-kort, TV og `matchLogo` samler
dem op uændret (fx holdnavn "Lyngby 1" → `club_name` "Lyngby"). Ingen frontend-ændring.

## 10. Fejl / edge-cases

- **Seed-mappe mangler** (fx hvis assets ikke kom med) → log advarsel, spring seed over,
  serveren starter normalt.
- **Korrupt/ulæselig PNG** → `sharp` fejler → indsæt med `width/height = NULL`.
- **Stored fil findes allerede** i volumet → `copyFileSync` overskriver (uskadeligt).
- **DB utilgængelig under seed** → fanges af try/catch i tilkoblingen; opstart fortsætter.
- **0-byte iCloud-stub kom med i repoet** → forebygges ved at verificere filstørrelse
  under kopiering (trin i implementeringsplanen), ikke ved runtime.

## 11. Deploy & manuel verificering (acceptkriterier)

Deploy: `docker-compose build backend && docker-compose up -d backend`.

- **Fresh instans** (tomt `uploads`-volume): efter opstart returnerer
  `curl -s http://localhost/api/logos` ~63 logoer, og billederne loader på deres
  `url`-stier.
- **Eksisterende instans:** kun manglende standard-logoer indsættes; allerede
  uploadede (samme `club_name`) dubleres ikke.
- **Idempotens:** genstart backend to gange → antal logoer er stabilt (ingen dubletter).
- **Re-sync:** slet en standard-logo via Superadmin → genstart backend → logoet er der
  igen.
- **Bevaring:** omdøb en standard-logo via Superadmin → genstart → det nye navn består.
- **Visning:** en holdkamp med klubber der matcher seedede navne viser logoerne på
  Oversigt og TV (fra logo del C).

## 12. Risici / opmærksomhedspunkter

- **Permanent sæt:** pga. re-sync er det bundtede sæt reelt permanent (kan ikke slettes
  varigt). Bevidst valgt.
- **Image-størrelse:** 63 PNG'er (~0,1–1,3 MB stk.) bages ind i backend-imaget. Samlet
  beskedent; ingen runtime-omkostning ud over engangs-kopiering ved seed.
- **iCloud-kilde:** filerne kopieres ind i repoet én gang (commit); seederen læser
  aldrig fra iCloud-stien.
- **Klubnavne verbatim fra filnavn:** enkelte filnavne er uregelmæssige (fx
  "KBK Kbh.", "6. kr. Ny Vest", "abc Aalborg"). De seedes som-de-er; Superadmin kan
  omdøbe, og ændringen består (re-sync rører kun manglende rækker).
