# Klub-logoer Del B (matching + tildeling) — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Knyt centrale klub-logoer til holdkamp-hold og spillere via automatisk navne-matching med manuel override, så data er klar til visning (del C).

**Architecture:** En delt frontend-matcher (`logo-match.js`) udleder logo dynamisk ud fra navne mod den offentlige liste fra `GET /api/logos` (master-DB). Manuelle overrides gemmes som `logo_id` på `team_matches` (pr. hold) og i en ny `player_logos`-tabel (pr. spillernavn, én kilde) i klub-DB. Ingen visning ved kampene (del C).

**Tech Stack:** Node/Express, mysql2 (`masterDb` + tenant `query`), vanilla JS frontend, Docker Compose, nginx.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-23-logo-bibliotek-del-b-design.md`.
- **Matching:** delvist match — normaliseret navn **indeholder** logoets klubnavn/alias; ved flere match vinder **længste** nøgle.
- **Lagring:** dynamisk auto + gemt override (kun overrides gemmes; auto udledes hver gang).
- **Spiller-logo = én kilde** i `player_logos` keyed på spillernavn; redigerbar fra Spiller info OG turnering; upsert opretter rækken.
- **Verificering: manuel** (curl + browser). INGEN ny test-infra.
- **Ingen visning ved kampene** (bane/TV/oversigt) — det er del C.
- **Migrationer:** kører for default-DB + alle klub-DB'er via `backend/config/migrationRunner.js`. INGEN semikoloner i SQL-kommentarer (splitStatements er ikke kommentar-bevidst). Tilføj også til `init.sql` (nye klubber).
- **Master-DB:** `masterDb.query()` (fra `backend/config/masterDatabase.js`). Klub-DB: `query`/`queryOne` (fra `backend/config/database.js`).
- **logo_id** er en løs reference til master `club_logos.id` (ingen cross-DB FK).
- **Deploy lokalt:** backend-ændringer → `docker-compose build backend frontend && docker-compose up -d backend frontend`; rene frontend-ændringer → kun `frontend`. Bump `?v=` på ændrede JS-filer i deres HTML.
- **Commit-beskeder:** INGEN dobbelte anførselstegn (PowerShell here-string); afslut med `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Git:** feature-branch `logo-del-b`, merge til main til sidst.

---

## Task 1: Matcher-modul + offentlig logo-liste-API

**Files:**
- Create: `backend/routes/logos.js`
- Modify: `backend/server.js` (mount-blok ~linje 132-142)
- Create: `frontend/js/logo-match.js`
- Modify: `frontend/js/api.js` (tilføj `getPublicLogos`)

**Interfaces:**
- Producerer: `GET /api/logos` → `[{ id, club_name, aliases, url, width, height }]` (offentlig, master-DB).
- Producerer global `window.LogoMatch = { normalizeName, matchLogo }`:
  - `matchLogo(name: string, logos: Array) -> logo|null` (delvist match, længste nøgle vinder).
- Producerer `api.getPublicLogos(): Promise<Array>`.

- [ ] **Step 1: Opret feature-branch**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && git checkout -b logo-del-b
```

- [ ] **Step 2: Opret `backend/routes/logos.js`**

```javascript
const express = require('express');
const router = express.Router();
const masterDb = require('../config/masterDatabase');

// GET /api/logos — offentlig liste over centrale klub-logoer (master-DB)
router.get('/', async (req, res, next) => {
    try {
        const rows = await masterDb.query(
            `SELECT id, club_name, aliases, filename, width, height
             FROM club_logos ORDER BY club_name ASC`
        );
        res.json(rows.map(r => ({
            id: r.id,
            club_name: r.club_name,
            aliases: r.aliases,
            width: r.width,
            height: r.height,
            url: `/uploads/${r.filename}`
        })));
    } catch (error) { next(error); }
});

module.exports = router;
```

- [ ] **Step 3: Mount ruten i `backend/server.js`.** Efter linjen `app.use('/api/team-matches', require('./routes/teamMatches'));` tilføj:

```javascript
app.use('/api/logos', require('./routes/logos'));
```

- [ ] **Step 4: Opret `frontend/js/logo-match.js`**

```javascript
// Delt logo-matcher: udleder et centralt klub-logo ud fra et hold-/klubnavn.
// Delvist match — normaliseret navn INDEHOLDER klubnavn/alias; laengste noegle vinder.
(function (global) {
    function norm(s) {
        return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }
    // Navne-normalisering: fjern seed "[n]" og endelses-holdnummer/romertal ("Lyngby 1" -> "lyngby")
    function normalizeName(s) {
        let t = String(s || '').replace(/\s*\[\d+\]\s*$/, '');
        t = t.replace(/\s+(?:\d{1,3}|i{1,3}|iv|v)$/i, '');
        return norm(t);
    }
    function logoKeys(logo) {
        const keys = [logo.club_name];
        if (logo.aliases) String(logo.aliases).split(',').forEach(a => keys.push(a));
        return keys.map(norm).filter(Boolean);
    }
    function matchLogo(name, logos) {
        const n = normalizeName(name);
        if (!n || !Array.isArray(logos)) return null;
        let best = null, bestLen = 0;
        for (const logo of logos) {
            for (const key of logoKeys(logo)) {
                if (n.includes(key) && key.length > bestLen) {
                    best = logo;
                    bestLen = key.length;
                }
            }
        }
        return best;
    }
    global.LogoMatch = { normalizeName, matchLogo };
})(window);
```

- [ ] **Step 5: Tilføj `getPublicLogos` i `frontend/js/api.js`** (efter `getLogos`-metoden fra del A):

```javascript
    /** Offentlig liste over centrale klub-logoer (til matching/visning) */
    async getPublicLogos() {
        return this.request('/logos', { requiresAuth: false });
    }
```

- [ ] **Step 6: Deploy backend + frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend frontend && docker-compose up -d backend frontend
```
Forventet: ren backend-opstart (`docker logs badminton-backend --tail 8`).

- [ ] **Step 7: Manuel verifikation**

```bash
curl -s http://localhost/api/logos; echo
```
Forventet: JSON-array (tom `[]` hvis biblioteket er tomt, ellers logoer med `url`). Ingen auth nødvendig.
Matcher-funktionen testes i browser-konsol på en vilkårlig side der loader logo-match.js (verificeres i Task 3 hvor den bruges). Hurtig sanity i DevTools-konsol efter Task 3.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/logos.js backend/server.js frontend/js/logo-match.js frontend/js/api.js
git commit -m @'
Logo del B: matcher-modul + offentlig GET /api/logos + api.getPublicLogos

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: player_logos-tabel + /api/player-logos API

**Files:**
- Create: `backend/migrations/019_add_player_logos.sql`
- Modify: `backend/init.sql` (tilføj `player_logos`-tabel)
- Create: `backend/routes/playerLogos.js`
- Modify: `backend/server.js` (mount)
- Modify: `frontend/js/api.js` (api-metoder)

**Interfaces:**
- Producerer klub-DB-tabel `player_logos(id, player_name, logo_id, created_at, updated_at)` med UNIQUE på `player_name`.
- Producerer endpoints:
  - `GET /api/player-logos` → `[{ player_name, logo_id }]` (offentlig).
  - `PUT /api/player-logos` (auth, body `{ playerName, logoId }`) → upsert → `{ success: true }`.
  - `DELETE /api/player-logos?name=<navn>` (auth) → `{ success: true }`.
- Producerer api-metoder: `getPlayerLogos()`, `setPlayerLogo(playerName, logoId)`, `clearPlayerLogo(playerName)`.

- [ ] **Step 1: Opret migration `backend/migrations/019_add_player_logos.sql`**

```sql
-- Spiller-logo overrides (en kilde pr. spillernavn) -- ingen semikolon i kommentarer
CREATE TABLE IF NOT EXISTS player_logos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  player_name VARCHAR(100) NOT NULL,
  logo_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_player_name (player_name)
) ENGINE=InnoDB;
```

- [ ] **Step 2: Tilføj samme tabel i `backend/init.sql`.** Find `player_info`-tabellens `CREATE TABLE`-blok og indsæt EFTER den (find linjen `) ENGINE=InnoDB;` der afslutter player_info — indsæt den nye blok lige efter):

```sql

-- Spiller-logo overrides (en kilde pr. spillernavn)
CREATE TABLE IF NOT EXISTS player_logos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  player_name VARCHAR(100) NOT NULL,
  logo_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_player_name (player_name)
) ENGINE=InnoDB;
```

- [ ] **Step 3: Opret `backend/routes/playerLogos.js`**

```javascript
const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/player-logos — alle spiller-logo overrides (offentlig)
router.get('/', async (req, res, next) => {
    try {
        const rows = await query('SELECT player_name, logo_id FROM player_logos');
        res.json(rows);
    } catch (error) { next(error); }
});

// PUT /api/player-logos — upsert override for et spillernavn (auth)
router.put('/', authMiddleware, async (req, res, next) => {
    try {
        const playerName = (req.body.playerName || '').trim();
        const logoId = parseInt(req.body.logoId, 10);
        if (!playerName) return res.status(400).json({ error: 'Spillernavn er påkrævet' });
        if (!logoId) return res.status(400).json({ error: 'logoId er påkrævet' });

        await query(
            `INSERT INTO player_logos (player_name, logo_id) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE logo_id = VALUES(logo_id)`,
            [playerName, logoId]
        );
        res.json({ success: true });
    } catch (error) { next(error); }
});

// DELETE /api/player-logos?name=<navn> — fjern override (auth)
router.delete('/', authMiddleware, async (req, res, next) => {
    try {
        const playerName = (req.query.name || '').trim();
        if (!playerName) return res.status(400).json({ error: 'Spillernavn er påkrævet' });
        await query('DELETE FROM player_logos WHERE player_name = ?', [playerName]);
        res.json({ success: true });
    } catch (error) { next(error); }
});

module.exports = router;
```

- [ ] **Step 4: Mount i `backend/server.js`** efter `app.use('/api/player-info', ...)`:

```javascript
app.use('/api/player-logos', require('./routes/playerLogos'));
```

- [ ] **Step 5: Tilføj api-metoder i `frontend/js/api.js`** (efter `getPublicLogos`):

```javascript
    async getPlayerLogos() {
        return this.request('/player-logos', { requiresAuth: false });
    }

    async setPlayerLogo(playerName, logoId) {
        return this.request('/player-logos', {
            method: 'PUT',
            body: JSON.stringify({ playerName, logoId })
        });
    }

    async clearPlayerLogo(playerName) {
        return this.request(`/player-logos?name=${encodeURIComponent(playerName)}`, {
            method: 'DELETE'
        });
    }
```

- [ ] **Step 6: Deploy backend + frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend frontend && docker-compose up -d backend frontend
```
Forventet: i `docker logs badminton-backend` ses migration `019_add_player_logos.sql → badminton_counter` (og evt. klub-DB'er); ren opstart.

- [ ] **Step 7: Manuel verifikation (curl, auth via admin-login)**

```bash
# Admin-token (direkte mode bruger admin-password). Tilpas hvis aendret.
TOKEN=$(curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d '{"password":"admin123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "token-len: ${#TOKEN}"
echo "--- tomt ---"; curl -s http://localhost/api/player-logos; echo
echo "--- upsert ---"; curl -s -X PUT http://localhost/api/player-logos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"playerName":"Test Spiller","logoId":1}'; echo
echo "--- liste ---"; curl -s http://localhost/api/player-logos; echo
echo "--- delete ---"; curl -s -X DELETE "http://localhost/api/player-logos?name=Test%20Spiller" -H "Authorization: Bearer $TOKEN"; echo
echo "--- tom igen ---"; curl -s http://localhost/api/player-logos; echo
```
Forventet: tom → efter upsert vises `{player_name:"Test Spiller", logo_id:1}` → efter delete tom igen. (logoId 1 behøver ikke eksistere i biblioteket for denne API-test.)

- [ ] **Step 8: Commit**

```bash
git add backend/migrations/019_add_player_logos.sql backend/init.sql backend/routes/playerLogos.js backend/server.js frontend/js/api.js
git commit -m @'
Logo del B: player_logos tabel + /api/player-logos GET/PUT/DELETE + api-metoder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: Logo-vælger i Spiller info

**Files:**
- Modify: `frontend/player-info.html` (logo-felt i rediger-modal; load logo-match.js; bump versioner)
- Modify: `frontend/player-info-script.js` (load logoer, forvalg, gem/ryd override)

**Interfaces:**
- Konsumerer: `api.getPublicLogos()`, `api.getPlayerLogos()`, `api.setPlayerLogo()`, `api.clearPlayerLogo()`, `window.LogoMatch.matchLogo`.
- Eksisterende: `editPlayer(playerId)`, `handleEditPlayer(e)` (~linje 211-261), `showMessage`, `loadPlayers`.

- [ ] **Step 1: Tilføj logo-felt i rediger-modalen i `frontend/player-info.html`.** Find blokken med `editPlayerAgeGroup`-select (slutter med `</select>` før `<div class="modal-actions">`) og indsæt EFTER den select, før `<div class="modal-actions">`:

```html
                <label>Klub-logo:</label>
                <select id="editPlayerLogo">
                    <option value="">(Automatisk ud fra klub)</option>
                </select>
                <div id="editPlayerLogoPreview" style="display:flex; align-items:center; gap:10px; margin:6px 0;">
                    <img id="editPlayerLogoImg" alt="" style="width:40px; height:40px; object-fit:contain; background:rgba(255,255,255,0.06); border-radius:6px; display:none;">
                    <span id="editPlayerLogoHint" style="font-size:0.85em; color:#aaa;"></span>
                </div>
```

- [ ] **Step 2: Indsæt logo-script + bump versioner i `frontend/player-info.html`.** Erstat de to script-linjer i bunden:

```html
    <script src="js/api.js?v=5"></script>
    <script src="player-info-script.js?v=6"></script>
```
med:

```html
    <script src="js/api.js?v=8"></script>
    <script src="js/logo-match.js?v=1"></script>
    <script src="player-info-script.js?v=7"></script>
```

- [ ] **Step 3: Tilføj logo-state + loader i `frontend/player-info-script.js`.** Indsæt øverst (efter evt. eksisterende top-niveau `const`/`let`, fx efter `const api = ...`):

```javascript
let _logoCache = [];
async function ensureLogos() {
    if (_logoCache.length) return _logoCache;
    try { _logoCache = await api.getPublicLogos(); } catch (e) { _logoCache = []; }
    return _logoCache;
}
function fillLogoSelect(selectEl, selectedId) {
    selectEl.innerHTML = '<option value="">(Automatisk ud fra klub)</option>' +
        _logoCache.map(l => `<option value="${l.id}">${l.club_name}</option>`).join('');
    if (selectedId) selectEl.value = String(selectedId);
}
```

- [ ] **Step 4: Udvid `editPlayer(playerId)`** så den fylder logo-vælgeren og viser forvalg. Find slutningen af `editPlayer` (lige før `document.getElementById('editPlayerModal').style.display = 'block';`) og indsæt:

```javascript
        await ensureLogos();
        const playerLogos = await api.getPlayerLogos().catch(() => []);
        const override = playerLogos.find(p => p.player_name === player.name);
        fillLogoSelect(document.getElementById('editPlayerLogo'), override ? override.logo_id : '');
        updateEditPlayerLogoPreview(player.club);
        document.getElementById('editPlayerLogo').onchange = () => updateEditPlayerLogoPreview(player.club);
        document.getElementById('editPlayerClub').oninput = () => updateEditPlayerLogoPreview(document.getElementById('editPlayerClub').value);
```

- [ ] **Step 5: Tilføj preview-funktion** i `frontend/player-info-script.js` (top-niveau):

```javascript
// Viser hvilket logo der bruges: valgt override, ellers auto-match paa klub
function updateEditPlayerLogoPreview(club) {
    const sel = document.getElementById('editPlayerLogo');
    const img = document.getElementById('editPlayerLogoImg');
    const hint = document.getElementById('editPlayerLogoHint');
    let logo = null, auto = false;
    if (sel.value) {
        logo = _logoCache.find(l => String(l.id) === sel.value) || null;
    } else {
        logo = window.LogoMatch.matchLogo(club || '', _logoCache);
        auto = !!logo;
    }
    if (logo) {
        img.src = logo.url; img.style.display = '';
        hint.textContent = auto ? `Automatisk: ${logo.club_name}` : `Valgt: ${logo.club_name}`;
    } else {
        img.style.display = 'none';
        hint.textContent = 'Intet logo fundet — vælg manuelt';
    }
}
```

- [ ] **Step 6: Gem/ryd override i `handleEditPlayer(e)`.** Efter det eksisterende `await api.updatePlayer(...)`-kald (og før `showMessage('Succes', ...)`), indsæt:

```javascript
        const logoSel = document.getElementById('editPlayerLogo');
        if (logoSel.value) {
            await api.setPlayerLogo(name, parseInt(logoSel.value, 10));
        } else {
            await api.clearPlayerLogo(name);
        }
```

- [ ] **Step 7: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 8: Manuel verifikation (browser)** på `http://localhost/player-info.html` (log ind, Ctrl+F5). Kræver mindst ét logo i biblioteket (opret via Superadmin hvis tomt):
  - Rediger en spiller hvis klub matcher et logo → "Automatisk: <klub>" + thumbnail vises uden at vælge noget.
  - Vælg et andet logo manuelt → preview skifter til "Valgt: ...". Gem → genåbn spiller → valget huskes.
  - Sæt tilbage til "(Automatisk ud fra klub)" → gem → override fjernet (auto vises igen).

- [ ] **Step 9: Commit**

```bash
git add frontend/player-info.html frontend/player-info-script.js
git commit -m @'
Logo del B: logo-vaelger i Spiller info (auto-forvalg + manuel override)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: team_matches logo-kolonner + holdkamp-API

**Files:**
- Create: `backend/migrations/020_add_team_match_logos.sql`
- Modify: `backend/init.sql` (team_matches kolonner)
- Modify: `backend/routes/teamMatches.js` (POST, /active, /active-all, ny PUT /:id/logos)
- Modify: `frontend/js/api.js` (`updateTeamMatchLogos`)

**Interfaces:**
- Producerer kolonner `team_matches.team1_logo_id`, `team_matches.team2_logo_id` (nullable INT).
- `POST /api/team-matches` accepterer `team1LogoId`, `team2LogoId`.
- `GET /active` og `/active-all` returnerer `team1_logo_id`, `team2_logo_id`.
- `PUT /api/team-matches/:id/logos` (auth, body `{ team1LogoId, team2LogoId }`, null rydder) → `{ success: true }`.
- `api.updateTeamMatchLogos(id, team1LogoId, team2LogoId)`.

- [ ] **Step 1: Opret migration `backend/migrations/020_add_team_match_logos.sql`**

```sql
-- Holdkamp logo-override pr. hold (NULL = auto-match paa holdnavn)
ALTER TABLE team_matches ADD COLUMN team1_logo_id INT NULL;
ALTER TABLE team_matches ADD COLUMN team2_logo_id INT NULL;
```

- [ ] **Step 2: Tilføj kolonnerne i `backend/init.sql`.** Find `CREATE TABLE IF NOT EXISTS team_matches (...)` og tilføj de to kolonner (efter `team2_name ...`-linjen, før `status`):

```sql
  team1_logo_id INT NULL,
  team2_logo_id INT NULL,
```

- [ ] **Step 3: Medtag logo-felter i `GET /active`.** I `backend/routes/teamMatches.js`, i `/active`-ruten, udvid team_matches-SELECT:

```javascript
        const teamMatch = await queryOne(
            `SELECT id, format, team1_name, team2_name, team1_logo_id, team2_logo_id, status, created_at
             FROM team_matches WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`
        );
```

- [ ] **Step 4: Medtag logo-felter i `GET /active-all`.** Udvid team_matches-SELECT tilsvarende:

```javascript
        const teamMatches = await query(
            `SELECT id, format, team1_name, team2_name, team1_logo_id, team2_logo_id, status, created_at
             FROM team_matches WHERE status = 'active'
             ORDER BY created_at ASC`
        );
```

- [ ] **Step 5: Gem logo-id'er i `POST /`.** Erstat destrukturering + INSERT i `POST /`:

```javascript
        const { format, team1Name, team2Name, games, team1LogoId, team2LogoId } = req.body;

        if (!format || !team1Name || !team2Name || !games || !Array.isArray(games)) {
            return res.status(400).json({ error: 'Alle felter er påkrævet' });
        }
```
og INSERT-sætningen:

```javascript
        const result = await query(
            `INSERT INTO team_matches (format, team1_name, team2_name, team1_logo_id, team2_logo_id, status)
             VALUES (?, ?, ?, ?, ?, 'active')`,
            [format, team1Name, team2Name, team1LogoId || null, team2LogoId || null]
        );
```
(behold tournament-409-tjekket og games-INSERT-loopet uændret imellem.)

- [ ] **Step 6: Tilføj `PUT /:id/logos`** i `backend/routes/teamMatches.js` (fx lige efter `POST /`-ruten):

```javascript
// PUT /api/team-matches/:id/logos - opdater hold-logoer (requires auth)
router.put('/:id/logos', authMiddleware, async (req, res, next) => {
    try {
        const { team1LogoId, team2LogoId } = req.body;
        const result = await query(
            'UPDATE team_matches SET team1_logo_id = ?, team2_logo_id = ? WHERE id = ?',
            [team1LogoId || null, team2LogoId || null, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Holdkamp ikke fundet' });
        res.json({ success: true });
    } catch (error) { next(error); }
});
```

- [ ] **Step 7: Tilføj api-metode i `frontend/js/api.js`** (efter `getActiveTeamMatches`):

```javascript
    async updateTeamMatchLogos(id, team1LogoId, team2LogoId) {
        return this.request(`/team-matches/${id}/logos`, {
            method: 'PUT',
            body: JSON.stringify({ team1LogoId, team2LogoId })
        });
    }
```

- [ ] **Step 8: Deploy backend + frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend frontend && docker-compose up -d backend frontend
```
Forventet: migration `020_add_team_match_logos.sql` køres; ren opstart.

- [ ] **Step 9: Manuel verifikation (curl)**

```bash
TOKEN=$(curl -s -X POST http://localhost/api/auth/login -H "Content-Type: application/json" -d '{"password":"admin123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
echo "--- opret holdkamp med logo-id ---"
curl -s -X POST http://localhost/api/team-matches -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"format":"4spillere","team1Name":"Lyngby 1","team2Name":"Roskilde 2","team1LogoId":1,"team2LogoId":null,"games":[{"category":"Single","team1Player1":"A","team2Player1":"B"}]}'; echo
echo "--- active-all viser logo-felter ---"
curl -s http://localhost/api/team-matches/active-all | sed -E 's/.*("team1_logo_id":[^,]+,"team2_logo_id":[^,]+).*/\1/'; echo
```
Forventet: oprettelse OK; `active-all` indeholder `team1_logo_id` (1) og `team2_logo_id` (null). Ryd op: slet holdkampen igen (admin-UI eller `DELETE /api/team-matches/:id`).

- [ ] **Step 10: Commit**

```bash
git add backend/migrations/020_add_team_match_logos.sql backend/init.sql backend/routes/teamMatches.js frontend/js/api.js
git commit -m @'
Logo del B: team_matches logo-kolonner + POST/active/active-all/PUT logos + api

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: Logo-vælger i holdkamp (oprettelse + aktiv)

**Files:**
- Modify: `frontend/admin.html` (logo-select pr. hold i opret-form; load logo-match.js; bump versioner)
- Modify: `frontend/admin-script.js` (fyld vælgere + auto-forvalg, send i `startHoldkamp`, ret på aktiv holdkamp)

**Interfaces:**
- Konsumerer: `api.getPublicLogos()`, `window.LogoMatch.matchLogo`, `api.updateTeamMatchLogos`, eksisterende `startHoldkamp()`, `createTeamMatch`, `renderActiveHoldkampBlock`.

- [ ] **Step 1: Tilføj logo-selects i holdkamp-opret-formen i `frontend/admin.html`.** Find de to inputs `holdkampTeam1Name` og `holdkampTeam2Name` og tilføj under hver sin (inde i samme `<div>`-kolonne):

For Hold 1 (efter `holdkampTeam1Name`-inputtet):
```html
                            <select id="holdkampTeam1Logo" style="width:100%; padding:10px; margin-top:8px; background:var(--color-bg-dark); color:#eaeaea; border:1px solid var(--color-primary); border-radius:5px;">
                                <option value="">Logo: automatisk</option>
                            </select>
```
For Hold 2 (efter `holdkampTeam2Name`-inputtet):
```html
                            <select id="holdkampTeam2Logo" style="width:100%; padding:10px; margin-top:8px; background:var(--color-bg-dark); color:#eaeaea; border:1px solid var(--color-primary); border-radius:5px;">
                                <option value="">Logo: automatisk</option>
                            </select>
```

- [ ] **Step 2: Indsæt logo-match.js + bump versioner i `frontend/admin.html`.** Tilføj før `admin-script.js`-scripttagget:

```html
    <script src="js/logo-match.js?v=1"></script>
```
og bump `js/api.js?v=7` → `?v=8` og `admin-script.js?v=30` → `?v=31`.

- [ ] **Step 3: Fyld logo-vælgerne + auto-forvalg i `frontend/admin-script.js`.** Tilføj top-niveau helpers (fx nær de øvrige holdkamp-funktioner):

```javascript
let _adminLogoCache = [];
async function ensureAdminLogos() {
    if (_adminLogoCache.length) return _adminLogoCache;
    try { _adminLogoCache = await api.getPublicLogos(); } catch (e) { _adminLogoCache = []; }
    return _adminLogoCache;
}
function fillHoldkampLogoSelect(selectEl) {
    selectEl.innerHTML = '<option value="">Logo: automatisk</option>' +
        _adminLogoCache.map(l => `<option value="${l.id}">${l.club_name}</option>`).join('');
}
// Forvalg: hvis ingen manuel valgt, vis auto-match som hjaelpetekst i option-label
function autoHoldkampLogoId(name) {
    const m = window.LogoMatch.matchLogo(name || '', _adminLogoCache);
    return m ? m.id : null;
}
```

- [ ] **Step 4: Initialisér vælgerne når holdkamp-formen vises.** Find funktionen der viser holdkamp-sektionen (`showHoldkamp`) og tilføj efter den gør sektionen synlig:

```javascript
    ensureAdminLogos().then(() => {
        const s1 = document.getElementById('holdkampTeam1Logo');
        const s2 = document.getElementById('holdkampTeam2Logo');
        if (s1) fillHoldkampLogoSelect(s1);
        if (s2) fillHoldkampLogoSelect(s2);
    });
```

- [ ] **Step 5: Send logo-id'er i `startHoldkamp()`.** Find `await api.createTeamMatch({ format, team1Name, team2Name, games });` og erstat med:

```javascript
        const t1LogoSel = document.getElementById('holdkampTeam1Logo');
        const t2LogoSel = document.getElementById('holdkampTeam2Logo');
        const team1LogoId = t1LogoSel.value ? parseInt(t1LogoSel.value, 10) : autoHoldkampLogoId(team1Name);
        const team2LogoId = t2LogoSel.value ? parseInt(t2LogoSel.value, 10) : autoHoldkampLogoId(team2Name);
        await api.createTeamMatch({ format, team1Name, team2Name, games, team1LogoId, team2LogoId });
```
(Bemærk: her gemmes det auto-matchede id ved oprettelse hvis intet er valgt manuelt — så holdkamp-holdets logo er fast fra start. Spec §3's "dynamisk auto" gælder primært visning når intet override findes; for holdkamp-hold er det rart at fastfryse forvalget, og det kan stadig ændres bagefter.)

- [ ] **Step 6: Tilføj rediger-logo på aktiv holdkamp.** I `renderActiveHoldkampBlock` (holdkamp-header med `teamMatch.team1_name`/`team2_name`), tilføj en lille "Logo"-knap pr. hold der åbner en simpel vælger. Konkret: tilføj efter holdnavnene i headeren en knap:

```javascript
                    <button onclick="editHoldkampLogos(${teamMatch.id})" class="btn-secondary" style="font-size:0.8em; padding:4px 10px;">Logoer</button>
```
og tilføj funktionen (top-niveau):

```javascript
async function editHoldkampLogos(teamMatchId) {
    await ensureAdminLogos();
    const matches = await api.getActiveTeamMatches();
    const tm = (matches || []).find(m => m.id === teamMatchId);
    if (!tm) return;
    const opts = _adminLogoCache.map(l => `${l.id}: ${l.club_name}`).join('\n');
    const cur1 = tm.team1_logo_id || autoHoldkampLogoId(tm.team1_name) || '';
    const v1 = prompt(`Logo-id for ${tm.team1_name} (tom = auto):\n${opts}`, cur1);
    if (v1 === null) return;
    const cur2 = tm.team2_logo_id || autoHoldkampLogoId(tm.team2_name) || '';
    const v2 = prompt(`Logo-id for ${tm.team2_name} (tom = auto):`, cur2);
    if (v2 === null) return;
    await api.updateTeamMatchLogos(teamMatchId,
        v1 ? parseInt(v1, 10) : null,
        v2 ? parseInt(v2, 10) : null);
    await loadActiveHoldkamp();
}
```
(Enkelt prompt-baseret editor i denne omgang; en pænere modal kan komme senere.)

- [ ] **Step 7: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 8: Manuel verifikation (browser)** på `http://localhost/admin.html` → Holdkamp (Ctrl+F5), med logoer i biblioteket:
  - Opret-formen viser to logo-vælgere (Hold 1/Hold 2) fyldt med klubnavne.
  - Opret holdkamp "Lyngby 1" vs "Roskilde 2" uden at vælge logo → bagefter har holdkampen auto-matchede logo-id'er (tjek via `active-all` eller "Logoer"-knappen forvalg).
  - "Logoer"-knappen på aktiv holdkamp lader dig ændre logo-id pr. hold; ændringen gemmes.

- [ ] **Step 9: Commit**

```bash
git add frontend/admin.html frontend/admin-script.js
git commit -m @'
Logo del B: logo-vaelger i holdkamp (opret + rediger paa aktiv)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: Inline spiller-logo-override i turnering

**Files:**
- Modify: `frontend/admin.html` (sikre logo-match.js loaded — gjort i Task 5; bump admin-script version igen hvis nødvendigt)
- Modify: `frontend/admin-script.js` (tilføj "logo"-handling pr. spiller i turnerings-kampvisning)

**Interfaces:**
- Konsumerer: `api.getPublicLogos()`, `api.getPlayerLogos()`, `api.setPlayerLogo()`, `api.clearPlayerLogo()`, `window.LogoMatch.matchLogo`, og turneringens kamp-rendering (spillernavne `side1_player1` osv.).

- [ ] **Step 1: Find turneringens kamp-rendering i `frontend/admin-script.js`.** Lokalisér funktionen der renderer en turneringskamps spillernavne (søg efter `side1_player1` i admin-script.js). Tilføj ved hver spiller en lille klikbar "🏷"-knap der kalder `setTournamentPlayerLogo('<spillernavn>')`. Konkret: hvor et spillernavn skrives ud, tilføj efter navnet:

```javascript
`<button onclick="setTournamentPlayerLogo('${(playerName || '').replace(/'/g, "\\'")}')" class="btn-secondary" style="font-size:0.72em; padding:2px 6px; margin-left:4px;" title="Sæt klub-logo">🏷</button>`
```
(Indsæt for hver af de fire spiller-felter der har et reelt navn.)

- [ ] **Step 2: Tilføj handleren (top-niveau) i `frontend/admin-script.js`:**

```javascript
// Saet/ret en turneringsspillers klub-logo (gemmes pr. navn i player_logos -> slaar
// igennem alle kampe spilleren er i, og i Spiller info).
async function setTournamentPlayerLogo(playerName) {
    if (!playerName) return;
    await ensureAdminLogos();
    const existing = (await api.getPlayerLogos().catch(() => []))
        .find(p => p.player_name === playerName);
    const opts = _adminLogoCache.map(l => `${l.id}: ${l.club_name}`).join('\n');
    const cur = existing ? existing.logo_id : '';
    const v = prompt(`Logo-id for ${playerName} (tom = automatisk/ryd):\n${opts}`, cur);
    if (v === null) return;
    if (v.trim() === '') {
        await api.clearPlayerLogo(playerName);
    } else {
        await api.setPlayerLogo(playerName, parseInt(v, 10));
    }
    if (typeof loadActiveTournaments === 'function') await loadActiveTournaments();
}
```

- [ ] **Step 2b: Bump `admin-script.js?v=31` → `?v=32`** i `frontend/admin.html` (da admin-script.js ændres igen).

- [ ] **Step 3: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 4: Manuel verifikation (browser)** på `http://localhost/admin.html` → Turnering (Ctrl+F5), med en aktiv turnering der har kampe med spillernavne:
  - Hver spiller har en 🏷-knap. Klik → vælg logo-id → gemmes.
  - Verificér i Spiller info / `GET /api/player-logos` at samme spillernavn nu har override.
  - Sæt en anden kamp med samme spiller → samme override gælder (pr. navn).

- [ ] **Step 5: Commit**

```bash
git add frontend/admin.html frontend/admin-script.js
git commit -m @'
Logo del B: inline spiller-logo-override i turnering (gemmes pr. navn)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Afsluttende verifikation (hele del B)

- [ ] `GET /api/logos` offentlig; matcher fungerer (delvist match, længste vinder).
- [ ] Spiller info: auto-forvalg ud fra klub + manuel override gemt pr. navn.
- [ ] Holdkamp: pr.-hold logo (auto-forvalg ved oprettelse + redigerbar).
- [ ] Turnering: inline override pr. spiller, gemt pr. navn, slår igennem.
- [ ] Et nyt logo i biblioteket slår igennem auto-match uden at røre eksisterende (for spillere/hold uden gemt override).
- [ ] Merge `logo-del-b` → `main`:

```bash
git checkout main && git merge --no-ff logo-del-b -m @'
Merge: klub-logoer del B (matching + tildeling/overrides)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git push origin main
```

## Noter til Pi-deploy

Backend + frontend ændres → `git pull && docker-compose build backend frontend && docker-compose up -d backend frontend`. Migrationer 019/020 kører automatisk for alle aktive klub-DB'er. Visning ved kampene kommer i **del C**.
