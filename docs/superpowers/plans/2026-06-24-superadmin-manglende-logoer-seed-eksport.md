# SuperAdmin manglende klub-logoer + seed-eksport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SuperAdmin kan se alle kendte klubnavne uden auto-matchet logo, uploade/tildele logoer samlet, og eksportere hele biblioteket (inkl. aliasser) som et seed-bundt til fremtidige deploys.

**Architecture:** To nye SuperAdmin-endpoints (`known-club-names` aggregerer navne fra alle tenant-DB'er; `logos/seed-bundle` bygger en `.zip` med adm-zip). Frontend filtrerer "mangler logo" med `window.LogoMatch.matchLogo`, og tilbyder upload (eksisterende endpoint) eller alias-knytning (`updateLogo`). `seedLogos.js` udvides til at læse `aliases.json` fra seed-mappen, så eksporten kan genimporteres ved deploy.

**Tech Stack:** Node.js (CommonJS), MySQL (`mysql2`), `adm-zip` (ny, ren-JS), vanilla JS frontend, Docker Compose. Ingen test-framework → manuel verificering. `node`/`npm` kun i Docker → syntakstjek via `docker run --rm -v <dir>:/src badminton-app-backend node -c /src/...`.

## Global Constraints

- **Kilder til navne:** `tournament_player_clubs.club`, `team_matches.team1_name`+`team2_name`, `player_info.club` — på tværs af alle aktive klubber (`clubs.is_active = 1`).
- **"Mangler logo"-filter sker i frontend** via `window.LogoMatch.matchLogo(name, logos) === null` — matching-logik dupliqueres ikke i backend.
- **Konfliktregel uændret:** alias-knytning tilføjer klubnavnet til et eksisterende logos `aliases` (kommasepareret, ingen dublet), via `PUT /api/super-admin/logos/:id`.
- **Eksport-fidelitet:** zip bærer billede navngivet `<club_name><ext>` + `aliases.json` (`{filnavn: aliases}`). Seederen anvender aliasser ved nyt INSERT.
- **Alt cross-tenant/zip-arbejde er best-effort:** try/catch pr. tenant/fil — en fejl må ikke vælte endpointet.
- **Ingen `"` i PowerShell here-string-commits.** Commit-footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** `logo-superadmin`; merge til `main` til sidst. Checkpoint efter hver task.

## File Structure

- `backend/routes/superAdmin.js` — **Modify.** `require('adm-zip')`; nye routes `GET /known-club-names` og `GET /logos/seed-bundle`.
- `backend/package.json` — **Modify.** Tilføj `adm-zip`.
- `backend/config/seedLogos.js` — **Modify.** Læs `aliases.json`, sæt aliasser ved INSERT.
- `frontend/js/api.js` — **Modify.** `getKnownClubNames()`.
- `frontend/super-admin.html` — **Modify.** Indlæs `logo-match.js`; ny "Klubber uden logo"-sektion; "Download seed-bundle"-knap; version-bumps.
- `frontend/super-admin-script.js` — **Modify.** Load/filter/render mangler-liste, upload-prefill, alias-knyt, bundle-download, wiring.

---

## Task 0: Opret feature-branch

- [ ] **Step 1: Rent træ + branch**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: rent træ, `main`.

Kør i PowerShell:
```
git checkout -b logo-superadmin
```
Expected: `Switched to a new branch 'logo-superadmin'`.

---

## Task 1: Backend — `GET /api/super-admin/known-club-names`

**Files:** Modify `backend/routes/superAdmin.js`

**Interfaces:**
- Consumes: `masterDb.query`, `clubConn(dbName)` (begge findes i filen).
- Produces: `GET /api/super-admin/known-club-names` → `[{ name, sources: string[], count }]`.

- [ ] **Step 1: Tilføj route**

Indsæt i `backend/routes/superAdmin.js` umiddelbart efter `GET /api/super-admin/logos`-routen (efter dens afsluttende `});`, ca. linje 724):

```javascript
// GET /api/super-admin/known-club-names — distinkte klubnavne fra alle tenants
// (turnering + holdkamp + spillere) til "mangler logo"-listen. Frontend filtrerer
// dem der ikke auto-matcher et logo.
router.get('/known-club-names', superAdminAuth, async (req, res, next) => {
    try {
        const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
        const agg = new Map(); // navn -> { name, sources:Set, count }
        const add = (name, source) => {
            const n = (name || '').trim();
            if (!n || n === '?') return;
            let e = agg.get(n);
            if (!e) { e = { name: n, sources: new Set(), count: 0 }; agg.set(n, e); }
            e.sources.add(source); e.count++;
        };

        await Promise.all(clubs.map(async (c) => {
            let conn;
            try {
                conn = await clubConn(c.db_name);
                const q = async (sql) => {
                    try { const [rows] = await conn.execute(sql); return rows; }
                    catch (e) { return []; } // tabel findes evt. ikke i ældre klub-DB
                };
                (await q('SELECT DISTINCT club FROM tournament_player_clubs')).forEach(r => add(r.club, 'turnering'));
                (await q('SELECT DISTINCT team1_name FROM team_matches')).forEach(r => add(r.team1_name, 'holdkamp'));
                (await q('SELECT DISTINCT team2_name FROM team_matches')).forEach(r => add(r.team2_name, 'holdkamp'));
                (await q('SELECT DISTINCT club FROM player_info')).forEach(r => add(r.club, 'spiller'));
            } catch (e) {
                console.error(`known-club-names: tenant ${c.db_name} sprunget over:`, e.message);
            } finally {
                if (conn) { try { await conn.end(); } catch (e) { /* ignore */ } }
            }
        }));

        const out = [...agg.values()]
            .map(e => ({ name: e.name, sources: [...e.sources], count: e.count }))
            .sort((a, b) => b.count - a.count);
        res.json(out);
    } catch (error) { next(error); }
});
```

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
SuperAdmin: known-club-names endpoint (kendte klubnavne paa tvaers af tenants)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 2: Backend — seed-bundle (adm-zip)

**Files:** Modify `backend/package.json`, `backend/routes/superAdmin.js`

**Interfaces:**
- Produces: `GET /api/super-admin/logos/seed-bundle` → `.zip` (billeder + `aliases.json`).

- [ ] **Step 1: Tilføj adm-zip dependency**

I `backend/package.json`, i `dependencies`, tilføj linjen (efter `"qrcode": "^1.5.4"` — husk komma på qrcode-linjen):

```json
    "qrcode": "^1.5.4",
    "adm-zip": "^0.5.10"
```

- [ ] **Step 2: Require adm-zip**

I toppen af `backend/routes/superAdmin.js`, efter `const sharp = require('sharp');` (linje 8), tilføj:

```javascript
const AdmZip = require('adm-zip');
```

- [ ] **Step 3: Tilføj seed-bundle route**

Indsæt i `backend/routes/superAdmin.js` efter `known-club-names`-routen fra Task 1. (`backupFs` og `backupPath` er defineret i filen og er i scope ved request-tid.)

```javascript
// GET /api/super-admin/logos/seed-bundle — download hele biblioteket som seed-zip
// (billeder navngivet efter klub + aliases.json). Udpakkes i backend/assets/seed_logos.
router.get('/logos/seed-bundle', superAdminAuth, async (req, res, next) => {
    try {
        const logos = await masterDb.query(
            'SELECT club_name, aliases, filename, file_path FROM club_logos ORDER BY club_name ASC'
        );
        const zip = new AdmZip();
        const used = new Set();
        const aliasesManifest = {};
        for (const l of logos) {
            if (!l.file_path || !backupFs.existsSync(l.file_path)) {
                console.error('seed-bundle: fil mangler paa disk:', l.file_path);
                continue;
            }
            const ext = backupPath.extname(l.filename) || '.png';
            const base = (String(l.club_name || '').trim()) || 'logo';
            let name = `${base}${ext}`;
            let i = 2;
            while (used.has(name.toLowerCase())) { name = `${base}_${i}${ext}`; i++; }
            used.add(name.toLowerCase());
            zip.addLocalFile(l.file_path, '', name);
            if (l.aliases) aliasesManifest[name] = l.aliases;
        }
        zip.addFile('aliases.json', Buffer.from(JSON.stringify(aliasesManifest, null, 2), 'utf8'));
        const buf = zip.toBuffer();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="seed_logos_bundle.zip"');
        res.send(buf);
    } catch (error) { next(error); }
});
```

> **Route-rækkefølge:** `GET /logos/seed-bundle` er en literal sti; der findes ingen `GET /logos/:id`, så den er entydig.

- [ ] **Step 4: Byg backend (installerer adm-zip) + syntakstjek**

Kør i PowerShell:
```
docker-compose build backend
```
Derefter syntakstjek mod det nye image:
```
docker run --rm -v "C:\Users\jespe\.local\bin\badminton-app\backend:/src" badminton-app-backend node -c /src/routes/superAdmin.js
```
Expected: build OK (adm-zip hentet), `node -c` uden fejl.

- [ ] **Step 5: Commit**

PowerShell:
```
git add backend/package.json backend/routes/superAdmin.js
git commit -m @'
SuperAdmin: seed-bundle download (adm-zip) med billeder + aliases.json

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 3: Seeder læser aliases.json

**Files:** Modify `backend/config/seedLogos.js`

**Interfaces:**
- Consumes: valgfri `backend/assets/seed_logos/aliases.json` (`{ "<filnavn>": "<aliases>" }`).
- Produces: seedede rækker får `aliases` fra manifesten i stedet for altid `null`.

- [ ] **Step 1: Indlæs manifest + brug ved INSERT**

I `backend/config/seedLogos.js`, find linjen der bygger fil-listen:

```javascript
    const files = fs.readdirSync(SEED_DIR).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
    const mimeFor = (ext) => ext === '.webp' ? 'image/webp' : (ext === '.png' ? 'image/png' : 'image/jpeg');
```

Tilføj umiddelbart efter:

```javascript
    // Valgfri alias-manifest fra eksport (aliases.json springes selv over af filteret ovenfor).
    let aliasesByFile = {};
    const manifestPath = path.join(SEED_DIR, 'aliases.json');
    if (fs.existsSync(manifestPath)) {
        try { aliasesByFile = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) || {}; }
        catch (e) { console.error('Kunne ikke laese aliases.json:', e.message); aliasesByFile = {}; }
    }
```

Find dernæst INSERT-kaldet og dets værdier:

```javascript
            await query(
                `INSERT INTO club_logos
                 (club_name, aliases, filename, original_name, file_path, file_size,
                  width, height, mime_type, seed_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [clubName, null, `central_logos/${storedName}`, file, destPath,
                 fileSize, width, height, mimeFor(ext), seedKey]
            );
```

Erstat `null` (aliases-værdien, anden parameter) med `aliasesByFile[file] || null`:

```javascript
            await query(
                `INSERT INTO club_logos
                 (club_name, aliases, filename, original_name, file_path, file_size,
                  width, height, mime_type, seed_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [clubName, aliasesByFile[file] || null, `central_logos/${storedName}`, file, destPath,
                 fileSize, width, height, mimeFor(ext), seedKey]
            );
```

- [ ] **Step 2: Syntakstjek**

Run:
```bash
docker run --rm -v "/c/Users/jespe/.local/bin/badminton-app/backend:/src" badminton-app-backend node -c /src/config/seedLogos.js && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Commit**

PowerShell:
```
git add backend/config/seedLogos.js
git commit -m @'
Seed-logoer: anvend aliasser fra aliases.json-manifest ved seed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 4: Frontend — API-metode + super-admin.html

**Files:** Modify `frontend/js/api.js`, `frontend/super-admin.html`

**Interfaces:**
- Produces: `api.getKnownClubNames()`; ny UI-sektion + `logo-match.js` indlæst.

- [ ] **Step 1: `getKnownClubNames()` i api.js**

I `frontend/js/api.js`, find `getLogos()` (linje ~485):

```javascript
    async getLogos() {
        return this.request('/super-admin/logos');
    }
```

Tilføj under:

```javascript
    async getKnownClubNames() {
        return this.request('/super-admin/known-club-names');
    }
```

- [ ] **Step 2: Ny "Klubber uden logo"-sektion + bundle-knap i super-admin.html**

I `frontend/super-admin.html`, find logo-biblioteks-kortets header (linje ~96-100):

```html
            <!-- Klub-logoer (centralt bibliotek) -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Klub-logoer (centralt bibliotek)</span>
                    <button id="refreshLogosBtn" class="btn-secondary">↻ Opdater</button>
                </div>
```

Erstat med (tilføjer ny sektion FØR biblioteks-kortet + en download-knap i headeren):

```html
            <!-- Klubber uden logo -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Klubber uden logo</span>
                    <button id="refreshMissingLogosBtn" class="btn-secondary">↻ Opdater</button>
                </div>
                <p style="color:rgba(255,255,255,0.5); font-size:0.82em; margin-bottom:10px;">Kendte klubnavne (turnering, holdkamp, spillere) der ikke auto-matcher et logo. Upload eller knyt til et eksisterende logo.</p>
                <div id="missingLogoList"><div class="empty-state"><div class="spinner"></div></div></div>
            </div>

            <!-- Klub-logoer (centralt bibliotek) -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Klub-logoer (centralt bibliotek)</span>
                    <div style="display:flex; gap:8px;">
                        <button id="downloadSeedBundleBtn" class="btn-secondary">⬇ Seed-bundle</button>
                        <button id="refreshLogosBtn" class="btn-secondary">↻ Opdater</button>
                    </div>
                </div>
```

- [ ] **Step 3: Indlæs logo-match.js + bump versioner**

I `frontend/super-admin.html`, find scripts (linje ~289-290):

```html
    <script src="js/api.js?v=6"></script>
    <script src="super-admin-script.js?v=11"></script>
```

Erstat med:

```html
    <script src="js/api.js?v=7"></script>
    <script src="js/logo-match.js?v=1"></script>
    <script src="super-admin-script.js?v=12"></script>
```

- [ ] **Step 4: Syntakstjek api.js**

Run:
```bash
docker run --rm -v "/c/Users/jespe/.local/bin/badminton-app/frontend:/src" badminton-app-backend node -c /src/js/api.js && echo OK
```
Expected: `OK`.

- [ ] **Step 5: Commit**

PowerShell:
```
git add frontend/js/api.js frontend/super-admin.html
git commit -m @'
SuperAdmin UI: getKnownClubNames, mangler-logo-sektion, seed-bundle-knap, logo-match.js

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 5: Frontend — super-admin-script logik

**Files:** Modify `frontend/super-admin-script.js`

**Interfaces:**
- Consumes: `api.getKnownClubNames`, `api.getLogos`, `api.updateLogo`, `window.LogoMatch.matchLogo`, eksisterende `logoCache`, `escapeHtml`, `loadLogos`.

- [ ] **Step 1: Mangler-liste: load, filter, render**

I `frontend/super-admin-script.js`, tilføj efter `renderLogos`-funktionen (ca. linje 940):

```javascript
// ---- Klubber uden logo ----
async function loadMissingLogos() {
    const listEl = document.getElementById('missingLogoList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        const [names, logos] = await Promise.all([api.getKnownClubNames(), api.getLogos()]);
        logoCache = logos || [];
        const missing = (names || []).filter(c =>
            !(window.LogoMatch && LogoMatch.matchLogo(c.name, logoCache)));
        renderMissingLogos(missing);
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${escapeHtml(err.message || 'kunne ikke hente klubber')}</div>`;
    }
}

function renderMissingLogos(list) {
    const listEl = document.getElementById('missingLogoList');
    if (!list.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Alle kendte klubber har et logo 🎉</div>';
        return;
    }
    const opts = logoCache.map(l => `<option value="${l.id}">${escapeHtml(l.club_name)}</option>`).join('');
    listEl.innerHTML = list.map(c => {
        const safe = escapeHtml(c.name);
        const attr = c.name.replace(/'/g, "\\'");
        return `
        <div class="admin-item" style="gap:10px; flex-wrap:wrap;">
            <div style="flex:1; min-width:160px;">
                <div class="admin-name">${safe}</div>
                <div class="admin-email">${c.sources.join(', ')} · ${c.count}×</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-primary" style="font-size:0.8em; padding:5px 10px;" onclick="prefillUploadLogo('${attr}')">Upload logo</button>
                <select id="link-sel-${escapeHtml(slugifyId(c.name))}" class="link-existing-sel" style="font-size:0.8em; padding:5px;">
                    <option value="">Knyt til…</option>${opts}
                </select>
                <button class="btn-secondary" style="font-size:0.8em; padding:5px 10px;" onclick="linkClubToLogo('${attr}', this.previousElementSibling)">Knyt</button>
            </div>
        </div>`;
    }).join('');
}

function slugifyId(s) { return String(s).replace(/[^a-zA-Z0-9]/g, '_'); }

function prefillUploadLogo(name) {
    const inp = document.getElementById('newLogoClubName');
    if (inp) { inp.value = name; inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

async function linkClubToLogo(name, selectEl) {
    const id = selectEl && selectEl.value ? parseInt(selectEl.value, 10) : 0;
    if (!id) { alert('Vælg et logo at knytte til'); return; }
    const logo = logoCache.find(l => l.id === id);
    if (!logo) return;
    const aliases = (logo.aliases || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!aliases.some(a => a.toLowerCase() === name.toLowerCase())) aliases.push(name);
    try {
        await api.updateLogo(id, logo.club_name, aliases.join(', '));
        await loadLogos();
        await loadMissingLogos();
    } catch (err) {
        alert('Kunne ikke knytte: ' + (err.message || 'ukendt fejl'));
    }
}
```

- [ ] **Step 2: Seed-bundle download (mønster fra downloadClubBackup)**

Tilføj i `frontend/super-admin-script.js` (fx efter `downloadClubBackup`):

```javascript
async function downloadSeedBundle() {
    const token = sessionStorage.getItem('superAdminToken') || sessionStorage.getItem('authToken');
    try {
        const res = await fetch('/api/super-admin/logos/seed-bundle', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'seed_logos_bundle.zip'; a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Seed-bundle fejlede: ' + err.message);
    }
}
```

- [ ] **Step 3: Wire knapper + load ved opstart**

Find init-blokken hvor `refreshLogosBtn` og `uploadLogoBtn` bindes (ca. linje 99-100):

```javascript
    document.getElementById('uploadLogoBtn').addEventListener('click', handleUploadLogo);
    document.getElementById('refreshLogosBtn').addEventListener('click', loadLogos);
```

Tilføj under:

```javascript
    document.getElementById('refreshMissingLogosBtn').addEventListener('click', loadMissingLogos);
    document.getElementById('downloadSeedBundleBtn').addEventListener('click', downloadSeedBundle);
```

Find dernæst hvor `loadLogos()` kaldes ved sektion-visning (ca. linje 186) og tilføj `loadMissingLogos()` ved siden af:

```javascript
        loadLogos();
        loadMissingLogos();
```

Og gør de tre nye funktioner globale (så `onclick` virker), ved at tilføje efter deres definitioner:

```javascript
window.prefillUploadLogo = prefillUploadLogo;
window.linkClubToLogo = linkClubToLogo;
```

- [ ] **Step 4: Syntakstjek**

Run:
```bash
docker run --rm -v "/c/Users/jespe/.local/bin/badminton-app/frontend:/src" badminton-app-backend node -c /src/super-admin-script.js && echo OK
```
Expected: `OK`.

- [ ] **Step 5: Commit**

PowerShell:
```
git add frontend/super-admin-script.js
git commit -m @'
SuperAdmin UI: mangler-logo-liste, upload-prefill, alias-knyt, seed-bundle-download

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 6: Deploy og verificér

**Files:** ingen kodeændringer.

- [ ] **Step 1: Byg og genstart**

PowerShell:
```
docker-compose build backend frontend
docker-compose up -d backend frontend
docker logs badminton-backend --tail 8
```
Expected: ren opstart (adm-zip installeret i image, ingen require-fejl).

- [ ] **Step 2: Verificér known-club-names (kræver super-admin-token)**

Log ind på super-admin-siden i browseren og åbn afsnittet — eller test endpointet med et token. Hurtig usikret-tjek af at ruten er mountet (forventet 401 uden token):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/super-admin/known-club-names
```
Expected: `401` (ruten findes, auth krævet).

- [ ] **Step 3: Verificér seed-bundle-ruten findes**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/super-admin/logos/seed-bundle
```
Expected: `401`.

- [ ] **Step 4: Browser-verificering (acceptkriterier)**

I browseren (logget ind som super-admin):
- "Klubber uden logo" viser kendte klubber uden auto-match; auto-matchede vises ikke.
- Upload nyt logo for en klub → forsvinder fra listen; ses i biblioteket.
- Knyt en klub til et eksisterende logo (alias) → forsvinder fra listen; aliasset ses på logoet.
- "⬇ Seed-bundle" downloader `seed_logos_bundle.zip`; zip indeholder `<klub>.<ext>` + `aliases.json`.

- [ ] **Step 5: Verificér seed-roundtrip (valgfri, lokalt)**

Udpak en downloadet `seed_logos_bundle.zip` ind i `backend/assets/seed_logos/` (overskriv), `docker-compose build backend && docker-compose up -d backend`, og bekræft i loggen at seed kører og at `GET /api/logos` viser de forventede aliasser (på en frisk DB). Bemærk: på den eksisterende DB springes allerede-seedede over (re-sync), så aliasser ses tydeligst på en frisk instans.

**Checkpoint:** derefter merge `logo-superadmin` → `main` via **superpowers:finishing-a-development-branch** (merge --no-ff, slet branch).

---

## Self-Review (udført)

**1. Spec coverage:** §4.1 known-club-names → Task 1. §4.2 frontend-filter/visning → Task 4+5. §5 tildel-flow (upload+alias) → Task 5 (prefillUploadLogo, linkClubToLogo). §6 seed-bundle → Task 2. §7 seeder-aliasser → Task 3. §8 flader → Task 4/5. §9 edge-cases → try/catch i Task 1/2, filter i Task 5. §10 verificering → Task 6. Alle dækket.

**2. Placeholder-scan:** ingen TBD/TODO; al kode fuldt udskrevet.

**3. Type/navne-konsistens:** `getKnownClubNames`, `loadMissingLogos`/`renderMissingLogos`, `prefillUploadLogo`, `linkClubToLogo`, `downloadSeedBundle`, `aliasesByFile`/`aliases.json`, `adm-zip`/`AdmZip` brugt konsistent. `aliases.json`-nøgle = zip-filnavn (Task 2) = seed-filnavn (Task 3). DOM-id'er (`missingLogoList`, `refreshMissingLogosBtn`, `downloadSeedBundleBtn`) matcher mellem Task 4 (html) og Task 5 (script).
