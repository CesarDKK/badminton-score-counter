# Standard klub-logoer (seed ved opstart) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medlevér 63 klub-logoer som standard, så de seedes automatisk ind i det centrale logo-bibliotek ved opstart i stedet for at skulle uploades manuelt på hver ny instans.

**Architecture:** Tilgang A — PNG-filerne bundtes i repoet (`backend/assets/seed_logos/`, bages ind i backend-imaget, uden for `uploads`-volumet). Ved opstart kører en idempotent seeder (`backend/config/seedLogos.js`) der kopierer manglende filer til `uploads/central_logos/` og indsætter `club_logos`-rækker i master-DB. Identitet/idempotens via en ny kolonne `seed_key`.

**Tech Stack:** Node.js (CommonJS), MySQL (`mysql2/promise`), `sharp` (billed-metadata), Docker Compose. Ingen test-framework i repoet → al verificering er manuel (curl + genstart + browser).

## Global Constraints

- **Re-sync hver opstart:** manglende standard-logoer gen-indsættes ved hver opstart; en slettet standard-logo kommer igen. Det bundtede sæt er reelt permanent.
- **`seed_key` er stabil identitet** = kildefilnavnet (fx `Lyngby.png`). Manuelt uploadede logoer har `seed_key = NULL`.
- **Skip-regler ved seed:** spring over hvis en række med samme `seed_key` findes (bevarer admins redigeringer) ELLER hvis en række med samme `club_name` findes (undgå dublet mod manuelt upload).
- **Idempotens:** gentagne opstarter må ikke skabe dubletter.
- **iCloud-kilden må ALDRIG læses ved runtime/deploy** — filerne kopieres ind i repoet én gang og committes; seederen læser kun fra `backend/assets/seed_logos/`.
- **Lagring uændret:** filer i `uploads/central_logos/`, `filename` gemmes som `central_logos/<fil>`, serveres på `/uploads/<filename>`.
- **PowerShell here-string-commits:** ingen `"` i commit-beskeder (brug `@'...'@`).
- **Commit-footer:** afslut commit-beskeder med `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** alt arbejde på feature-branch `seed-logoer`; merge til `main` til sidst. Checkpoint efter hver task.

## File Structure

- `backend/assets/seed_logos/*.png` — **Create.** De 63 bundtede kilde-PNG'er (committet til git).
- `backend/config/masterDatabase.js` — **Modify.** Tilføj idempotent `seed_key`-kolonne i `initialize()`; kald `seedClubLogos()` til sidst i `initialize()`.
- `backend/config/seedLogos.js` — **Create.** `seedClubLogos()`: læser seed-mappen, springer over eksisterende, kopierer fil + indsætter række.

---

## Task 0: Opret feature-branch

**Files:** ingen (kun git).

- [ ] **Step 1: Sørg for rent træ på main**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: ingen output fra `git status --short` (rent træ), branch = `main`.

- [ ] **Step 2: Opret og skift til branch**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && git checkout -b seed-logoer
```
Expected: `Switched to a new branch 'seed-logoer'`.

---

## Task 1: Bundt seed-filerne i repoet

**Files:**
- Create: `backend/assets/seed_logos/*.png` (63 filer)

**Interfaces:**
- Produces: mappen `backend/assets/seed_logos/` med PNG-filer hvis navne (uden `.png`) er klubnavnene. Task 3's seeder læser herfra via `path.join(__dirname, '..', 'assets', 'seed_logos')`.

- [ ] **Step 1: Opret målmappen**

Run:
```bash
mkdir -p /c/Users/jespe/.local/bin/badminton-app/backend/assets/seed_logos
```
Expected: ingen fejl.

- [ ] **Step 2: Kopiér PNG'erne fra iCloud-kilden**

Run:
```bash
cp "/e/iCloudDrive/iCloudDrive/Badminton/BadmintonApp/Logo/Logo/"*.png \
   /c/Users/jespe/.local/bin/badminton-app/backend/assets/seed_logos/
echo "exit=$?"
```
Expected: `exit=0`.

- [ ] **Step 3: Verificér antal og at ingen fil er 0-byte (iCloud-stub)**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app/backend/assets/seed_logos
echo "antal: $(ls -1 *.png | wc -l)"
echo "tomme filer:"; find . -name '*.png' -size 0 -print
```
Expected: `antal: 63` (eller det aktuelle antal i kilden), og INGEN linjer under "tomme filer". Hvis en fil er 0-byte: åbn den i iCloud så den materialiseres, og gentag Step 2 for den fil. Bemærk det faktiske antal — det bruges som forventet tal i Task 5's verificering.

- [ ] **Step 4: Bekræft at git vil spore filerne (ikke ignoreret)**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && git check-ignore backend/assets/seed_logos/Lyngby.png; echo "ignore-exit=$?"
```
Expected: `ignore-exit=1` (filen er IKKE ignoreret; `git check-ignore` returnerer 1 når intet matcher). Ingen sti udskrives.

- [ ] **Step 5: Commit**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && git add backend/assets/seed_logos/ && git commit -m @'
Seed-logoer: bundt 63 klub-logo-PNG i backend/assets/seed_logos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
Expected: commit oprettet med ~63 nye filer.

> **PowerShell-note:** kør commit-kommandoen i PowerShell-værktøjet med here-string (`@'...'@`), ikke i bash, for at undgå citationstegns-problemer. `git add` kan køres i begge.

**Checkpoint:** stop og lad brugeren bekræfte før Task 2.

---

## Task 2: Tilføj `seed_key`-kolonne idempotent

**Files:**
- Modify: `backend/config/masterDatabase.js:64-80` (efter `CREATE TABLE IF NOT EXISTS club_logos`-blokken)

**Interfaces:**
- Consumes: den eksisterende `query()`-funktion i samme fil.
- Produces: kolonnen `club_logos.seed_key VARCHAR(255) NULL UNIQUE` i `badminton_master`. Task 3's seeder læser/skriver denne kolonne.

- [ ] **Step 1: Indsæt idempotent ALTER efter CREATE TABLE**

I `backend/config/masterDatabase.js`, find slutningen af `CREATE TABLE IF NOT EXISTS club_logos (...)`-kaldet (linje ~80, lige efter `` ` ``-afslutningen og `);`). Indsæt følgende blok umiddelbart efter (før `console.log('✓ Master database forbindelse OK');`):

```javascript
        // seed_key: stabil identitet for standard-seedede logoer (kildefilnavn).
        // Manuelt uploadede logoer har NULL. Tilfoejes idempotent saa eksisterende
        // master-DB ogsaa faar kolonnen. Bruges af seedClubLogos() til re-sync uden dubletter.
        const seedKeyCol = await query(
            `SELECT COUNT(*) AS c FROM information_schema.columns
             WHERE table_schema = 'badminton_master'
               AND table_name = 'club_logos'
               AND column_name = 'seed_key'`
        );
        if (seedKeyCol[0].c === 0) {
            await query(
                `ALTER TABLE club_logos ADD COLUMN seed_key VARCHAR(255) NULL UNIQUE`
            );
            console.log('✓ club_logos.seed_key kolonne tilfoejet');
        }
```

- [ ] **Step 2: Syntakstjek**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && node -c backend/config/masterDatabase.js && echo "OK"
```
Expected: `OK` (ingen syntaksfejl).

- [ ] **Step 3: Commit**

Kør i PowerShell:
```
git add backend/config/masterDatabase.js
git commit -m @'
Seed-logoer: tilfoej idempotent seed_key-kolonne paa club_logos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
Expected: commit oprettet.

**Checkpoint:** stop og lad brugeren bekræfte før Task 3.

---

## Task 3: Seeder-modul `seedLogos.js`

**Files:**
- Create: `backend/config/seedLogos.js`

**Interfaces:**
- Consumes: `query`, `queryOne` fra `./masterDatabase` (kræves at `seed_key`-kolonnen fra Task 2 findes); `sharp`; `central_logos`-mappen under `process.env.UPLOAD_DIR || './uploads'`.
- Produces: `module.exports = { seedClubLogos }` hvor `async function seedClubLogos()` er idempotent og returnerer `{ seeded, skipped }`. Task 4 kalder denne.

- [ ] **Step 1: Opret filen med seederen**

Opret `backend/config/seedLogos.js` med præcis dette indhold:

```javascript
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query, queryOne } = require('./masterDatabase');

// Mappen med bundtede standard-logoer (bages ind i imaget via COPY backend/ ./)
const SEED_DIR = path.join(__dirname, '..', 'assets', 'seed_logos');
// Samme placering som logoUpload.js skriver til (Docker uploads-volume)
const baseUploadDir = process.env.UPLOAD_DIR || './uploads';
const logoDir = path.join(baseUploadDir, 'central_logos');

// Seeder standard klub-logoer idempotent. Re-sync: manglende logoer gen-indsaettes
// ved hver opstart. Springer over hvis seed_key allerede findes (bevarer admins
// redigeringer) eller hvis club_name allerede findes (undgaar dublet mod manuelt upload).
async function seedClubLogos() {
    if (!fs.existsSync(SEED_DIR)) {
        console.warn('⚠ Seed-mappe ikke fundet, springer logo-seed over:', SEED_DIR);
        return { seeded: 0, skipped: 0 };
    }
    if (!fs.existsSync(logoDir)) {
        fs.mkdirSync(logoDir, { recursive: true });
    }

    const files = fs.readdirSync(SEED_DIR).filter(f => /\.png$/i.test(f));
    let seeded = 0, skipped = 0;

    for (const file of files) {
        try {
            const clubName = path.basename(file, path.extname(file))
                .replace(/\s+/g, ' ')
                .trim();
            const seedKey = file;

            // Allerede seeded (evt. redigeret af admin) -> bevar
            const bySeed = await queryOne(
                'SELECT id FROM club_logos WHERE seed_key = ?', [seedKey]
            );
            if (bySeed) { skipped++; continue; }

            // Manuelt upload med samme navn -> undgaa dublet
            const byName = await queryOne(
                'SELECT id FROM club_logos WHERE club_name = ?', [clubName]
            );
            if (byName) { skipped++; continue; }

            const slug = clubName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
            const storedName = `seed_${slug}.png`;
            const srcPath = path.join(SEED_DIR, file);
            const destPath = path.join(logoDir, storedName);
            fs.copyFileSync(srcPath, destPath);

            let width = null, height = null;
            try {
                const meta = await sharp(destPath).metadata();
                width = meta.width || null;
                height = meta.height || null;
            } catch (e) { /* metadata valgfri */ }

            const fileSize = fs.statSync(destPath).size;

            await query(
                `INSERT INTO club_logos
                 (club_name, aliases, filename, original_name, file_path, file_size,
                  width, height, mime_type, seed_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [clubName, null, `central_logos/${storedName}`, file, destPath,
                 fileSize, width, height, 'image/png', seedKey]
            );
            seeded++;
        } catch (e) {
            console.error(`✗ Kunne ikke seede logo "${file}":`, e.message);
        }
    }

    console.log(`✓ Logo-seed: ${seeded} tilfoejet, ${skipped} sprunget over (${files.length} filer)`);
    return { seeded, skipped };
}

module.exports = { seedClubLogos };
```

- [ ] **Step 2: Syntakstjek**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && node -c backend/config/seedLogos.js && echo "OK"
```
Expected: `OK`.

- [ ] **Step 3: Commit**

Kør i PowerShell:
```
git add backend/config/seedLogos.js
git commit -m @'
Seed-logoer: seedClubLogos() der idempotent seeder bundtede logoer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
Expected: commit oprettet.

**Checkpoint:** stop og lad brugeren bekræfte før Task 4.

---

## Task 4: Tilkobl seederen i opstarten

**Files:**
- Modify: `backend/config/masterDatabase.js` (i `initialize()`, lige før den afsluttende `console.log('✓ Master database forbindelse OK');`)

**Interfaces:**
- Consumes: `seedClubLogos` fra `./seedLogos` (Task 3). Kræves lazy-required for at undgaa cirkulær import (seedLogos kraever masterDatabase ved load).

- [ ] **Step 1: Indsæt kaldet til seederen**

I `backend/config/masterDatabase.js`, i `initialize()`, umiddelbart efter `seed_key`-blokken fra Task 2 og **før** `console.log('✓ Master database forbindelse OK');`, indsæt:

```javascript
        // Seed standard klub-logoer (idempotent). Lazy require for at undgaa
        // cirkulaer afhaengighed (seedLogos kraever dette modul ved load).
        try {
            const { seedClubLogos } = require('./seedLogos');
            await seedClubLogos();
        } catch (e) {
            console.error('✗ Logo-seed fejlede (opstart fortsaetter):', e.message);
        }
```

- [ ] **Step 2: Syntakstjek**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && node -c backend/config/masterDatabase.js && echo "OK"
```
Expected: `OK`.

- [ ] **Step 3: Commit**

Kør i PowerShell:
```
git add backend/config/masterDatabase.js
git commit -m @'
Seed-logoer: kald seedClubLogos() ved master-DB initialisering

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
Expected: commit oprettet.

**Checkpoint:** stop og lad brugeren bekræfte før Task 5.

---

## Task 5: Deploy og verificér (manuelt)

**Files:** ingen kodeændringer; deploy + verificering.

- [ ] **Step 1: Byg og genstart backend**

Kør i PowerShell:
```
docker-compose build backend
docker-compose up -d backend
```
Expected: image bygget, container genstartet.

- [ ] **Step 2: Tjek seed-loggen ved opstart**

Run:
```bash
docker logs badminton-backend --tail 20
```
Expected: en linje a la `✓ Logo-seed: N tilfoejet, M sprunget over (63 filer)`. På en instans der allerede har kørt logo-funktionen kan `tilfoejet` være lavt og `sprunget over` højt — det er forventet (kun manglende seedes).

- [ ] **Step 3: Verificér via API**

Run:
```bash
curl -s http://localhost/api/logos | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('antal logoer:',a.length);console.log('eksempel:',JSON.stringify(a.find(x=>x.club_name==='Lyngby')||a[0]));})"
```
Expected: `antal logoer:` ≥ det antal filer fra Task 1 Step 3, og eksemplet har en `url` der starter med `/uploads/central_logos/seed_`.

- [ ] **Step 4: Verificér at et billede faktisk serveres**

Run:
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" "http://localhost/uploads/central_logos/seed_Lyngby.png"
```
Expected: `200 image/png`.

- [ ] **Step 5: Verificér idempotens (genstart 2x)**

Run:
```bash
curl -s http://localhost/api/logos | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('foer:',JSON.parse(d).length))"
```
Kør derefter i PowerShell:
```
docker-compose restart backend
```
Vent til containeren er oppe (tjek `docker logs badminton-backend --tail 5` viser opstart fuldført), kør så igen i bash:
```bash
curl -s http://localhost/api/logos | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('efter:',JSON.parse(d).length))"
```
Expected: `foer:` og `efter:` er **samme tal** (ingen dubletter ved genstart).

- [ ] **Step 6: (Valgfri) verificér re-sync**

Slet en standard-logo via Superadmin-UI'et (eller noter at dette er en manuel browser-test), genstart backend, og bekræft at logoet er tilbage i `GET /api/logos`. Dette demonstrerer "re-sync hver opstart". Spring over hvis brugeren hellere vil teste i browseren.

- [ ] **Step 7: Browser-verificering**

Brugeren bekræfter i browseren: på Oversigt og TV (fra logo del C) vises de seedede logoer for holdkampe hvis klubnavne matcher (fx "Lyngby 1" → "Lyngby"). Ingen kodeændring her — kun visuel bekræftelse.

**Checkpoint:** stop og lad brugeren bekræfte. Derefter: merge `seed-logoer` → `main` via **superpowers:finishing-a-development-branch** (merge --no-ff, slet branch).

---

## Self-Review (udført)

**1. Spec coverage:**
- Spec §4 (bundtede filer) → Task 1. §5 (seed_key idempotent ALTER) → Task 2. §6 (seedLogos.js) → Task 3. §7 (tilkobling i initialize) → Task 4. §8 (idempotens/re-sync) → Task 3-logik + Task 5 Step 5-6. §9 (visning uændret) → Task 5 Step 7. §10 (edge-cases: manglende mappe, korrupt PNG, eksisterende fil) → Task 3-kode. §11 (deploy + accept) → Task 5. Alle dækket.

**2. Placeholder scan:** Ingen TBD/TODO; al kode er fuldt udskrevet.

**3. Type/navne-konsistens:** `seedClubLogos`, `seed_key`, `central_logos/seed_<slug>.png`, `query`/`queryOne` bruges konsistent på tværs af Task 2-4. Skip-rækkefølge (seed_key før club_name) matcher spec §8.
