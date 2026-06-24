# Klub-logoer C2 (individuelle/turnerings-spiller-logoer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vis klub-logoer pr. spiller i individuelle/turneringskampe på TV + Oversigt, med klubben fanget automatisk fra Tournament Software ved import.

**Architecture:** Tilgang A — import fanger `data-player-id`/`data-club-id` fra TS-kamplisten og slår klubnavn op via profilsider (én pr. distinkt klub), gemmer `name→club` i ny tabel `tournament_player_clubs`. Et samlet offentligt endpoint `GET /api/player-clubs` (union med `player_info`) + en delt `LogoMatch.resolvePlayerLogo` driver visning på TV og Oversigt. Override via eksisterende `player_logos`.

**Tech Stack:** Node.js (CommonJS), MySQL (`mysql2/promise`), vanilla JS frontend, Docker Compose. Ingen test-framework → manuel verificering (curl + browser). `node` findes kun i Docker → syntakstjek via `docker run --rm -v <backend>:/src badminton-app-backend node -c /src/...`.

## Global Constraints

- **Flader:** TV + Oversigt. **Ingen logoer på Court v3.**
- **Doubles:** ét logo pr. spiller (op til to pr. side), ud for hvert navn.
- **3-tilstands-override** (`player_logos`): `logo_id > 0` = bestemt, `0` = intet, ingen række = auto (klub→`matchLogo`). Override vinder altid over auto.
- **Konfliktregel i `/api/player-clubs`:** ved samme navn vinder `player_info` over `tournament_player_clubs`.
- **`clubByName` nøgles på `LogoMatch.normalizeName`** (symmetrisk i opbygning + opslag). `player_logos`-override matches på råt, trimmet navn.
- **Klub-opsamling er best-effort:** alt klub-arbejde er try/catch-isoleret — må aldrig vælte import eller server-opstart.
- **Ingen semikolon i `.sql`-kommentarer** (migration-runner splitter på `;`).
- **Gensidig udelukkelse på TV:** holdkamp-delkamp → hold-logoer (del C); ellers → spiller-logoer (C2). Aldrig begge.
- **PowerShell here-string-commits:** ingen `"` i commit-beskeder. **Commit-footer:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Branch:** `logo-c2`; merge til `main` til sidst. Checkpoint efter hver task.

## File Structure

- `backend/migrations/021_add_tournament_player_clubs.sql` — **Create.** Ny tabel.
- `backend/routes/importTournament.js` — **Modify.** Parser fanger playerId/clubId; `resolveClubNames` + `buildPlayerClubRows` + exports.
- `backend/routes/tournaments.js` — **Modify.** Kald klub-opsamling efter bulk-insert og i sync-import.
- `backend/routes/playerClubs.js` — **Create.** `GET /api/player-clubs`.
- `backend/server.js` — **Modify.** Mount `/api/player-clubs`.
- `frontend/js/logo-match.js` — **Modify.** `resolvePlayerLogo`.
- `frontend/js/api.js`, `frontend/js/api-v2.js` — **Modify.** `getPlayerClubs()`.
- `frontend/oversigt-script.js`, `frontend/oversigt-styles.css`, `frontend/oversigt.html` — **Modify.** Spiller-logoer i bane-kort.
- `frontend/tv-script-v3.js`, `frontend/tv-v3.html`, `frontend/tv-v3-styles.css` — **Modify.** Spiller-logoer pr. navn + gensidig udelukkelse med del C.

---

## Task 0: Opret feature-branch

- [ ] **Step 1: Rent træ + opret branch**

Run:
```bash
cd /c/Users/jespe/.local/bin/badminton-app && git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: rent træ, branch `main`.

Kør i PowerShell:
```
git checkout -b logo-c2
```
Expected: `Switched to a new branch 'logo-c2'`.

---

## Task 1: Migration — `tournament_player_clubs`

**Files:**
- Create: `backend/migrations/021_add_tournament_player_clubs.sql`

**Interfaces:**
- Produces: tabel `tournament_player_clubs (tournament_id, player_name, club, source_player_id)` i hver klub-DB. Task 2/3 skriver til den, Task 3's endpoint læser den.

- [ ] **Step 1: Skriv migrationen**

Opret `backend/migrations/021_add_tournament_player_clubs.sql`:

```sql
-- Migration 021: tournament_player_clubs
-- Gemmer klub pr spiller fanget ved TS-import saa auto-logo-resolution kan slaa op paa navn
CREATE TABLE IF NOT EXISTS tournament_player_clubs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  tournament_id INT NOT NULL,
  player_name VARCHAR(100) NOT NULL,
  club VARCHAR(100) NOT NULL,
  source_player_id VARCHAR(40) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_tournament_player (tournament_id, player_name),
  INDEX idx_player_name (player_name),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

(Ingen `;` i kommentarlinjerne — kun i selve statementet.)

- [ ] **Step 2: Commit**

Kør i PowerShell:
```
git add backend/migrations/021_add_tournament_player_clubs.sql
git commit -m @'
Logo C2: migration tournament_player_clubs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

(Migrationen verificeres ved deploy i Task 7 — runneren kører den mod alle klub-DB'er ved opstart.)

**Checkpoint.**

---

## Task 2: Import — fang playerId/clubId + slå klubnavn op

**Files:**
- Modify: `backend/routes/importTournament.js`

**Interfaces:**
- Consumes: eksisterende `fetchTournamentPage`, `decodeHtmlEntities`, `fetchAndParseTournamentMatches`.
- Produces (eksporteres):
  - hver parsed match får nu `side1: [{name, playerId, clubId}]` og `side2: [...]` (de eksisterende flade `side1Player1`…-felter bevares uændret).
  - `resolveClubNames(tournamentId, matches) -> Promise<Map<clubId, clubName>>`.
  - `buildPlayerClubRows(matches, clubIdToName) -> [{ player_name, club, source_player_id }]` (dedup pr. player_name).

- [ ] **Step 1: Udvid `extractPlayerNames` til også at returnere id'er**

I `backend/routes/importTournament.js`, erstat funktionen `extractPlayerNames` (linje ~260-269) med en ny der returnerer objekter, OG en bagudkompatibel wrapper. Find:

```javascript
function extractPlayerNames(section) {
    const names = [];
    const re = /data-player-id="\d+"[^>]*>\s*<span class="nav-link__value">\s*([^<]+?)\s*<\/span>/g;
    let m;
    while ((m = re.exec(section)) !== null) {
        const name = decodeHtmlEntities(m[1]).trim();
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}
```

Erstat med:

```javascript
// Træk spillere (navn + player-id + club-id) ud af en match__row-sektion.
// club-id kan være tom (=> ingen klub for spilleren).
function extractPlayers(section) {
    const players = [];
    const re = /data-player-id="(\d+)"[^>]*?data-club-id="(\d*)"[^>]*>\s*<span class="nav-link__value">\s*([^<]+?)\s*<\/span>/g;
    let m;
    while ((m = re.exec(section)) !== null) {
        const name = decodeHtmlEntities(m[3]).trim();
        if (name && !players.some(p => p.name === name)) {
            players.push({ name, playerId: m[1], clubId: m[2] || '' });
        }
    }
    return players;
}

// Bagudkompatibel: kun navne (bruges af den eksisterende flad-felt-mapping)
function extractPlayerNames(section) {
    return extractPlayers(section).map(p => p.name);
}
```

- [ ] **Step 2: Bær `side1`/`side2` spiller-objekter med i `parseMatchesHtml`**

I `parseMatchesHtml`, find (linje ~232-233):

```javascript
        const side1Players = extractPlayerNames(side1Section);
        const side2Players = extractPlayerNames(side2Section);
```

Erstat med:

```javascript
        const side1Full = extractPlayers(side1Section);
        const side2Full = extractPlayers(side2Section);
        const side1Players = side1Full.map(p => p.name);
        const side2Players = side2Full.map(p => p.name);
```

Og i det `matches.push({...})`-objekt (linje ~243-252), tilføj de to nye felter efter `side2Player2`:

```javascript
        matches.push({
            category,
            round,
            drawId,
            doubles: isDoubles,
            side1Player1: side1Players[0] || '',
            side1Player2: side1Players[1] || '',
            side2Player1: side2Players[0] || '',
            side2Player2: side2Players[1] || '',
            side1: side1Full,
            side2: side2Full
        });
```

- [ ] **Step 3: Tilføj `resolveClubNames` + `buildPlayerClubRows`**

Indsæt før `module.exports`-blokken nederst i filen:

```javascript
// Slå klubnavne op for de distinkte club-id'er i en turnerings kampe.
// TS' kampliste har kun club-id; klubnavnet hentes fra én repræsentativ
// spillers profilside pr. club-id. Returnerer Map<clubId, clubName>.
async function resolveClubNames(tournamentId, matches) {
    const repByClub = new Map(); // clubId -> playerId (én repræsentant)
    for (const m of matches) {
        for (const p of [...(m.side1 || []), ...(m.side2 || [])]) {
            if (p.clubId && p.playerId && !repByClub.has(p.clubId)) {
                repByClub.set(p.clubId, p.playerId);
            }
        }
    }

    const entries = [...repByClub.entries()];
    const results = await Promise.all(entries.map(async ([clubId, playerId]) => {
        try {
            const html = await fetchTournamentPage(tournamentId, `../../sport/player.aspx?id=${tournamentId}&player=${playerId}`);
            const m = html.match(/media__title--large[\s\S]*?nav-link__value">\s*([^<]+?)\s*</);
            const club = m ? decodeHtmlEntities(m[1]).trim() : '';
            return [clubId, club];
        } catch (e) {
            console.error(`Klubnavn-opslag fejlede for club-id ${clubId}:`, e.message);
            return [clubId, ''];
        }
    }));

    const map = new Map();
    for (const [clubId, club] of results) if (club) map.set(clubId, club);
    return map;
}

// Byg name->club-rækker (dedup pr. player_name) ud fra kampe + clubId->navn-map.
function buildPlayerClubRows(matches, clubIdToName) {
    const byName = new Map();
    for (const m of matches) {
        for (const p of [...(m.side1 || []), ...(m.side2 || [])]) {
            const club = p.clubId ? clubIdToName.get(p.clubId) : null;
            if (p.name && club && !byName.has(p.name)) {
                byName.set(p.name, { player_name: p.name, club, source_player_id: p.playerId || null });
            }
        }
    }
    return [...byName.values()];
}
```

> **Bemærk profilsti:** `fetchTournamentPage` bygger `${TS_BASE}/tournament/${tournamentId}/${subPage}`. Profilsiden ligger på `${TS_BASE}/sport/player.aspx`, så vi bruger `../../sport/player.aspx?...` som subPage for at nå ud af `/tournament/<id>/`. Verificér den faktiske URL i Task 7 (curl-agtig browser-test) — hvis stien fejler, peg i stedet `fetchTournamentPage` på en absolut URL via en lille hjælpe-variant.

- [ ] **Step 4: Eksportér de nye funktioner**

Nederst i filen, find:

```javascript
module.exports.fetchAndParseTournamentMatches = fetchAndParseTournamentMatches;
module.exports.extractTournamentId = extractTournamentId;
```

Tilføj under:

```javascript
module.exports.resolveClubNames = resolveClubNames;
module.exports.buildPlayerClubRows = buildPlayerClubRows;
```

- [ ] **Step 5: Syntakstjek**

Run:
```bash
docker run --rm -v "/c/Users/jespe/.local/bin/badminton-app/backend:/src" badminton-app-backend node -c /src/routes/importTournament.js && echo OK
```
Expected: `OK`. (Kør evt. via PowerShell hvis bash mangler docker-PATH.)

- [ ] **Step 6: Commit**

Kør i PowerShell:
```
git add backend/routes/importTournament.js
git commit -m @'
Logo C2: import fanger player/club-id og slaar klubnavn op

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 3: Klub-persistering + `GET /api/player-clubs`

**Files:**
- Modify: `backend/routes/tournaments.js`
- Create: `backend/routes/playerClubs.js`
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `resolveClubNames`, `buildPlayerClubRows`, `fetchAndParseTournamentMatches` fra Task 2; `query` fra `../config/database`.
- Produces: `GET /api/player-clubs` → `[{ name, club }]`.

- [ ] **Step 1: Hjælper til klub-opsamling i `tournaments.js`**

Øverst i `backend/routes/tournaments.js`, find importen (linje 5):

```javascript
const { fetchAndParseTournamentMatches } = require('./importTournament');
```

Erstat med:

```javascript
const { fetchAndParseTournamentMatches, resolveClubNames, buildPlayerClubRows } = require('./importTournament');
```

Indsæt en hjælpefunktion (efter require-blokken, før første `router.`):

```javascript
// Best-effort: hent klub pr. spiller fra TS og upsert i tournament_player_clubs.
// Må ALDRIG kaste videre — klub-logoer er sekundære ift. selve importen.
async function captureTournamentClubs(tournamentId, sourceTournamentId) {
    if (!sourceTournamentId) return;
    try {
        const { matches } = await fetchAndParseTournamentMatches(sourceTournamentId);
        const clubIdToName = await resolveClubNames(sourceTournamentId, matches);
        const rows = buildPlayerClubRows(matches, clubIdToName);
        for (const r of rows) {
            await query(
                `INSERT INTO tournament_player_clubs (tournament_id, player_name, club, source_player_id)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE club = VALUES(club), source_player_id = VALUES(source_player_id)`,
                [tournamentId, r.player_name, r.club, r.source_player_id]
            );
        }
        console.log(`✓ Klub-opsamling: ${rows.length} spiller-klubber for turnering ${tournamentId}`);
    } catch (e) {
        console.error(`Klub-opsamling fejlede for turnering ${tournamentId}:`, e.message);
    }
}
```

- [ ] **Step 2: Kald klub-opsamling efter bulk-insert**

I `router.post('/:id/matches/bulk', ...)`, find afslutningen (linje ~234):

```javascript
        res.json({ success: true, inserted });
```

Erstat med:

```javascript
        // Best-effort klub-opsamling hvis turneringen er TS-importeret (ikke-blokerende for svaret).
        const t = await queryOne('SELECT source_tournament_id FROM tournaments WHERE id = ?', [id]);
        if (t && t.source_tournament_id) {
            await captureTournamentClubs(id, t.source_tournament_id);
        }

        res.json({ success: true, inserted });
```

- [ ] **Step 3: Kald klub-opsamling i sync-import**

I `router.post('/:id/sync-import', ...)`, find linjen lige før svaret (linje ~308):

```javascript
        res.json({ updated, unchanged, skipped, newCandidates });
```

Erstat med:

```javascript
        await captureTournamentClubs(id, tournament.source_tournament_id);

        res.json({ updated, unchanged, skipped, newCandidates });
```

- [ ] **Step 4: Opret `GET /api/player-clubs`**

Opret `backend/routes/playerClubs.js`:

```javascript
const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// GET /api/player-clubs — samlet navn->klub (offentlig).
// Union af player_info og tournament_player_clubs. Ved navnekonflikt vinder
// player_info (manuelt kurateret).
router.get('/', async (req, res, next) => {
    try {
        const [info, tpc] = await Promise.all([
            query('SELECT name, club FROM player_info'),
            query('SELECT player_name AS name, club FROM tournament_player_clubs')
        ]);
        const byName = new Map();
        for (const r of tpc) if (r.name && r.club) byName.set(r.name, r.club);
        for (const r of info) if (r.name && r.club) byName.set(r.name, r.club); // player_info vinder
        res.json([...byName.entries()].map(([name, club]) => ({ name, club })));
    } catch (error) { next(error); }
});

module.exports = router;
```

- [ ] **Step 5: Mount endpointet**

I `backend/server.js`, find (linje 133-135):

```javascript
app.use('/api/player-info', require('./routes/playerInfo'));
app.use('/api/player-logos', require('./routes/playerLogos'));
app.use('/api/logos', require('./routes/logos'));
```

Tilføj under:

```javascript
app.use('/api/player-clubs', require('./routes/playerClubs'));
```

- [ ] **Step 6: Syntakstjek**

Run:
```bash
docker run --rm -v "/c/Users/jespe/.local/bin/badminton-app/backend:/src" badminton-app-backend sh -c "node -c /src/routes/tournaments.js && node -c /src/routes/playerClubs.js && node -c /src/server.js" && echo OK
```
Expected: `OK`.

- [ ] **Step 7: Commit**

Kør i PowerShell:
```
git add backend/routes/tournaments.js backend/routes/playerClubs.js backend/server.js
git commit -m @'
Logo C2: persister spiller-klubber og expose GET api player-clubs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 4: Delt resolver + API-klient

**Files:**
- Modify: `frontend/js/logo-match.js`
- Modify: `frontend/js/api.js`
- Modify: `frontend/js/api-v2.js`

**Interfaces:**
- Produces: `LogoMatch.resolvePlayerLogo(playerName, { playerLogos, clubByName, logos })`; `api.getPlayerClubs()` i begge klienter.

- [ ] **Step 1: `resolvePlayerLogo` i `logo-match.js`**

I `frontend/js/logo-match.js`, find (linje ~32-40):

```javascript
    // Udleder et holds logo: 0 = intet logo, >0 = bestemt logo, null/undefined = auto (matchLogo paa holdnavn)
    function resolveTeamLogo(teamMatch, n, logos) {
        if (!teamMatch) return null;
        const v = teamMatch['team' + n + '_logo_id'];
        if (v === 0) return null;
        if (v) return (logos || []).find(l => l.id === v) || null;
        return matchLogo(teamMatch['team' + n + '_name'], logos);
    }
    global.LogoMatch = { normalizeName, matchLogo, resolveTeamLogo };
```

Erstat med:

```javascript
    // Udleder et holds logo: 0 = intet logo, >0 = bestemt logo, null/undefined = auto (matchLogo paa holdnavn)
    function resolveTeamLogo(teamMatch, n, logos) {
        if (!teamMatch) return null;
        const v = teamMatch['team' + n + '_logo_id'];
        if (v === 0) return null;
        if (v) return (logos || []).find(l => l.id === v) || null;
        return matchLogo(teamMatch['team' + n + '_name'], logos);
    }
    // Udleder en spillers logo. Override (player_logos) vinder: 0 = intet, >0 = bestemt.
    // Ellers auto: spillerens klub (clubByName paa normaliseret navn) -> matchLogo.
    function resolvePlayerLogo(playerName, opts) {
        const o = opts || {};
        const raw = String(playerName || '').trim();
        if (!raw) return null;
        const ov = (o.playerLogos || []).find(p => p.player_name === raw);
        if (ov) {
            if (Number(ov.logo_id) === 0) return null;
            return (o.logos || []).find(l => l.id === Number(ov.logo_id)) || null;
        }
        const club = o.clubByName && o.clubByName[normalizeName(raw)];
        return club ? matchLogo(club, o.logos) : null;
    }
    global.LogoMatch = { normalizeName, matchLogo, resolveTeamLogo, resolvePlayerLogo };
```

- [ ] **Step 2: `getPlayerClubs()` i `js/api.js`**

I `frontend/js/api.js`, find (linje ~494-496):

```javascript
    async getPlayerLogos() {
        return this.request('/player-logos', { requiresAuth: false });
    }
```

Tilføj under:

```javascript
    async getPlayerClubs() {
        return this.request('/player-clubs', { requiresAuth: false });
    }
```

- [ ] **Step 3: `getPlayerClubs()` + `getPlayerLogos()` i `js/api-v2.js`**

I `frontend/js/api-v2.js`, find `getTeamMatchByCourt` (linje ~167) og tilføj efter dens afsluttende `}`:

```javascript
    async getPlayerLogos() {
        return this.request('/player-logos', { requiresAuth: false });
    }

    async getPlayerClubs() {
        return this.request('/player-clubs', { requiresAuth: false });
    }
```

- [ ] **Step 4: Commit**

Kør i PowerShell:
```
git add frontend/js/logo-match.js frontend/js/api.js frontend/js/api-v2.js
git commit -m @'
Logo C2: resolvePlayerLogo + getPlayerClubs i API-klienter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 5: Oversigt — spiller-logoer i bane-kort

**Files:**
- Modify: `frontend/oversigt-script.js`
- Modify: `frontend/oversigt-styles.css`
- Modify: `frontend/oversigt.html`

**Interfaces:**
- Consumes: `LogoMatch.resolvePlayerLogo`, `api.getPlayerLogos`, `api.getPlayerClubs`, eksisterende `_overviewLogos`.

- [ ] **Step 1: Cache spiller-lister ved init**

I `frontend/oversigt-script.js`, find (linje ~43):

```javascript
let _overviewLogos = []; // central logo-liste, hentet én gang ved init
```

Tilføj under:

```javascript
let _overviewPlayerLogos = []; // player_logos overrides
let _overviewClubByName = {};  // normaliseret spillernavn -> klub
```

Find i `initialize()` (linje ~312-321) blokken der henter logoer:

```javascript
        // Hent central logo-liste én gang (bruges til holdkamp-kort-headere)
        try {
            _overviewLogos = await api.getPublicLogos() || [];
        } catch (e) {
            _overviewLogos = [];
        }
```

Erstat med:

```javascript
        // Hent logo-relaterede lister én gang (holdkamp-headere + spiller-logoer)
        try {
            _overviewLogos = await api.getPublicLogos() || [];
        } catch (e) {
            _overviewLogos = [];
        }
        try {
            _overviewPlayerLogos = await api.getPlayerLogos() || [];
            const clubs = await api.getPlayerClubs() || [];
            _overviewClubByName = {};
            clubs.forEach(c => { if (c && c.name) _overviewClubByName[LogoMatch.normalizeName(c.name)] = c.club; });
        } catch (e) {
            _overviewPlayerLogos = [];
            _overviewClubByName = {};
        }
```

- [ ] **Step 2: Hjælper til spiller-logo-img + indsæt i navne**

I `frontend/oversigt-script.js`, find i `renderCourtCard` (linje ~679-687):

```javascript
    const player1Names = isDoubles && court.player1.name2
        ? `<div class="player-name">${escapeHtml(court.player1.name)}</div>
           <div class="player-name-partner">${escapeHtml(court.player1.name2)}</div>`
        : `<div class="player-name">${escapeHtml(court.player1.name)}</div>`;

    const player2Names = isDoubles && court.player2.name2
        ? `<div class="player-name">${escapeHtml(court.player2.name)}</div>
           <div class="player-name-partner">${escapeHtml(court.player2.name2)}</div>`
        : `<div class="player-name">${escapeHtml(court.player2.name)}</div>`;
```

Erstat med:

```javascript
    const plogo = (name) => {
        const logo = window.LogoMatch && LogoMatch.resolvePlayerLogo(name, {
            playerLogos: _overviewPlayerLogos, clubByName: _overviewClubByName, logos: _overviewLogos
        });
        return logo ? `<img class="player-logo" src="${escapeHtml(logo.url)}" alt="" onerror="this.style.display='none'">` : '';
    };
    const nameRow = (name) => `<div class="player-name-row">${plogo(name)}<div class="player-name">${escapeHtml(name)}</div></div>`;
    const partnerRow = (name) => `<div class="player-name-row">${plogo(name)}<div class="player-name-partner">${escapeHtml(name)}</div></div>`;

    const player1Names = isDoubles && court.player1.name2
        ? `${nameRow(court.player1.name)}${partnerRow(court.player1.name2)}`
        : nameRow(court.player1.name);

    const player2Names = isDoubles && court.player2.name2
        ? `${nameRow(court.player2.name)}${partnerRow(court.player2.name2)}`
        : nameRow(court.player2.name);
```

- [ ] **Step 3: CSS**

I `frontend/oversigt-styles.css`, tilføj i slutningen:

```css
/* Spiller-logo (individuelle/turneringskampe) ud for hvert navn */
.court-card .player-name-row {
    display: flex;
    align-items: center;
    gap: 0.6vw;
}
.court-card .player-logo {
    height: min(4.5vh, 3vw);
    width: auto;
    max-width: min(7vh, 4.5vw);
    object-fit: contain;
    flex-shrink: 0;
}
```

- [ ] **Step 4: Bump versioner i `oversigt.html`**

I `frontend/oversigt.html`, bump CSS + script. Find:

```html
    <link rel="stylesheet" href="oversigt-styles.css?v=21">
```
Erstat `?v=21` med `?v=22`.

Find:
```html
    <script src="oversigt-script.js?v=18"></script>
```
Erstat `?v=18` med `?v=19`.

- [ ] **Step 5: Commit**

Kør i PowerShell:
```
git add frontend/oversigt-script.js frontend/oversigt-styles.css frontend/oversigt.html
git commit -m @'
Logo C2: vis spiller-logoer i Oversigt bane-kort

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 6: TV — spiller-logoer pr. navn

**Files:**
- Modify: `frontend/tv-v3.html`
- Modify: `frontend/tv-v3-styles.css`
- Modify: `frontend/tv-script-v3.js`

**Interfaces:**
- Consumes: `LogoMatch.resolvePlayerLogo`, `api.getPlayerLogos`, `api.getPlayerClubs`, eksisterende `_tvLogos` + `updateTvTeamLogos`/`applyTvLogo` fra del C.

- [ ] **Step 1: Logo-img-elementer pr. spillernavn i `tv-v3.html`**

I `frontend/tv-v3.html`, find team1-rækkens navne (fra del C):

```html
                <div class="team-names">
                    <div class="player-name" id="player1Name">Spiller 1</div>
                    <div class="player-name partner-name" id="player1Name2" style="display: none;">Makker 1</div>
                </div>
```

Erstat med:

```html
                <div class="team-names">
                    <div class="tv-player-row"><img class="tv-player-logo" id="player1Logo" alt="" style="display:none;" onerror="this.style.display='none'"><div class="player-name" id="player1Name">Spiller 1</div></div>
                    <div class="tv-player-row"><img class="tv-player-logo" id="player1Logo2" alt="" style="display:none;" onerror="this.style.display='none'"><div class="player-name partner-name" id="player1Name2" style="display: none;">Makker 1</div></div>
                </div>
```

Find tilsvarende team2-blok:

```html
                <div class="team-names">
                    <div class="player-name" id="player2Name">Spiller 2</div>
                    <div class="player-name partner-name" id="player2Name2" style="display: none;">Makker 2</div>
                </div>
```

Erstat med:

```html
                <div class="team-names">
                    <div class="tv-player-row"><img class="tv-player-logo" id="player2Logo" alt="" style="display:none;" onerror="this.style.display='none'"><div class="player-name" id="player2Name">Spiller 2</div></div>
                    <div class="tv-player-row"><img class="tv-player-logo" id="player2Logo2" alt="" style="display:none;" onerror="this.style.display='none'"><div class="player-name partner-name" id="player2Name2" style="display: none;">Makker 2</div></div>
                </div>
```

- [ ] **Step 2: CSS i `tv-v3-styles.css`**

Tilføj i slutningen:

```css
/* Spiller-logo pr. navn (individuelle/turneringskampe) */
.tv-player-row {
    display: flex;
    align-items: center;
    gap: clamp(8px, 1vw, 24px);
}
.tv-player-logo {
    height: clamp(40px, 9vh, 130px);
    width: auto;
    max-width: clamp(50px, 10vw, 180px);
    object-fit: contain;
    flex-shrink: 0;
}
```

- [ ] **Step 3: Cache spiller-lister + udvid logo-opdatering i `tv-script-v3.js`**

I `frontend/tv-script-v3.js`, find (fra del C, linje ~19):

```javascript
// Hold-logoer (kun holdkamp): central logo-liste caches én gang
let _tvLogos = null;
```

Erstat med:

```javascript
// Logo-lister caches én gang (hold-logoer del C + spiller-logoer C2)
let _tvLogos = null;
let _tvPlayerLogos = null;
let _tvClubByName = null;
```

Find `updateTvTeamLogos` (fra del C) og erstat HELE funktionen med en udvidet version der både håndterer hold-logoer (holdkamp) og spiller-logoer (ellers), så by-court kun hentes én gang:

```javascript
// Vis hold-logoer (holdkamp) ELLER spiller-logoer (individuelle/turnering) — aldrig begge.
async function updateTvTeamLogos(gameState, isMatchActive) {
    const imgT1 = document.getElementById('team1Logo');
    const imgT2 = document.getElementById('team2Logo');
    const pImgs = {
        1: document.getElementById('player1Logo'),
        12: document.getElementById('player1Logo2'),
        2: document.getElementById('player2Logo'),
        22: document.getElementById('player2Logo2')
    };
    const hideAll = () => {
        applyTvLogo(imgT1, null); applyTvLogo(imgT2, null);
        Object.values(pImgs).forEach(el => applyTvLogo(el, null));
    };

    if (!isMatchActive || !window.LogoMatch) { hideAll(); return; }

    try {
        if (_tvLogos === null) _tvLogos = (await api.getPublicLogos()) || [];
        const byCourt = await api.getTeamMatchByCourt(courtId);

        // Bestem viste venstre/højre spiller (samme swap-logik som updatePlayerNames)
        const playersSwapped = originalPlayer1Name && gameState.player1.name === originalPlayer2Name;
        const left = playersSwapped ? gameState.player2 : gameState.player1;
        const right = playersSwapped ? gameState.player1 : gameState.player2;

        if (byCourt && byCourt.game) {
            // HOLDKAMP → hold-logoer (del C), skjul spiller-logoer
            Object.values(pImgs).forEach(el => applyTvLogo(el, null));
            const game = byCourt.game;
            let leftTeam = tvTeamForName(left.name, game) || tvTeamForName(left.name2, game);
            let rightTeam = leftTeam === 1 ? 2 : (leftTeam === 2 ? 1 : null);
            if (!leftTeam) {
                rightTeam = tvTeamForName(right.name, game) || tvTeamForName(right.name2, game);
                leftTeam = rightTeam === 1 ? 2 : (rightTeam === 2 ? 1 : 1);
                if (!rightTeam) rightTeam = 2;
            }
            applyTvLogo(imgT1, LogoMatch.resolveTeamLogo(byCourt, leftTeam, _tvLogos));
            applyTvLogo(imgT2, LogoMatch.resolveTeamLogo(byCourt, rightTeam, _tvLogos));
            return;
        }

        // INDIVIDUEL/TURNERING → spiller-logoer, skjul hold-logoer
        applyTvLogo(imgT1, null); applyTvLogo(imgT2, null);
        if (_tvPlayerLogos === null) _tvPlayerLogos = (await api.getPlayerLogos()) || [];
        if (_tvClubByName === null) {
            const clubs = (await api.getPlayerClubs()) || [];
            _tvClubByName = {};
            clubs.forEach(c => { if (c && c.name) _tvClubByName[LogoMatch.normalizeName(c.name)] = c.club; });
        }
        const opts = { playerLogos: _tvPlayerLogos, clubByName: _tvClubByName, logos: _tvLogos };
        applyTvLogo(pImgs[1], LogoMatch.resolvePlayerLogo(left.name, opts));
        applyTvLogo(pImgs[12], LogoMatch.resolvePlayerLogo(left.name2, opts));
        applyTvLogo(pImgs[2], LogoMatch.resolvePlayerLogo(right.name, opts));
        applyTvLogo(pImgs[22], LogoMatch.resolvePlayerLogo(right.name2, opts));
    } catch (e) {
        hideAll();
    }
}
```

(Funktionen kaldes allerede fra `loadCourtData` i del C — ingen ny kald nødvendig.)

- [ ] **Step 4: Bump versioner i `tv-v3.html`**

Find og bump:
- `tv-v3-styles.css?v=11` → `?v=12`
- `tv-script-v3.js?v=14` → `?v=15`

(`js/logo-match.js?v=1` og `js/api-v2.js?v=2` er allerede med fra del C — uændret.)

- [ ] **Step 5: Commit**

Kør i PowerShell:
```
git add frontend/tv-v3.html frontend/tv-v3-styles.css frontend/tv-script-v3.js
git commit -m @'
Logo C2: vis spiller-logoer paa TV (gensidig udelukkelse med holdkamp)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

**Checkpoint.**

---

## Task 7: Deploy og verificér

**Files:** ingen kodeændringer.

- [ ] **Step 1: Byg og genstart**

Kør i PowerShell:
```
docker-compose build backend frontend
docker-compose up -d backend frontend
docker logs badminton-backend --tail 12
```
Expected: ren opstart, `✓ Database migrationer gennemført` (migration 021 kørt).

- [ ] **Step 2: Verificér migration + endpoint**

Run:
```bash
docker exec badminton-mysql sh -lc 'echo "SHOW TABLES LIKE \"tournament_player_clubs\";" | mysql -ubadminton_user -p"$MYSQL_PASSWORD" <en klub-DB>' 2>/dev/null || echo "tjek manuelt"
curl -s http://localhost/api/player-clubs | head -c 300; echo
```
Expected: tabellen findes; `/api/player-clubs` returnerer `[]` eller en liste (HTTP 200, gyldig JSON).

- [ ] **Step 3: Importér en turnering og verificér klub-opsamling**

Importér en TS-turnering via admin-UI'et (browser). Tjek backend-loggen:
```bash
docker logs badminton-backend --tail 20 | grep -i "klub-opsamling"
```
Expected: `✓ Klub-opsamling: N spiller-klubber for turnering <id>`.

Run:
```bash
curl -s http://localhost/api/player-clubs | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('antal navn->klub:',a.length);console.log('eksempel:',JSON.stringify(a[0]))})" 2>/dev/null || curl -s http://localhost/api/player-clubs | head -c 300
```
Expected: antal > 0, eksempel har `{name, club}`.

- [ ] **Step 4: Browser-verificering (acceptkriterier fra spec §10)**

Brugeren bekræfter i browseren:
- Single-kamp: TV + Oversigt viser hver spillers klub-logo (når klubben har bibliotekslogo).
- Double-kamp: op til to logoer pr. side (ét pr. spiller), korrekt klub.
- Spiller sat til "intet logo" (override 0) → intet logo. Bestemt override → valgt logo.
- Holdkamp: uændret (hold-logoer, ingen spiller-logoer).
- Court v3: ingen spiller-logoer.

**Checkpoint:** derefter merge `logo-c2` → `main` via **superpowers:finishing-a-development-branch** (merge --no-ff, slet branch).

---

## Self-Review (udført)

**1. Spec coverage:**
- §5 datamodel → Task 1 (tabel) + Task 3 (endpoint). §6 import-opsamling → Task 2 (parser/resolveClubNames/buildPlayerClubRows) + Task 3 (captureTournamentClubs i bulk+sync). §7 resolver → Task 4. §8 visning TV+Oversigt → Task 5 + Task 6. §8.3 Court v3 uændret → ingen task (bevidst). §9 edge-cases → try/catch i Task 2/3 + `onerror`/null i Task 4-6. §10 verificering → Task 7. Alle dækket.

**2. Placeholder-scan:** ingen TBD/TODO; al kode er fuldt udskrevet. Ét eksplicit verificeringspunkt (profil-URL-stien i Task 2 Step 3) er markeret som noget der bekræftes i Task 7, med fallback angivet.

**3. Type/navne-konsistens:** `resolvePlayerLogo`, `getPlayerClubs`, `_tvPlayerLogos`/`_tvClubByName`, `_overviewPlayerLogos`/`_overviewClubByName`, `captureTournamentClubs`, `resolveClubNames`, `buildPlayerClubRows`, `tournament_player_clubs` bruges konsistent på tværs af tasks. `clubByName` nøgles på `normalizeName` både ved opbygning (Task 5/6) og opslag (Task 4).
