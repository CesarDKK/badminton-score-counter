# SuperAdmin importer seed-bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SuperAdmin kan uploade en seed-bundle-zip og opdatere det centrale logo-bibliotek (billeder + aliasser) live, uden deploy.

**Architecture:** Nyt `POST /api/super-admin/logos/import-bundle` (memory-multer + adm-zip) læser zip'en, upserter `club_logos` pr. `club_name` (overskriv billede+aliasser, slet gammel fil; nye får `seed_key=NULL`), og skriver billeder til `uploads/central_logos`. Frontend får en "⬆ Importer seed-bundle"-knap med skjult file-input + bekræftelse, der POSTer via `FormData`+Bearer (doClubRestore-mønster) og genindlæser logo-listerne.

**Tech Stack:** Node.js (CommonJS), MySQL (`mysql2`), `adm-zip` (eksisterende), `sharp`, multer (memory), vanilla JS. Ingen test-framework → manuel verificering. `node` kun i Docker → syntakstjek via `docker run --rm -v <dir>:/src badminton-app-backend node -c /src/...`.

## Global Constraints

- **Konflikt = overskriv:** findes `club_name` allerede → UPDATE billede+aliasser + slet gammel fil. Nye → INSERT med `seed_key = NULL`.
- **Format = kun zip** i eksport-format (`<club_name>.<ext>` + `aliases.json` = `{filnavn: aliasser}`).
- **Path-traversal-sikring:** brug kun `path.basename(entry.entryName)` — aldrig entry-stien.
- **Lagring:** `uploads/central_logos` + `club_logos`. Ingen ændring i `seedLogos.js`. Ingen ny dependency.
- **Best-effort pr. entry:** try/catch pr. fil → én dårlig fil giver `errors++`, stopper ikke resten.
- **Ingen `"` i PowerShell here-string-commits.** Commit-footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** `logo-import`; merge til `main` til sidst. Checkpoint efter hver task.

## File Structure

- `backend/routes/superAdmin.js` — **Modify.** Ny route `POST /logos/import-bundle` (genbruger `AdmZip`, `backupMulter`, `masterDb`, `sharp`, `backupFs`/`backupPath`).
- `frontend/super-admin.html` — **Modify.** "⬆ Importer seed-bundle"-knap + version-bump.
- `frontend/super-admin-script.js` — **Modify.** Skjult input + `importSeedBundle()` + wiring.

---

## Task 0: Opret feature-branch

- [ ] **Step 1: Rent træ + branch**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: rent træ, `main`.

PowerShell:
```
git checkout -b logo-import
```
Expected: `Switched to a new branch 'logo-import'`.

---

## Task 1: Backend — `POST /api/super-admin/logos/import-bundle`

**Files:** Modify `backend/routes/superAdmin.js`

**Interfaces:**
- Consumes: `AdmZip` (required i toppen fra seed-bundle-arbejdet), `backupMulter` (memory, 100MB, defineret i filen), `masterDb`, `sharp`, `backupFs`, `backupPath`.
- Produces: `POST /api/super-admin/logos/import-bundle` (felt `bundle`) → `{ imported, updated, skipped, errors }`.

- [ ] **Step 1: Tilføj route**

Indsæt i `backend/routes/superAdmin.js` umiddelbart efter `GET /api/super-admin/logos/seed-bundle`-routen (efter dens afsluttende `});`):

```javascript
// POST /api/super-admin/logos/import-bundle — indlæs en seed-bundle-zip live i biblioteket.
// Upsert pr. club_name: overskriv billede+aliasser for eksisterende, INSERT (seed_key=NULL)
// for nye. Format: <club_name>.<ext>-filer + valgfri aliases.json ({filnavn: aliasser}).
router.post('/logos/import-bundle', superAdminAuth, backupMulter.single('bundle'), async (req, res, next) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'Zip-fil er påkrævet (felt: bundle)' });
        }
        const crypto = require('crypto');

        let zip;
        try { zip = new AdmZip(req.file.buffer); }
        catch (e) { return res.status(400).json({ error: 'Ugyldig eller beskadiget zip-fil' }); }

        const entries = zip.getEntries();

        // aliases.json (valgfri) -> { filnavn: aliasser }
        let aliasesByFile = {};
        const manifestEntry = entries.find(e => backupPath.basename(e.entryName) === 'aliases.json');
        if (manifestEntry) {
            try { aliasesByFile = JSON.parse(manifestEntry.getData().toString('utf8')) || {}; }
            catch (e) { console.error('import-bundle: ugyldig aliases.json:', e.message); aliasesByFile = {}; }
        }

        const uploadDir = process.env.UPLOAD_DIR || backupPath.join(__dirname, '..', 'uploads');
        const logoDir = backupPath.join(uploadDir, 'central_logos');
        if (!backupFs.existsSync(logoDir)) backupFs.mkdirSync(logoDir, { recursive: true });

        let imported = 0, updated = 0, skipped = 0, errors = 0;

        for (const entry of entries) {
            if (entry.isDirectory) continue;
            const fileName = backupPath.basename(entry.entryName); // path-traversal-sikring
            if (!/\.(png|jpe?g|webp)$/i.test(fileName)) continue;   // springer aliases.json m.m. over

            let destPath = null;
            try {
                const ext = backupPath.extname(fileName).toLowerCase();
                const clubName = backupPath.basename(fileName, backupPath.extname(fileName))
                    .replace(/\s+/g, ' ').trim();
                if (!clubName) { skipped++; continue; }
                const aliases = aliasesByFile[fileName] || null;
                const mime = ext === '.webp' ? 'image/webp' : (ext === '.png' ? 'image/png' : 'image/jpeg');

                const slug = clubName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                const storedName = `import_${slug}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
                destPath = backupPath.join(logoDir, storedName);
                backupFs.writeFileSync(destPath, entry.getData());

                let width = null, height = null;
                try { const meta = await sharp(destPath).metadata(); width = meta.width || null; height = meta.height || null; }
                catch (e) { /* metadata valgfri */ }
                const fileSize = backupFs.statSync(destPath).size;
                const filename = `central_logos/${storedName}`;

                const existing = await masterDb.queryOne(
                    'SELECT id, file_path FROM club_logos WHERE club_name = ?', [clubName]
                );
                if (existing) {
                    await masterDb.query(
                        `UPDATE club_logos
                         SET aliases = ?, filename = ?, original_name = ?, file_path = ?,
                             file_size = ?, width = ?, height = ?, mime_type = ?
                         WHERE id = ?`,
                        [aliases, filename, fileName, destPath, fileSize, width, height, mime, existing.id]
                    );
                    if (existing.file_path && existing.file_path !== destPath) {
                        try { backupFs.unlinkSync(existing.file_path); } catch (e) { /* gammel fil evt. væk */ }
                    }
                    updated++;
                } else {
                    await masterDb.query(
                        `INSERT INTO club_logos
                         (club_name, aliases, filename, original_name, file_path, file_size,
                          width, height, mime_type, seed_key)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
                        [clubName, aliases, filename, fileName, destPath, fileSize, width, height, mime]
                    );
                    imported++;
                }
            } catch (e) {
                console.error('import-bundle: fejl ved', fileName, e.message);
                if (destPath) { try { backupFs.unlinkSync(destPath); } catch (er) { /* ignore */ } }
                errors++;
            }
        }

        res.json({ imported, updated, skipped, errors });
    } catch (error) { next(error); }
});
```

> **Route-rækkefølge:** literal sti `/logos/import-bundle`; ingen `GET/POST /logos/:id` kolliderer (PUT/DELETE bruger `:id`, men metode+sti adskiller). Entydig.

- [ ] **Step 2: Syntakstjek**

Run:
```bash
docker run --rm -v "/c/Users/jespe/.local/bin/badminton-app/backend:/src" badminton-app-backend node -c /src/routes/superAdmin.js && echo OK
```
Expected: `OK`. (Kør evt. via PowerShell.)

- [ ] **Step 3: Commit**

PowerShell:
```
git add backend/routes/superAdmin.js
git commit -m @'
SuperAdmin: import-bundle endpoint (live indlaesning af seed-bundle-zip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 2: Frontend — import-knap + flow

**Files:** Modify `frontend/super-admin.html`, `frontend/super-admin-script.js`

**Interfaces:**
- Consumes: `POST /api/super-admin/logos/import-bundle` (Task 1), `loadLogos`, `loadMissingLogos`, sessionStorage-token.

- [ ] **Step 1: Knap i logo-kortets header**

I `frontend/super-admin.html`, find logo-bibliotekets header-knapper:

```html
                    <div style="display:flex; gap:8px;">
                        <button id="downloadSeedBundleBtn" class="btn-secondary">⬇ Seed-bundle</button>
                        <button id="refreshLogosBtn" class="btn-secondary">↻ Opdater</button>
                    </div>
```

Erstat med (tilføjer import-knap):

```html
                    <div style="display:flex; gap:8px;">
                        <button id="importSeedBundleBtn" class="btn-secondary">⬆ Importer seed-bundle</button>
                        <button id="downloadSeedBundleBtn" class="btn-secondary">⬇ Seed-bundle</button>
                        <button id="refreshLogosBtn" class="btn-secondary">↻ Opdater</button>
                    </div>
```

- [ ] **Step 2: Bump script-version**

I `frontend/super-admin.html`, find:

```html
    <script src="super-admin-script.js?v=12"></script>
```
Erstat `?v=12` med `?v=13`.

- [ ] **Step 3: Skjult input + import-flow i super-admin-script.js**

I `frontend/super-admin-script.js`, tilføj efter `downloadSeedBundle`-funktionen:

```javascript
// Skjult file-input til seed-bundle-import
const _importBundleInput = (() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,application/zip';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
        if (inp.files[0]) doImportSeedBundle(inp.files[0]);
        inp.value = '';
    });
    return inp;
})();

function triggerImportSeedBundle() {
    if (!confirm('Importer logoer fra seed-bundle?\n\nEksisterende klubber med samme navn FÅR overskrevet billede og aliasser.')) return;
    _importBundleInput.click();
}

async function doImportSeedBundle(file) {
    const token = sessionStorage.getItem('superAdminToken') || sessionStorage.getItem('authToken');
    const form = new FormData();
    form.append('bundle', file);
    try {
        const res = await fetch('/api/super-admin/logos/import-bundle', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        alert(`✓ Import færdig\n${data.imported} nye, ${data.updated} opdateret, ${data.skipped} sprunget over, ${data.errors} fejl`);
        await loadLogos();
        await loadMissingLogos();
    } catch (err) {
        alert('Import fejlede: ' + (err.message || 'ukendt fejl'));
    }
}
```

- [ ] **Step 4: Wire knappen**

I `frontend/super-admin-script.js`, find bindingen af `downloadSeedBundleBtn` (fra forrige feature):

```javascript
    document.getElementById('downloadSeedBundleBtn').addEventListener('click', downloadSeedBundle);
```

Tilføj under:

```javascript
    document.getElementById('importSeedBundleBtn').addEventListener('click', triggerImportSeedBundle);
```

- [ ] **Step 5: Syntakstjek**

Run:
```bash
docker run --rm -v "/c/Users/jespe/.local/bin/badminton-app/frontend:/src" badminton-app-backend node -c /src/super-admin-script.js && echo OK
```
Expected: `OK`.

- [ ] **Step 6: Commit**

PowerShell:
```
git add frontend/super-admin.html frontend/super-admin-script.js
git commit -m @'
SuperAdmin UI: importer seed-bundle (knap + upload-flow + genindlaes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 3: Deploy og verificér

**Files:** ingen kodeændringer.

- [ ] **Step 1: Byg og genstart**

PowerShell:
```
docker-compose build backend frontend
docker-compose up -d backend frontend
docker logs badminton-backend --tail 6
```
Expected: ren opstart.

- [ ] **Step 2: Ruten findes (uden token → 401)**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/super-admin/logos/import-bundle
```
Expected: `401`.

- [ ] **Step 3: Authed round-trip (eksportér → slet → importér)**

Hvis standard-superadmin virker lokalt:
```bash
TOKEN=$(curl -s -X POST http://localhost/api/super-admin/login -H "Content-Type: application/json" -d '{"username":"superadmin","password":"superadmin123"}' | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')
# 1) eksportér nuv. bundle
curl -s http://localhost/api/super-admin/logos/seed-bundle -H "Authorization: Bearer $TOKEN" -o /tmp/b.zip
echo "zip bytes: $(stat -c%s /tmp/b.zip)"
# 2) importér det igen (idempotent: alt bør blive 'updated')
curl -s -X POST http://localhost/api/super-admin/logos/import-bundle -H "Authorization: Bearer $TOKEN" -F "bundle=@/tmp/b.zip"
echo
```
Expected: import-svar `{"imported":0,"updated":N,"skipped":0,"errors":0}` (N = antal logoer; alle opdateret, ingen fejl). Hvis login fejler (adgangskode ændret), spring over og verificér i browser.

- [ ] **Step 4: Ugyldig zip → 400**

```bash
echo "ikke en zip" > /tmp/bad.txt
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/super-admin/logos/import-bundle -H "Authorization: Bearer $TOKEN" -F "bundle=@/tmp/bad.txt"
```
Expected: `400`.

- [ ] **Step 5: Browser-verificering (acceptkriterier)**

I SuperAdmin (logget ind):
- Slet et logo i biblioteket → "⬆ Importer seed-bundle" → vælg en tidligere downloadet bundle → bekræft → logoet er tilbage (inkl. aliasser), og status-dialogen viser tællingen.
- Importér en ikke-zip → pæn fejl, biblioteket uændret.
- Efter import: logo-listen + "Klubber uden logo" er opdateret; logoerne auto-matcher på TV/Oversigt.

**Checkpoint:** derefter merge `logo-import` → `main` via **superpowers:finishing-a-development-branch** (merge --no-ff, slet branch).

---

## Self-Review (udført)

**1. Spec coverage:** §4 backend-endpoint → Task 1 (multer/adm-zip/upsert/overskriv/seed_key=NULL/path.basename/best-effort). §5 frontend knap+flow → Task 2. §6 lagring (central_logos, seed_key=NULL, ingen seeder-ændring) → Task 1. §8 edge-cases (ugyldig zip→400, ikke-billede springes over, tomt navn→skipped, manglende aliases.json, billed-fejl→errors, path-traversal) → Task 1-kode. §9 verificering → Task 3. Alle dækket.

**2. Placeholder-scan:** ingen TBD/TODO; al kode fuldt udskrevet.

**3. Type/navne-konsistens:** route `/logos/import-bundle`, felt `bundle`, svar `{imported, updated, skipped, errors}`, DOM-id `importSeedBundleBtn`, funktioner `triggerImportSeedBundle`/`doImportSeedBundle`, og `aliasesByFile[fileName]`-nøgle (filnavn) matcher eksportens `aliases.json`-format. Konsistent mellem Task 1 (backend) og Task 2 (frontend).
