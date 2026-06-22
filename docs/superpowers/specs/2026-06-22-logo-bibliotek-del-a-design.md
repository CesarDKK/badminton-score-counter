# Design: Centralt klub-logo-bibliotek — Del A (Superadmin-styring)

**Dato:** 2026-06-22
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

Etablér et **centralt klub-logo-bibliotek** der deles på tværs af ALLE klubber på
platformen, hvor **kun Superadmin** kan tilføje, redigere og slette logoer.
Dette er **del A** af en større feature. Del B (tildeling/matching af logoer til
spillere/hold med navnevariationer + manuelle overrides) og del C (visning af
logoer ved kampene) designes hver for sig bagefter.

## 2. Afgrænsning (kun del A)

**I scope:**
- Master-DB-tabel til logoer + delt fil-lagring.
- Superadmin-only backend-CRUD (upload, list, rediger metadata, slet).
- Superadmin-frontend: "Klub-logoer"-sektion med upload + galleri + rediger/slet.

**Ikke i scope (senere specs):**
- Klub-vendt læse-API så klubber kan vælge/se logoer (del B).
- Automatisk matching mod hold-/spillernavne inkl. navnevariationer (del B).
- Manuelle overrides i "Spiller info" og turneringer (del B).
- Visning af logoer på bane/TV/oversigt (del C).

## 3. Beslutninger (truffet under brainstorm)

1. **Kun del A nu** — B og C er separate specs.
2. **Logo-data:** hvert logo har **klubnavn + aliasser/søgeord + billede**. Aliasser
   gemmes allerede nu (komma-separeret) så automatisk matching i del B bliver bedre.
3. **Billedformater:** kun raster — **PNG/WebP/JPG** (genbruger eksisterende
   upload-pipeline; ingen SVG i denne omgang).
4. **Sletning:** hård sletning (række + fil). Der er endnu ingen referencer (del B
   indfører referencer og håndtering ved sletning).
5. **Verificering:** manuel (deploy lokalt + test i Superadmin). Ingen ny test-infra.

## 4. Arkitektur-kontekst (nuværende)

- **Multi-tenant:** master-DB `badminton_master` (tabeller `super_admins`, `clubs`)
  + én DB pr. klub. Master-DB tilgås via `masterDb.query()`
  (`backend/config/masterDatabase.js`); klub-DB via tenant-scoped `query()`/`queryOne()`.
- **Superadmin-auth:** `superAdminAuth` middleware + JWT med `role: 'super_admin'`
  (`backend/middleware/superAdminAuth.js`). Ruter i `backend/routes/superAdmin.js`.
- **Sponsor-upload (genbrugsmønster):** `backend/config/multer.js` (diskStorage,
  raster-filter) + `POST /api/sponsors/upload`. Filer i delt Docker-volume
  `uploads_data` → `/app/uploads/<klub-db>/<fil>`, serveret via
  `app.use('/uploads', express.static(...))` (`backend/server.js`) og proxyet af
  nginx til **alle** subdomæner (`nginx.conf` `location ^~ /uploads/`).
- **Superadmin-frontend:** `frontend/super-admin.html` + `super-admin-script.js`,
  API-kald via `frontend/js/api.js` (fx `getSuperAdminClubs`, `createClubAdmin`).

## 5. Datamodel

Ny tabel i **master-DB** (`badminton_master`):

```
club_logos:
  id            INT PRIMARY KEY AUTO_INCREMENT
  club_name     VARCHAR(150) NOT NULL          -- fx "Lyngby"
  aliases       TEXT NULL                       -- komma-separerede søgeord, fx "Lyngby Badminton, LBK"
  filename      VARCHAR(255) NOT NULL           -- fx "central_logos/lyngby_ab12.png"
  original_name VARCHAR(255) NOT NULL
  file_path     VARCHAR(500) NOT NULL           -- disk-sti i container
  file_size     INT NOT NULL
  width         INT NULL
  height        INT NULL
  mime_type     VARCHAR(50) NOT NULL
  upload_date   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  INDEX idx_club_name (club_name)
```

Tabellen tilføjes til `backend/init.master.sql` som `CREATE TABLE IF NOT EXISTS`,
så den oprettes ved backend-opstart (samme mekanisme som de øvrige master-tabeller).
Implementeringsplanen verificerer master-init-mekanismen og tilføjer evt. et
idempotent `CREATE TABLE IF NOT EXISTS`-kald hvis init.master.sql ikke køres
automatisk ved opstart.

## 6. Lagring og servering

- Filer gemmes i **delt mappe** `/app/uploads/central_logos/` (samme
  `uploads_data`-volume — ikke pr. klub). URL: `/uploads/central_logos/<fil>`.
- Serveres via den eksisterende `/uploads/`-rute + nginx-proxy → nåbar fra alle
  klub-subdomæner, `app.*`, `admin.*` og localhost. **Ingen ændring i nginx eller
  docker-compose nødvendig.**
- Ny multer-konfiguration (separat fra sponsor-multer): fast destination
  `central_logos/` (uafhængig af `req.clubDbName`), raster-filter
  (`image/png`, `image/webp`, `image/jpeg`), filnavn med tilfældigt suffiks.

## 7. Backend — API (kun Superadmin, `superAdminAuth`)

Alle ruter i `backend/routes/superAdmin.js`, master-DB via `masterDb`:

- **`POST /api/super-admin/logos`** — multipart (`image` + `clubName` + `aliases`).
  Validér: billede påkrævet (raster), `clubName` påkrævet. Gem fil i
  `central_logos/`, indsæt række i `club_logos`. Returnér det oprettede logo
  (inkl. URL `/uploads/central_logos/<fil>`).
- **`GET /api/super-admin/logos`** — returnér alle logoer (id, club_name, aliases,
  url, original_name, upload_date), sorteret efter `club_name`.
- **`PUT /api/super-admin/logos/:id`** — opdatér `club_name` og/eller `aliases`
  (ikke selve billedet i denne omgang).
- **`DELETE /api/super-admin/logos/:id`** — slet master-række + fjern fil fra disk.

Fejlhåndtering: 400 ved manglende felter/ugyldigt format; 404 ved ukendt id;
filtype/-størrelse afvises med klar besked (genbrug eksisterende grænser:
`client_max_body_size 50M` + rimelig per-fil-grænse i multer).

## 8. Frontend — Superadmin-siden

- Ny sektion **"Klub-logoer"** i `frontend/super-admin.html` (egen fane eller blok
  i dashboardet, følg eksisterende mønster med kort/modal).
- **Upload-formular:** filvælger (billede) + felt "Klubnavn" + felt "Aliasser
  (komma-separeret, valgfri)" + Upload-knap.
- **Galleri/liste:** thumbnail + klubnavn + aliasser pr. logo, med **Rediger**
  (klubnavn/aliasser) og **Slet** pr. logo.
- Nye `api.js`-metoder: `uploadLogo(file, clubName, aliases)`, `getLogos()`,
  `updateLogo(id, clubName, aliases)`, `deleteLogo(id)`.
- Cache-bust: bump `?v=` på `super-admin.html`-referencer til ændrede JS/CSS-filer.

## 9. Manuel verificering (acceptkriterier)

- Som Superadmin: upload et logo med klubnavn + aliasser → vises i galleriet med
  thumbnail.
- Filen findes i `/app/uploads/central_logos/` og kan hentes på
  `/uploads/central_logos/<fil>` (også fra et klub-subdomæne/`app.*`).
- Rediger klubnavn/aliasser → opdateres i listen.
- Slet logo → forsvinder fra listen, og filen fjernes fra disk.
- `club_logos`-tabellen findes i master-DB efter backend-opstart.

## 10. Risici / opmærksomhedspunkter

- **Master-init:** bekræft at `init.master.sql` (eller tilsvarende) køres
  idempotent ved opstart, så `club_logos` oprettes uden manuel migration. Ellers
  tilføj et lille opstarts-`CREATE TABLE IF NOT EXISTS`.
- **Sti-traversal/filnavne:** brug tilfældige, sanerede filnavne (som sponsor-multer)
  så uploads ikke kan overskrive andre filer.
- **Multi-tenant kun:** funktionen forudsætter master-DB (multi-tenant). I ren
  direkte-mode uden master-DB er Superadmin-biblioteket ikke relevant; planen
  antager master-DB findes (som i nuværende opsætning).
- **Produktion (Pi):** backend + frontend ændres → `docker-compose build backend
  frontend && docker-compose up -d backend frontend` på Pi'en.
- **Del B-forberedelse:** `aliases` gemmes nu, så matching i del B kan bruge dem.
