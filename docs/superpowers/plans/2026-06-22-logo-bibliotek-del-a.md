# Centralt klub-logo-bibliotek (Del A) — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Et centralt, delt klub-logo-bibliotek i master-DB som kun Superadmin kan administrere (upload/list/rediger/slet).

**Architecture:** Logoer ligger i master-DB-tabellen `club_logos` (delt på tværs af alle klubber) og filerne i en delt mappe `/uploads/central_logos/`, serveret via den eksisterende `/uploads/`-rute. Backend-CRUD ligger i `superAdmin.js` bag `superAdminAuth`; frontend er en ny sektion på Superadmin-siden.

**Tech Stack:** Node/Express, mysql2 (`masterDb`), multer (disk-upload), sharp (billed-metadata), vanilla JS frontend, Docker Compose, nginx.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-22-logo-bibliotek-del-a-design.md`.
- **Kun del A:** ingen klub-vendt API, ingen matching, ingen visning (senere specs).
- **Verificering: manuel** (deploy lokalt + test i Superadmin). INGEN ny test-infra.
- **Billedformater:** kun raster — PNG/WebP/JPG.
- **Sletning:** hård (DB-række + fil fra disk).
- **Master-DB:** `masterDb.query()`/`masterDb.queryOne()` (fra `backend/config/masterDatabase.js`). `masterDatabase.initialize()` kører IKKE `init.master.sql`, så tabellen skal også oprettes idempotent i `initialize()`.
- **URL-format:** logo-fil tilgås på `/uploads/central_logos/<fil>` (serveres allerede til alle subdomæner — ingen nginx/compose-ændring).
- **Auth:** alle logo-ruter bruger `superAdminAuth`. Frontend bruger `this.token` (sat ved super-admin login).
- **Deploy lokalt:** backend-ændringer → `docker-compose build backend frontend && docker-compose up -d backend frontend`; rene frontend-ændringer → kun `frontend`.
- **Cache-bust:** bump `?v=` på ændrede JS-filer i `super-admin.html`.
- **Commit-beskeder:** INGEN dobbelte anførselstegn (PowerShell here-string brydes ellers); afslut med `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Git-mappe:** `C:\Users\jespe\.local\bin\badminton-app`. Arbejd på en feature-branch (`logo-bibliotek`), merg til main til sidst.

---

## Task 1: Master-DB tabel `club_logos`

**Files:**
- Modify: `backend/init.master.sql` (tilføj tabel for friske installationer)
- Modify: `backend/config/masterDatabase.js` (`initialize()` ~linje 42-69 — opret tabel idempotent ved opstart)

**Interfaces:**
- Producerer: master-DB-tabel `club_logos(id, club_name, aliases, filename, original_name, file_path, file_size, width, height, mime_type, upload_date)`.

- [ ] **Step 1: Opret feature-branch**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && git checkout -b logo-bibliotek
```

- [ ] **Step 2: Tilføj tabellen i `backend/init.master.sql`** (efter `clubs`-tabellen, før filens slutning):

```sql

-- Centralt klub-logo-bibliotek (delt paa tvaers af alle klubber, kun superadmin)
CREATE TABLE IF NOT EXISTS club_logos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  club_name VARCHAR(150) NOT NULL,
  aliases TEXT NULL,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INT NOT NULL,
  width INT NULL,
  height INT NULL,
  mime_type VARCHAR(50) NOT NULL,
  upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_club_name (club_name)
) ENGINE=InnoDB;
```

- [ ] **Step 3: Opret tabellen idempotent ved opstart i `backend/config/masterDatabase.js`.** I `initialize()`, lige før linjen `console.log('✓ Master database forbindelse OK');`, indsæt:

```javascript
        // Centralt logo-bibliotek — oprettes idempotent saa eksisterende master-DB ogsaa faar tabellen
        await query(`
            CREATE TABLE IF NOT EXISTS club_logos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                club_name VARCHAR(150) NOT NULL,
                aliases TEXT NULL,
                filename VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                file_size INT NOT NULL,
                width INT NULL,
                height INT NULL,
                mime_type VARCHAR(50) NOT NULL,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_club_name (club_name)
            ) ENGINE=InnoDB
        `);
```

- [ ] **Step 4: Deploy backend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend && docker-compose up -d backend
```
Forventet: ren opstart, `✓ Master database forbindelse OK` i `docker logs badminton-backend --tail 10`.

- [ ] **Step 5: Manuel verifikation — tabellen findes**

```bash
docker exec badminton-mysql sh -c "mysql -ubadminton_user -p\"$DB_PASSWORD\" badminton_master -e 'DESCRIBE club_logos;'" 2>/dev/null || docker exec badminton-mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" badminton_master -e "DESCRIBE club_logos;"
```
Forventet: kolonnerne `id, club_name, aliases, filename, ...` listes. (Hvis env-vars ikke er sat i shellen, brug de faktiske credentials fra `docker-compose.yml`.)

- [ ] **Step 6: Commit**

```bash
git add backend/init.master.sql backend/config/masterDatabase.js
git commit -m @'
Logo-bibliotek: club_logos tabel i master-DB (init + idempotent ved opstart)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
(PowerShell here-string; ingen dobbelte anførselstegn i beskeden.)

---

## Task 2: Multer-config + Superadmin CRUD-ruter

**Files:**
- Create: `backend/config/logoUpload.js`
- Modify: `backend/routes/superAdmin.js` (imports i toppen ~linje 1-6; nye ruter — indsæt før `module.exports = router;` i bunden)

**Interfaces:**
- Konsumerer: `masterDb` (allerede importeret i superAdmin.js), `superAdminAuth` (allerede importeret).
- Producerer endpoints:
  - `POST /api/super-admin/logos` (multipart: `image`, `clubName`, `aliases`) → `{ id, club_name, aliases, url, original_name }`
  - `GET /api/super-admin/logos` → `Array<{ id, club_name, aliases, filename, original_name, upload_date, url }>`
  - `PUT /api/super-admin/logos/:id` (JSON: `clubName`, `aliases`) → `{ success: true }`
  - `DELETE /api/super-admin/logos/:id` → `{ success: true }`
- `url` har formen `/uploads/central_logos/<fil>`.

- [ ] **Step 1: Opret `backend/config/logoUpload.js`**

```javascript
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const baseUploadDir = process.env.UPLOAD_DIR || './uploads';
const logoDir = path.join(baseUploadDir, 'central_logos');

if (!fs.existsSync(logoDir)) {
    fs.mkdirSync(logoDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(logoDir)) {
            fs.mkdirSync(logoDir, { recursive: true });
        }
        cb(null, logoDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '_' + crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9]/g, '_')
            .substring(0, 50);
        cb(null, `${basename}_${uniqueSuffix}${ext}`);
    }
});

// Kun raster-logoer: PNG/WebP/JPG
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/webp', 'image/jpeg', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Kun PNG, WebP eller JPG er tilladt'), false);
    }
};

const logoUpload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

module.exports = logoUpload;
```

- [ ] **Step 2: Tilføj imports i toppen af `backend/routes/superAdmin.js`.** Find de eksisterende require-linjer (~1-6) og tilføj efter dem:

```javascript
const fs = require('fs');
const sharp = require('sharp');
const logoUpload = require('../config/logoUpload');
```

- [ ] **Step 3: Tilføj de fire logo-ruter i `backend/routes/superAdmin.js`** umiddelbart FØR `module.exports = router;` i bunden:

```javascript
// ==================== KLUB-LOGO-BIBLIOTEK (centralt, master-DB) ====================

// POST /api/super-admin/logos — upload nyt logo
router.post('/logos', superAdminAuth, logoUpload.single('image'), async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Billede er påkrævet' });

        const clubName = (req.body.clubName || '').trim();
        const aliases = (req.body.aliases || '').trim();
        if (!clubName) {
            try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
            return res.status(400).json({ error: 'Klubnavn er påkrævet' });
        }

        let width = null, height = null;
        try {
            const meta = await sharp(req.file.path).metadata();
            width = meta.width || null;
            height = meta.height || null;
        } catch (e) { /* metadata valgfri */ }

        const storedFilename = `central_logos/${req.file.filename}`;
        const result = await masterDb.query(
            `INSERT INTO club_logos
             (club_name, aliases, filename, original_name, file_path, file_size, width, height, mime_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [clubName, aliases || null, storedFilename, req.file.originalname,
             req.file.path, req.file.size, width, height, req.file.mimetype]
        );

        res.status(201).json({
            id: result.insertId,
            club_name: clubName,
            aliases: aliases || null,
            original_name: req.file.originalname,
            url: `/uploads/${storedFilename}`
        });
    } catch (error) { next(error); }
});

// GET /api/super-admin/logos — list alle logoer
router.get('/logos', superAdminAuth, async (req, res, next) => {
    try {
        const rows = await masterDb.query(
            `SELECT id, club_name, aliases, filename, original_name, upload_date
             FROM club_logos ORDER BY club_name ASC`
        );
        res.json(rows.map(r => ({ ...r, url: `/uploads/${r.filename}` })));
    } catch (error) { next(error); }
});

// PUT /api/super-admin/logos/:id — ret klubnavn/aliasser
router.put('/logos/:id', superAdminAuth, async (req, res, next) => {
    try {
        const clubName = (req.body.clubName || '').trim();
        const aliases = (req.body.aliases || '').trim();
        if (!clubName) return res.status(400).json({ error: 'Klubnavn er påkrævet' });

        const result = await masterDb.query(
            'UPDATE club_logos SET club_name = ?, aliases = ? WHERE id = ?',
            [clubName, aliases || null, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Logo ikke fundet' });
        res.json({ success: true });
    } catch (error) { next(error); }
});

// DELETE /api/super-admin/logos/:id — slet række + fil
router.delete('/logos/:id', superAdminAuth, async (req, res, next) => {
    try {
        const logo = await masterDb.queryOne('SELECT file_path FROM club_logos WHERE id = ?', [req.params.id]);
        if (!logo) return res.status(404).json({ error: 'Logo ikke fundet' });

        await masterDb.query('DELETE FROM club_logos WHERE id = ?', [req.params.id]);
        try { fs.unlinkSync(logo.file_path); } catch (e) { console.error('Kunne ikke slette logo-fil:', e.message); }

        res.json({ success: true });
    } catch (error) { next(error); }
});
```

- [ ] **Step 4: Deploy backend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend && docker-compose up -d backend
```
Forventet: ren opstart i `docker logs badminton-backend --tail 10` (ingen require-/syntaksfejl).

- [ ] **Step 5: Manuel verifikation (curl med superadmin-token)**

```bash
# 1) Login og hent token (standard-login er superadmin/superadmin123 hvis ikke aendret)
TOKEN=$(curl -s -X POST http://localhost/api/super-admin/login -H "Content-Type: application/json" -d '{"username":"superadmin","password":"superadmin123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "token: ${TOKEN:0:20}..."

# 2) Tom liste til at starte med
curl -s http://localhost/api/super-admin/logos -H "Authorization: Bearer $TOKEN"; echo

# 3) Upload et test-PNG (brug en hvilken som helst lokal png)
curl -s -X POST http://localhost/api/super-admin/logos -H "Authorization: Bearer $TOKEN" -F "image=@/c/Users/jespe/.local/bin/badminton-app/frontend/favicon.png" -F "clubName=Testklub" -F "aliases=Test, TK"; echo

# 4) Listen indeholder nu logoet, og url kan hentes
curl -s http://localhost/api/super-admin/logos -H "Authorization: Bearer $TOKEN"; echo
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost/uploads/central_logos/$(curl -s http://localhost/api/super-admin/logos -H "Authorization: Bearer $TOKEN" | sed -E 's#.*central_logos/([^"]+)".*#\1#')"
```
Forventet: login giver token; upload returnerer `{id,...,url:"/uploads/central_logos/..."}`; listen viser logoet; URL'en svarer `200`.
Bemærk: hvis super-admin-adgangskoden er ændret, brug den rigtige. Slet test-logoet bagefter i UI (Task 3) eller via `DELETE`.

- [ ] **Step 6: Commit**

```bash
git add backend/config/logoUpload.js backend/routes/superAdmin.js
git commit -m @'
Logo-bibliotek: multer-config + Superadmin CRUD-ruter for logoer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: API-klient + Superadmin-frontend (upload/galleri/rediger/slet)

**Files:**
- Modify: `frontend/js/api.js` (tilføj logo-metoder, fx efter `uploadSponsorImages`)
- Modify: `frontend/super-admin.html` (ny "Klub-logoer"-card i `#badmintonSection`; bump `super-admin-script.js?v=`)
- Modify: `frontend/super-admin-script.js` (loadLogos/render/upload/edit/delete + listeners + kald i `switchApp`)

**Interfaces:**
- Konsumerer: endpoints fra Task 2. `showMsg(el, msg, type)` og `escapeHtml(str)` findes allerede i super-admin-script.js (~linje 882/888). `switchApp('badminton')` (~linje 170) kalder `loadClubs()` — tilføj `loadLogos()`.

- [ ] **Step 1: Tilføj logo-metoder i `frontend/js/api.js`** efter `uploadSponsorImages`-metoden (~linje 481):

```javascript
    // ==================== Klub-logoer (Superadmin) ====================

    async getLogos() {
        return this.request('/super-admin/logos');
    }

    async uploadLogo(file, clubName, aliases) {
        const fd = new FormData();
        fd.append('image', file);
        fd.append('clubName', clubName);
        fd.append('aliases', aliases || '');
        const headers = {};
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
        const response = await fetch(`${API_BASE_URL}/super-admin/logos`, {
            method: 'POST', headers, body: fd
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(error.error || `Upload Error: HTTP ${response.status}`);
        }
        return await response.json();
    }

    async updateLogo(id, clubName, aliases) {
        return this.request(`/super-admin/logos/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ clubName, aliases })
        });
    }

    async deleteLogo(id) {
        return this.request(`/super-admin/logos/${id}`, { method: 'DELETE' });
    }
```

- [ ] **Step 2: Tilføj "Klub-logoer"-card i `frontend/super-admin.html`.** Find linjen `            </div><!-- /badmintonSection -->` og indsæt FØR den:

```html
            <!-- Klub-logoer (centralt bibliotek) -->
            <div class="card">
                <div class="card-header">
                    <span class="card-title">Klub-logoer (centralt bibliotek)</span>
                    <button id="refreshLogosBtn" class="btn-secondary">↻ Opdater</button>
                </div>
                <div class="create-form">
                    <div class="form-group" style="margin-bottom:0">
                        <label>Klubnavn</label>
                        <input type="text" id="newLogoClubName" placeholder="fx Lyngby">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Aliasser (komma-separeret, valgfri)</label>
                        <input type="text" id="newLogoAliases" placeholder="fx Lyngby Badminton, LBK">
                    </div>
                    <div class="form-group" style="margin-bottom:0">
                        <label>Logo (PNG/WebP/JPG)</label>
                        <input type="file" id="newLogoFile" accept="image/png,image/webp,image/jpeg">
                    </div>
                    <button id="uploadLogoBtn" class="btn-primary" style="height:46px; margin-top:22px;">Upload logo</button>
                </div>
                <div id="uploadLogoMsg" class="msg" style="display:none;"></div>
                <div id="logoList" style="margin-top:16px;">
                    <div class="empty-state"><div class="spinner"></div></div>
                </div>
            </div>
```

- [ ] **Step 3: Bump script-version i `frontend/super-admin.html`:** skift `super-admin-script.js?v=10` → `super-admin-script.js?v=11`.

- [ ] **Step 4: Tilføj logo-funktioner i `frontend/super-admin-script.js`** (fx i bunden, før evt. afsluttende kode):

```javascript
// ==================== KLUB-LOGOER ====================

async function loadLogos() {
    const listEl = document.getElementById('logoList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        const logos = await api.getLogos();
        renderLogos(logos);
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${escapeHtml(err.message || 'kunne ikke hente logoer')}</div>`;
    }
}

function renderLogos(logos) {
    const listEl = document.getElementById('logoList');
    if (!logos || logos.length === 0) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen logoer endnu</div>';
        return;
    }
    listEl.innerHTML = logos.map(l => `
        <div class="admin-item" id="logo-row-${l.id}" style="gap:12px;">
            <img src="${escapeHtml(l.url)}" alt="" style="width:48px;height:48px;object-fit:contain;background:rgba(255,255,255,0.06);border-radius:6px;flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <div class="admin-name">${escapeHtml(l.club_name)}</div>
                ${l.aliases ? `<div class="admin-email">${escapeHtml(l.aliases)}</div>` : ''}
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-secondary" style="font-size:0.8em; padding:5px 10px;"
                    onclick="showEditLogo(${l.id})">Rediger</button>
                <button class="btn-danger" style="font-size:0.8em; padding:5px 10px;"
                    onclick="handleDeleteLogo(${l.id})">Slet</button>
            </div>
        </div>
    `).join('');
    logoCache = logos;
}

let logoCache = [];

async function handleUploadLogo() {
    const clubName = document.getElementById('newLogoClubName').value.trim();
    const aliases = document.getElementById('newLogoAliases').value.trim();
    const fileInput = document.getElementById('newLogoFile');
    const file = fileInput.files[0];
    const msgEl = document.getElementById('uploadLogoMsg');
    const btn = document.getElementById('uploadLogoBtn');

    if (!file) { showMsg(msgEl, 'Vælg en logo-fil', 'error'); return; }
    if (!clubName) { showMsg(msgEl, 'Klubnavn er påkrævet', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Uploader...';
    msgEl.style.display = 'none';
    try {
        await api.uploadLogo(file, clubName, aliases);
        showMsg(msgEl, '✓ Logo uploadet', 'success');
        document.getElementById('newLogoClubName').value = '';
        document.getElementById('newLogoAliases').value = '';
        fileInput.value = '';
        loadLogos();
    } catch (err) {
        showMsg(msgEl, err.message || 'Upload mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Upload logo';
    }
}

function showEditLogo(id) {
    const existing = document.getElementById('edit-logo-form');
    if (existing) existing.remove();
    const logo = logoCache.find(l => l.id === id);
    if (!logo) return;
    const row = document.getElementById(`logo-row-${id}`);
    const form = document.createElement('div');
    form.id = 'edit-logo-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div class="form-group" style="margin-bottom:8px;">
            <label>Klubnavn</label>
            <input type="text" id="editLogoClubName" value="${escapeHtml(logo.club_name)}">
        </div>
        <div class="form-group" style="margin-bottom:8px;">
            <label>Aliasser (komma-separeret)</label>
            <input type="text" id="editLogoAliases" value="${escapeHtml(logo.aliases || '')}">
        </div>
        <div style="display:flex; gap:8px;">
            <button class="btn-primary" style="padding:8px 14px;font-size:0.85em;" onclick="handleSaveLogo(${id})">Gem</button>
            <button class="btn-secondary" style="padding:8px 12px;font-size:0.85em;" onclick="document.getElementById('edit-logo-form').remove()">Annuller</button>
        </div>
        <div id="editLogoMsg" class="msg" style="display:none;margin-top:8px;"></div>
    `;
    row.insertAdjacentElement('afterend', form);
}

async function handleSaveLogo(id) {
    const clubName = document.getElementById('editLogoClubName').value.trim();
    const aliases = document.getElementById('editLogoAliases').value.trim();
    const msgEl = document.getElementById('editLogoMsg');
    if (!clubName) { showMsg(msgEl, 'Klubnavn er påkrævet', 'error'); return; }
    try {
        await api.updateLogo(id, clubName, aliases);
        document.getElementById('edit-logo-form').remove();
        loadLogos();
    } catch (err) {
        showMsg(msgEl, err.message || 'Kunne ikke gemme', 'error');
    }
}

async function handleDeleteLogo(id) {
    if (!confirm('Slet dette logo permanent?')) return;
    try {
        await api.deleteLogo(id);
        loadLogos();
    } catch (err) {
        alert(err.message || 'Sletning mislykkedes');
    }
}
```

- [ ] **Step 5: Wire listeners + indlæs logoer.** I `DOMContentLoaded`-setup (hvor andre knapper bindes), tilføj:

```javascript
    document.getElementById('uploadLogoBtn').addEventListener('click', handleUploadLogo);
    document.getElementById('refreshLogosBtn').addEventListener('click', loadLogos);
```
Og i `switchApp(app)` i `if (isBadminton) { ... }`-blokken, tilføj `loadLogos();` lige efter `loadClubs();`:

```javascript
    if (isBadminton) {
        loadClubs();
        loadLogos();
    } else {
```

- [ ] **Step 6: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 7: Manuel verifikation (browser)** på `http://localhost/super-admin.html` (Ctrl+F5, log ind som superadmin):
  - Badminton-fanen viser en "Klub-logoer"-sektion.
  - Upload et PNG med klubnavn + aliasser → vises i galleriet med thumbnail, klubnavn og aliasser.
  - Rediger klubnavn/aliasser → opdateres i listen.
  - Slet → forsvinder fra listen (og filen er væk: tidligere URL giver 404).
  - Slet evt. test-logoet fra Task 2.

- [ ] **Step 8: Commit**

```bash
git add frontend/js/api.js frontend/super-admin.html frontend/super-admin-script.js
git commit -m @'
Logo-bibliotek: Superadmin-frontend (upload, galleri, rediger, slet) + api-metoder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Afsluttende verifikation (hele del A)

- [ ] `club_logos` findes i master-DB efter opstart.
- [ ] Superadmin kan uploade (PNG/WebP/JPG), liste, redigere og slette logoer.
- [ ] Uploadet logo kan hentes på `/uploads/central_logos/<fil>` fra browseren.
- [ ] Ikke-superadmin kan ikke ramme ruterne (401/403 uden gyldig token).
- [ ] Merge `logo-bibliotek` → `main` når alt er verificeret:

```bash
git checkout main && git merge --no-ff logo-bibliotek -m @'
Merge: centralt klub-logo-bibliotek (del A)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git push origin main
```

## Noter til Pi-deploy (produktion)

Backend + frontend ændres:
```bash
git pull && docker-compose build backend frontend && docker-compose up -d backend frontend
```
`club_logos` oprettes automatisk ved backend-opstart (idempotent). Ingen nginx/compose-ændring.
