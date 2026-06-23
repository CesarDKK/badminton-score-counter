# Klub-logoer Del C (visning) — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vis holdkamp-team-logoer fremtrædende på Oversigt og TV (ikke Court v3, ikke individuelle/turnerings-spillere).

**Architecture:** En delt `LogoMatch.resolveTeamLogo` udleder et holds logo (override 0=intet / >0=bestemt / null=auto via navne-matcher) fra den offentlige logo-liste. Oversigt-kortene og TV henter listen én gang og viser de to hold-logoer; TV henter desuden `by-court` for at kende holdkampen og mappe venstre/højre via spillernavn.

**Tech Stack:** Node/Express, vanilla JS frontend (oversigt: `js/api.js`; TV: `js/api-v2.js`), Docker Compose.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-23-logo-bibliotek-del-c-design.md`.
- **Kun holdkamp-team-logoer.** Ingen logoer på Court v3. Ingen individuelle/turnerings-spiller-logoer (= senere C2).
- **Flader:** Oversigt + TV.
- **Tre tilstande pr. hold:** `teamN_logo_id` 0=intet logo, >0=bestemt logo, null/undefined=auto (`matchLogo(teamN_name)`).
- **Genbrug:** `window.LogoMatch.matchLogo(name, logos)` og (ny) `window.LogoMatch.resolveTeamLogo(teamMatch, n, logos)`. `api.getPublicLogos()` returnerer `[{id, club_name, aliases, url, width, height}]`.
- **Verificering: manuel** (browser). INGEN ny test-infra.
- **Cache logo-listen** pr. side-load; undgå flicker (skift kun `src`/visning når værdien ændrer sig).
- **Deploy lokalt:** backend (by-court) + frontend ændres → `docker-compose build backend frontend && docker-compose up -d backend frontend`. Bump `?v=` på ændrede JS/CSS-filer i deres HTML.
- **Commit-beskeder:** INGEN dobbelte anførselstegn (PowerShell here-string); afslut med `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Git:** feature-branch `logo-del-c`, merge til main til sidst.

---

## Task 1: Resolver + by-court logo-felter

**Files:**
- Modify: `frontend/js/logo-match.js` (tilføj `resolveTeamLogo`)
- Modify: `backend/routes/teamMatches.js` (`/by-court/:courtId` SELECT)

**Interfaces:**
- Producerer `window.LogoMatch.resolveTeamLogo(teamMatch, n, logos) -> logo|null` (n = 1 eller 2).
- `GET /api/team-matches/by-court/:courtId` returnerer nu også `team1_logo_id`, `team2_logo_id` på teamMatch-objektet.

- [ ] **Step 1: Opret feature-branch**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && git checkout -b logo-del-c
```

- [ ] **Step 2: Tilføj `resolveTeamLogo` i `frontend/js/logo-match.js`.** Find linjen `global.LogoMatch = { normalizeName, matchLogo };` og erstat med:

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

- [ ] **Step 3: Medtag logo-felter i `/by-court` i `backend/routes/teamMatches.js`.** Find teamMatch-opslaget i `/by-court/:courtId`:

```javascript
        const teamMatch = await queryOne(
            `SELECT id, format, team1_name, team2_name, status, created_at
             FROM team_matches WHERE id = ?`,
            [game.team_match_id]
        );
```
Erstat SELECT-linjen med:

```javascript
        const teamMatch = await queryOne(
            `SELECT id, format, team1_name, team2_name, team1_logo_id, team2_logo_id, status, created_at
             FROM team_matches WHERE id = ?`,
            [game.team_match_id]
        );
```

- [ ] **Step 4: Deploy backend + frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend frontend && docker-compose up -d backend frontend
```
Forventet: ren backend-opstart (`docker logs badminton-backend --tail 8`).

- [ ] **Step 5: Manuel verifikation**

```bash
# by-court returnerer logo-felter NAAR en delkamp er aktiv paa en bane.
# Hvis ingen aktiv delkamp lige nu, verificeres feltet i Task 3 (TV) browser-test.
curl -s http://localhost/api/team-matches/by-court/1; echo
```
Forventet: enten `null` (ingen aktiv delkamp på bane 1) eller et objekt der indeholder `team1_logo_id`/`team2_logo_id`. `resolveTeamLogo` testes hvor den bruges (Task 2/3).

- [ ] **Step 6: Commit**

```bash
git add frontend/js/logo-match.js backend/routes/teamMatches.js
git commit -m @'
Logo del C: resolveTeamLogo + by-court returnerer team-logo-felter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: Team-logoer på Oversigt holdkamp-kort

**Files:**
- Modify: `frontend/oversigt.html` (load `js/logo-match.js`; bump versioner)
- Modify: `frontend/oversigt-script.js` (hent logoer; render i kort-header)
- Modify: `frontend/oversigt-styles.css` (logo-styling)

**Interfaces:**
- Konsumerer: `api.getPublicLogos()`, `window.LogoMatch.resolveTeamLogo`.

- [ ] **Step 1: Load `logo-match.js` + bump versioner i `frontend/oversigt.html`.** Find script-linjerne i bunden:

```html
    <script src="js/api.js?v=3"></script>
    <script src="oversigt-script.js?v=17"></script>
```
Erstat med (verificér de aktuelle v-numre først; bump begge + indsæt logo-match):

```html
    <script src="js/api.js?v=3"></script>
    <script src="js/logo-match.js?v=1"></script>
    <script src="oversigt-script.js?v=18"></script>
```
Og bump CSS i toppen: `oversigt-styles.css?v=NN` → næste nummer.

- [ ] **Step 2: Tilføj logo-cache + hent ved init i `frontend/oversigt-script.js`.** Find `let activeTeamMatches = [];` (nær toppen) og indsæt efter:

```javascript
let _overviewLogos = [];
```
I `initialize()`, lige før `await loadHoldkamp();`, indsæt:

```javascript
        _overviewLogos = await api.getPublicLogos().catch(() => []);
```

- [ ] **Step 3: Render team-logoer i kort-headeren i `renderHoldkampCards`.** Erstat kort-retur-blokken:

```javascript
        return `<div class="hk-card" data-match-id="${tm.id}">
            <div class="hk-card-header">
                <span class="t1">${escapeHtml(tm.team1_name)}</span>
                <span class="sc">${t1w} – ${t2w}</span>
                <span class="t2">${escapeHtml(tm.team2_name)}</span>
            </div>
            <div class="hk-games" style="grid-template-columns: repeat(${cols}, 1fr); --hk-rows:${rows};">${cells}</div>
        </div>`;
```
med:

```javascript
        const l1 = window.LogoMatch.resolveTeamLogo(tm, 1, _overviewLogos);
        const l2 = window.LogoMatch.resolveTeamLogo(tm, 2, _overviewLogos);
        const l1img = l1 ? `<img class="hk-card-logo" src="${l1.url}" alt="" onerror="this.style.display='none'">` : '';
        const l2img = l2 ? `<img class="hk-card-logo" src="${l2.url}" alt="" onerror="this.style.display='none'">` : '';
        return `<div class="hk-card" data-match-id="${tm.id}">
            <div class="hk-card-header">
                ${l1img}
                <span class="t1">${escapeHtml(tm.team1_name)}</span>
                <span class="sc">${t1w} – ${t2w}</span>
                <span class="t2">${escapeHtml(tm.team2_name)}</span>
                ${l2img}
            </div>
            <div class="hk-games" style="grid-template-columns: repeat(${cols}, 1fr); --hk-rows:${rows};">${cells}</div>
        </div>`;
```

- [ ] **Step 4: Tilføj logo-styling i `frontend/oversigt-styles.css`.** Find blokken `#holdkampCardsGrid .hk-card-header {` og indsæt efter den (eller ved de øvrige hk-card-header-regler):

```css
#holdkampCardsGrid .hk-card-logo {
    height: min(8vh, 5vw);
    width: auto;
    max-width: 18%;
    object-fit: contain;
    align-self: center;
    flex-shrink: 0;
}
```

- [ ] **Step 5: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 6: Manuel verifikation (browser)** på `http://localhost/oversigt.html` (Ctrl+F5). Kræver en aktiv holdkamp hvor begge klubber har et logo i biblioteket (auto-match på holdnavn eller sat i del B):
  - Holdkamp-kortets header viser team1-logo til venstre og team2-logo til højre, fremtrædende.
  - Et hold sat til "intet logo" viser intet; et hold uden match viser intet (ingen fejl).
  - Live-score opdateres fortsat (logoerne forsvinder ikke ved patch).

- [ ] **Step 7: Commit**

```bash
git add frontend/oversigt.html frontend/oversigt-script.js frontend/oversigt-styles.css
git commit -m @'
Logo del C: team-logoer i Oversigt holdkamp-kort

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: Team-logoer på TV

**Files:**
- Modify: `frontend/js/api-v2.js` (tilføj `getPublicLogos`, `getTeamMatchByCourt`)
- Modify: `frontend/tv-v3.html` (load `js/logo-match.js`; logo-img i team-rows; bump tv-script-version)
- Modify: `frontend/tv-script-v3.js` (hent logoer + by-court i poll; map side; vis logo)
- Modify: `frontend/tv-v3-styles.css` (logo-styling) — eller inline hvis stylesheet ikke findes (se Step 4)

**Interfaces:**
- Konsumerer: `api.getGameState` (eksisterende), nye `api.getPublicLogos()`/`api.getTeamMatchByCourt(courtId)`, `window.LogoMatch.resolveTeamLogo`.

- [ ] **Step 1: Tilføj logo-metoder i `frontend/js/api-v2.js`.** Find `async getGameState(courtId) {` og indsæt FØR den:

```javascript
    /** Offentlig liste over centrale klub-logoer */
    async getPublicLogos() {
        return this.request('/logos', { requiresAuth: false });
    }

    /** Aktiv delkamp + holdkamp paa en bane (eller null) */
    async getTeamMatchByCourt(courtId) {
        return this.request(`/team-matches/by-court/${courtId}`, { requiresAuth: false });
    }
```

- [ ] **Step 2: Load `logo-match.js` + logo-img i team-rows + bump version i `frontend/tv-v3.html`.**
  (a) I `#team1Row` indsæt et logo-element som første barn (før `.team-names`):

```html
                <img id="team1Logo" class="tv-team-logo" alt="" style="display:none;">
```
  (b) I `#team2Row` indsæt tilsvarende som første barn:

```html
                <img id="team2Logo" class="tv-team-logo" alt="" style="display:none;">
```
  (c) Tilføj `logo-match.js` og bump tv-script i script-blokken:

```html
    <script src="js/api-v2.js"></script>
    <script src="js/auth-guard.js?v=2"></script>
    <script src="js/logo-match.js?v=1"></script>
    <script src="tv-script-v3.js?v=14"></script>
```

- [ ] **Step 3: Tilføj logo-logik i `frontend/tv-script-v3.js`.** Tilføj et top-niveau cache-felt nær toppen (fx efter `const courtId = ...`):

```javascript
let _tvLogos = null;
```
Tilføj funktionen (top-niveau):

```javascript
// Viser de to hold-logoer paa TV ud fra holdkampen paa banen. Mapper TV'ets
// player1 (team1Row) / player2 (team2Row) til team1/team2 via spillernavn.
async function updateTvTeamLogos(gameState, isMatchActive) {
    const img1 = document.getElementById('team1Logo');
    const img2 = document.getElementById('team2Logo');
    if (!img1 || !img2) return;

    const hide = () => { img1.style.display = 'none'; img2.style.display = 'none'; };
    if (!isMatchActive) return hide();

    try {
        if (_tvLogos === null) _tvLogos = await api.getPublicLogos().catch(() => []);
        const byCourt = await api.getTeamMatchByCourt(courtId).catch(() => null);
        if (!byCourt || !byCourt.game) return hide();

        const g = byCourt.game;
        const p1 = gameState.player1 || {};
        const t1names = [g.team1_player1, g.team1_player2].filter(Boolean);
        const p1IsTeam1 = t1names.some(nm => nm === p1.name || nm === p1.name2);
        const topN = p1IsTeam1 ? 1 : 2;   // team1Row = TV player1
        const botN = p1IsTeam1 ? 2 : 1;   // team2Row = TV player2

        const top = window.LogoMatch.resolveTeamLogo(byCourt, topN, _tvLogos);
        const bot = window.LogoMatch.resolveTeamLogo(byCourt, botN, _tvLogos);
        applyTvLogo(img1, top);
        applyTvLogo(img2, bot);
    } catch (e) {
        hide();
    }
}

function applyTvLogo(img, logo) {
    if (logo && logo.url) {
        if (img.getAttribute('src') !== logo.url) img.src = logo.url;
        img.style.display = '';
        img.onerror = () => { img.style.display = 'none'; };
    } else {
        img.style.display = 'none';
    }
}
```

- [ ] **Step 4: Kald `updateTvTeamLogos` i `loadCourtData`.** I `frontend/tv-script-v3.js`, i `loadCourtData`, lige efter `isMatchCurrentlyActive = isMatchActive && hasGameActivity;` (linje ~152), indsæt:

```javascript
        updateTvTeamLogos(gameState, isMatchActive);
```
(Ikke awaited — kører ved siden af; opdaterer logo-billederne idempotent.)

- [ ] **Step 5: Tilføj logo-styling.** Tjek om `frontend/tv-v3.html` linker et stylesheet (fx `tv-v3-styles.css` / `tv-styles.css`). Tilføj reglen i det linkede stylesheet:

```css
.tv-team-logo {
    height: min(14vh, 10vw);
    width: auto;
    max-width: 22vw;
    object-fit: contain;
    margin-right: 2vw;
    flex-shrink: 0;
}
```
Hvis `.team-row` ikke allerede er `display:flex; align-items:center`, så tilføj det til `.team-row` så logoet står pænt ved siden af navne/sætbokse:

```css
.team-row { display: flex; align-items: center; }
```
(Verificér eksisterende `.team-row`-regel først og justér kun hvis nødvendigt, så layoutet ikke brydes.)

- [ ] **Step 6: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 7: Manuel verifikation (browser)** — åbn `http://localhost/tv-v3.html?id=<bane>` for en bane hvor en holdkamp-delkamp er i gang og klubberne har logoer:
  - De to hold-logoer vises fremtrædende ved hver team-row.
  - Korrekt logo pr. side, også efter side-skift (skift side på Court v3 og se TV opdatere).
  - Bane uden holdkamp (turnering/individuel/tom) viser ingen logoer.

- [ ] **Step 8: Commit**

```bash
git add frontend/js/api-v2.js frontend/tv-v3.html frontend/tv-script-v3.js frontend/tv-v3-styles.css
git commit -m @'
Logo del C: team-logoer paa TV (by-court + side-mapping via navn)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```
(Tilføj kun de stylesheet-filer du faktisk ændrede.)

---

## Afsluttende verifikation (hele del C)

- [ ] Oversigt: holdkamp-kort viser begge hold-logoer (auto/bestemt), intet ved "intet logo"/intet match.
- [ ] TV: holdkamp-delkamp viser de to hold-logoer, korrekt side efter side-skift.
- [ ] Court v3 viser ingen logoer (uændret).
- [ ] Turnering/individuel viser ingen logoer (C2 senere).
- [ ] Merge `logo-del-c` → `main`:

```bash
git checkout main && git merge --no-ff logo-del-c -m @'
Merge: klub-logoer del C (visning af holdkamp-team-logoer paa Oversigt + TV)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
git push origin main
```

## Noter til Pi-deploy

Backend (by-court) + frontend ændres → `git pull && docker-compose build backend frontend && docker-compose up -d backend frontend`.
