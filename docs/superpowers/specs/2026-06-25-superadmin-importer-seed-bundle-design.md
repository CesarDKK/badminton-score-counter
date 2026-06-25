# Design: Importer seed-bundle i SuperAdmin

**Dato:** 2026-06-25
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

En "Importer seed-bundle"-knap ved siden af den eksisterende "Download seed-bundle"-
eksport, der indlæser en seed-bundle-zip direkte i det centrale logo-bibliotek —
billeder + aliasser opdateres **live uden deploy**. Bruges til at synkronisere/opdatere
logoer mellem instanser eller genindlæse et bundt på samme instans.

## 2. Beslutninger (truffet under brainstorm)

1. **Konflikt:** overskriv — findes klubnavnet allerede, erstattes billede + aliasser;
   nye tilføjes. Bundtet bliver det gældende snapshot.
2. **Format:** kun seed-bundle-zip i samme format som eksporten (billeder navngivet
   `<club_name>.<ext>` + `aliases.json` = `{filnavn: aliasser}`). Ingen løse billeder.
3. **Lagring:** genbrug `uploads/central_logos` + `club_logos`-upsert; importerede
   logoer får `seed_key = NULL` (behandles som manuelle uploads).
4. **Verificering:** manuel (browser). Ingen ny test-infra.

## 3. Eksisterende byggeklodser (genbruges)

- Eksport: `GET /api/super-admin/logos/seed-bundle` (adm-zip) → zip med
  `<club_name>.<ext>` + `aliases.json`.
- `club_logos` (master-DB): `club_name, aliases, filename, original_name, file_path,
  file_size, width, height, mime_type, seed_key`. Filer i `uploads/central_logos/`,
  serveret på `/uploads/<filename>`.
- `adm-zip` (allerede dependency) kan læse en zip fra buffer (`new AdmZip(buffer)`).
- `backupMulter` = `multer({ storage: memoryStorage(), limits: { fileSize: 100MB } })`
  + mønstret `router.post('/clubs/:id/restore', superAdminAuth, backupMulter.single('backup'), ...)`.
- `sharp` til billed-metadata. `fs`/`backupFs` + `backupPath` til disk-operationer.
- Frontend `doClubRestore`-mønster: skjult file-input → `fetch` med Bearer-token +
  `FormData`. `loadLogos()` / `loadMissingLogos()` til genindlæsning.

## 4. Backend — `POST /api/super-admin/logos/import-bundle`

- `superAdminAuth` + memory-multer (genbrug `backupMulter` eller tilsvarende), felt
  `bundle`, zip op til 100 MB.
- Ingen fil / forkert felt → `400`.
- `const zip = new AdmZip(req.file.buffer)` (i try/catch → `400` "Ugyldig zip" hvis det
  fejler).
- Find `aliases.json`-entry (hvis til stede), parse til `aliasesByFile = {filnavn:
  aliasser}` (ugyldig JSON → tom map, logges).
- For hver entry hvor `entry.entryName` matcher `/\.(png|jpe?g|webp)$/i`:
  - `fileName = path.basename(entry.entryName)` (path-traversal-sikring — aldrig
    entry-stien direkte).
  - `clubName = fileName uden endelse`, trimmet. Tomt → spring over (`skipped++`).
  - `aliases = aliasesByFile[fileName] || null`.
  - Skriv `entry.getData()` til `uploads/central_logos/import_<slug>_<rand><ext>`
    (`slug` = saniteret klubnavn; `rand` via `crypto.randomBytes`, samme idé som
    `logoUpload.js`).
  - `width`/`height` via `sharp(destPath).metadata()` (try/catch → null).
  - **Upsert pr. `club_name`:**
    - Findes (`SELECT id, file_path FROM club_logos WHERE club_name = ?`): `UPDATE`
      `filename, original_name, file_path, file_size, width, height, mime_type,
      aliases` for id'et → `updated++`. Slet den gamle billedfil (`fs.unlinkSync`,
      ignorér fejl) hvis den adskiller sig fra den nye.
    - Findes ikke: `INSERT` med `seed_key = NULL` → `imported++`.
  - Hver entry i egen try/catch → ved fejl `errors++` (slet evt. delvist skrevet fil),
    fortsæt med resten.
- Svar `200`: `{ imported, updated, skipped, errors }`.

## 5. Frontend — knap + flow (super-admin)

- I logo-biblioteks-kortets header (ved siden af "⬇ Seed-bundle"): knap
  **"⬆ Importer seed-bundle"** (`id="importSeedBundleBtn"`).
- Skjult `<input type="file" accept=".zip,application/zip">` (oprettes i script, som
  `_restoreInput`-mønstret) — eller statisk i HTML.
- Ved fil-valg: `confirm('Importerer logoer fra bundle. Eksisterende klubber med samme
  navn FÅR overskrevet billede og aliasser. Fortsæt?')`. Ved OK: `POST` med `FormData`
  (`bundle`) + Bearer-token (`doClubRestore`-mønster).
- Efter svar: vis kort status (fx "✓ 12 nye, 5 opdateret, 0 sprunget over, 0 fejl") og
  kald `loadLogos()` + `loadMissingLogos()`.
- Fejl (`!res.ok`): vis fejlbesked.

## 6. Lagring / model

Genbruger `uploads/central_logos` + `club_logos` uændret. `seed_key = NULL` for
importerede logoer, så den fil-baserede opstarts-seeder (`seedLogos.js`) ikke rører dem
(den springer over på eksisterende `club_name`). Volumet persisterer → importen
overlever genstart. Ingen ændring i `seedLogos.js`.

## 7. Afgrænsning

Kun `backend/routes/superAdmin.js`, `frontend/super-admin.html`,
`frontend/super-admin-script.js`. Ingen ny dependency. Ingen ændring på seeder,
TV/Oversigt/admin/Court. Importerer kun centrale klub-logoer — ikke `player_logos`-
overrides eller per-hold `team_logo_id` (tenant-data, uden for scope, som ved eksport).

## 8. Fejl / edge-cases

- **Ikke en gyldig/korrupt zip** → `400`, intet ændret.
- **Entry uden billed-endelse** (inkl. `aliases.json`, skjulte filer) → springes over.
- **Tomt `club_name`** → `skipped++`.
- **`aliases.json` mangler** → alle importeres med `aliases = null`.
- **Billede kan ikke skrives / `sharp` fejler** → `errors++`, ryd op, fortsæt.
- **Path-traversal i entrynavne** → kun `path.basename(entryName)` bruges.
- **Dublet-klubnavne i samme zip** → behandles sekventielt; sidste vinder (sidste
  overskriver). Acceptabelt (eksporten producerer unikke navne).

## 9. Manuel verificering (acceptkriterier)

- Eksportér bundle → slet et logo i biblioteket → importér samme bundle → logoet er
  tilbage (inkl. aliasser) og auto-matcher på TV/Oversigt.
- Importér et bundle hvor en klub allerede findes → billede + aliasser overskrives, og
  den gamle fil er væk fra disk.
- Importér en ny klub der ikke fandtes → tilføjet med `seed_key = NULL`.
- Importér en ikke-zip / korrupt fil → pæn `400`-fejl, biblioteket uændret.
- Efter import → "Klubber uden logo"-listen og logo-listen er opdateret.
- Genstart backend efter import → de importerede logoer består (volume), og seederen
  rører dem ikke (samme `club_name`).

## 10. Risici / opmærksomhedspunkter

- **Destruktivt ved overskriv:** import erstatter billeder/aliasser for matchende
  klubnavne → derfor frontend-bekræftelse før upload.
- **Stor zip i memory:** 100 MB-grænse; et logo-bundt er få MB i praksis → ok.
- **Produktion (Pi):** kun backend + frontend ændres →
  `docker-compose build backend frontend && docker-compose up -d backend frontend`.
- **Forholdet til seed-mappen:** import ≠ seed-mappen. Vil man have logoerne med i
  *image-bygget* (fx helt friske instanser uden det persisterede volume), bruges stadig
  eksport → læg i `backend/assets/seed_logos/` → commit. Import er til live-opdatering
  af en kørende instans.
