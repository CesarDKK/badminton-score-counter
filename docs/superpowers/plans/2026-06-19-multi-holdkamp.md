# Flere samtidige holdkampe — Implementeringsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tillad 2-3 holdkampe at køre samtidig i badminton-appen — oprettelse, banetildeling, Court v3-valg og live Oversigt.

**Architecture:** DB-skemaet bærer allerede flere `status='active'` holdkampe; vi fjerner applikationskodens "kun én aktiv"-antagelser. Ny backend: `GET /team-matches/active-all` + `GET /team-matches/by-court/:courtId` + en cross-match bane-guard. Frontend: admin lister alle aktive, Court v3 får to-trins valg (holdkamp→delkamp) via by-court, Oversigt viser 50/50-kort med live patch-opdatering.

**Tech Stack:** Node.js/Express backend (mysql2 via `query`/`queryOne`), vanilla JS frontend, Nginx, Docker Compose. Spec: `docs/superpowers/specs/2026-06-19-multi-holdkamp-design.md`.

## Global Constraints

- **Verificering: manuel** (deploy lokalt + test i browser). INGEN ny test-infrastruktur, INGEN automatiserede tests. (Spec §2.5)
- **Ingen DB-migration** — skemaet er uændret. (Spec §4)
- **Turnering ↔ holdkamp forbliver gensidigt blokerende** — rør IKKE tournament-409-tjekket i `POST /team-matches`. (Spec §2.1)
- **Bane-konflikt = valg B:** gen-tildeling kun tilladt hvis siddende delkamp ikke er i gang (`score/games/timer == 0`), ellers 409. (Spec §2.4)
- **"I gang"-definition** (identisk frontend+backend): `player1_score>0 || player2_score>0 || player1_games>0 || player2_games>0 || timer_seconds>0`.
- **Behold `GET /team-matches/active`** indtil alle kald er migreret (bagudkompatibilitet).
- **Cache-busting:** bump `?v=` på hver ændret JS-fil i dens HTML-reference.
- **Deploy lokalt:** backend-ændringer kræver `docker-compose build backend frontend && docker-compose up -d backend frontend`; rene frontend-ændringer kun `frontend`.
- **Commit-beskeder:** ingen dobbelte anførselstegn (PowerShell here-string brydes ellers); afslut med `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Arbejdsmappe for git: `C:\Users\jespe\.local\bin\badminton-app`.

---

## FASE 1 — Backend

### Task 1: Læse-endpoints (`active-all`, `by-court`) + API-klient

**Files:**
- Modify: `backend/routes/teamMatches.js` (indsæt efter `GET /active`, ~linje 61)
- Modify: `frontend/js/api.js` (Team Matches-sektionen, ~linje 621-668)

**Interfaces:**
- Producerer backend: `GET /api/team-matches/active-all` → `Array<{id, format, team1_name, team2_name, status, created_at, games: Game[]}>` (tom array hvis ingen). `GET /api/team-matches/by-court/:courtId` → `{...teamMatch, game: Game} | null` hvor `game` er den aktive delkamp på banen.
- Producerer frontend: `api.getActiveTeamMatches(): Promise<Array>`, `api.getTeamMatchByCourt(courtId): Promise<object|null>`.
- `Game` = `{id, game_number, category, team1_player1, team1_player2, team2_player1, team2_player2, court_number, status, winner_team, set_scores}`.

- [ ] **Step 1: Indsæt de to endpoints i `backend/routes/teamMatches.js`** efter linjen `});` der afslutter `GET /active` ( caa. linje 61), før kommentaren `// POST /api/team-matches`:

```javascript
// GET /api/team-matches/active-all - Alle aktive holdkampe med delkampe (public)
router.get('/active-all', async (req, res, next) => {
    try {
        const teamMatches = await query(
            `SELECT id, format, team1_name, team2_name, status, created_at
             FROM team_matches WHERE status = 'active'
             ORDER BY created_at ASC`
        );

        const result = [];
        for (const tm of teamMatches) {
            const games = await query(
                `SELECT id, game_number, category,
                        team1_player1, team1_player2, team2_player1, team2_player2,
                        court_number, status, winner_team, set_scores
                 FROM team_match_games
                 WHERE team_match_id = ?
                 ORDER BY game_number ASC`,
                [tm.id]
            );
            result.push({ ...tm, games });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/team-matches/by-court/:courtId - Den aktive delkamp på en bane + dens holdkamp (public)
router.get('/by-court/:courtId', async (req, res, next) => {
    try {
        const courtNumber = parseInt(req.params.courtId, 10);
        if (!courtNumber) return res.json(null);

        const game = await queryOne(
            `SELECT g.id, g.team_match_id, g.game_number, g.category,
                    g.team1_player1, g.team1_player2, g.team2_player1, g.team2_player2,
                    g.court_number, g.status, g.winner_team, g.set_scores
             FROM team_match_games g
             JOIN team_matches tm ON tm.id = g.team_match_id
             WHERE g.court_number = ? AND g.status = 'active' AND tm.status = 'active'
             LIMIT 1`,
            [courtNumber]
        );
        if (!game) return res.json(null);

        const teamMatch = await queryOne(
            `SELECT id, format, team1_name, team2_name, status, created_at
             FROM team_matches WHERE id = ?`,
            [game.team_match_id]
        );
        if (!teamMatch) return res.json(null);

        res.json({ ...teamMatch, game });
    } catch (error) {
        next(error);
    }
});
```

- [ ] **Step 2: Tilføj API-klient-metoder i `frontend/js/api.js`** lige efter `getActiveTeamMatch()`:

```javascript
/** Get ALL active team matches with games */
async getActiveTeamMatches() {
    return this.request('/team-matches/active-all');
}

/** Get the active game on a given court (+ its team match), or null */
async getTeamMatchByCourt(courtId) {
    return this.request(`/team-matches/by-court/${courtId}`);
}
```

- [ ] **Step 3: Deploy backend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend && docker-compose up -d backend
```
Forventet: backend starter, ingen fejl i `docker logs badminton-backend --tail 10`.

- [ ] **Step 4: Manuel verifikation (curl)**

```bash
curl -s http://localhost/api/team-matches/active-all
curl -s http://localhost/api/team-matches/by-court/1
```
Forventet: `active-all` returnerer `[]` (eller array af aktive holdkampe). `by-court/1` returnerer `null` (ingen aktiv kamp på bane 1) — begge uden serverfejl.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teamMatches.js frontend/js/api.js
git commit -m @'
Backend: active-all og by-court endpoints til flere holdkampe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 2: Skrive-sti — fjern auto-afslut + cross-match bane-guard

**Files:**
- Modify: `backend/routes/teamMatches.js` (`POST /` ~linje 82-83; `PUT /:id/games/:gameId` ~linje 131-145)

**Interfaces:**
- Konsumerer: `query`, `queryOne` fra `../config/database` (allerede importeret).
- Ændrer adfærd: `POST /` afslutter IKKE længere andre aktive holdkampe. `PUT /:id/games/:gameId` afviser 409 hvis banen er optaget af en igangværende delkamp i en anden holdkamp; frigør ellers den ikke-startede delkamp.

- [ ] **Step 1: Fjern auto-afslutningen i `POST /`.** Slet disse to linjer (~82-83):

```javascript
        // Mark any existing active matches as finished
        await query(`UPDATE team_matches SET status = 'finished' WHERE status = 'active'`);
```
(Behold tournament-tjekket ovenfor uændret.)

- [ ] **Step 2: Erstat court-frigørelses-blokken i `PUT /:id/games/:gameId`.** Find blokken (~131-145):

```javascript
        if (courtNumber !== undefined) {
            // Frigør banen fra enhver anden delkamp i samme holdkamp så den gamle
            // kamp bliver tilgængelig igen hvis brugeren har valgt forkert. Status
            // skal også tilbage til 'pending' så den vises i andre baners vælger.
            if (courtNumber !== null) {
                await query(
                    `UPDATE team_match_games
                     SET court_number = NULL, status = 'pending'
                     WHERE team_match_id = ? AND court_number = ? AND id != ? AND status != 'finished'`,
                    [id, courtNumber, gameId]
                );
            }
            fields.push('court_number = ?');
            values.push(courtNumber);
        }
```

Erstat med (cross-match guard, valg B):

```javascript
        if (courtNumber !== undefined) {
            if (courtNumber !== null) {
                // Find enhver ANDEN aktiv delkamp på samme bane — også i andre holdkampe.
                const occupant = await queryOne(
                    `SELECT g.id, g.team_match_id
                     FROM team_match_games g
                     JOIN team_matches tm ON tm.id = g.team_match_id
                     WHERE g.court_number = ? AND g.status = 'active'
                       AND tm.status = 'active' AND g.id != ?`,
                    [courtNumber, gameId]
                );

                if (occupant) {
                    // Er banen i gang? (samme definition som admin-dropdownen)
                    const gs = await queryOne(
                        `SELECT gs.player1_score, gs.player2_score,
                                gs.player1_games, gs.player2_games, gs.timer_seconds
                         FROM courts c
                         JOIN game_states gs ON c.id = gs.court_id
                         WHERE c.court_number = ?`,
                        [courtNumber]
                    );
                    const inProgress = gs && (
                        gs.player1_score > 0 || gs.player2_score > 0 ||
                        gs.player1_games > 0 || gs.player2_games > 0 ||
                        gs.timer_seconds > 0
                    );
                    if (inProgress) {
                        return res.status(409).json({
                            error: 'Bane optaget — der spilles allerede en kamp på denne bane.'
                        });
                    }
                    // Ikke startet: frigør den siddende delkamp (uanset holdkamp).
                    await query(
                        `UPDATE team_match_games SET court_number = NULL, status = 'pending'
                         WHERE id = ?`,
                        [occupant.id]
                    );
                }
            }
            fields.push('court_number = ?');
            values.push(courtNumber);
        }
```

- [ ] **Step 3: Deploy backend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build backend && docker-compose up -d backend
```
Forventet: ren opstart i `docker logs badminton-backend --tail 10`.

- [ ] **Step 4: Manuel verifikation** (browser, kræver Fase 2 til fuld test, men kan delvist testes nu):
  - Opret to holdkampe via to `POST`-kald (eller vent til Fase 2). Bekræft at begge har `status='active'` via `curl -s http://localhost/api/team-matches/active-all` (array med 2 elementer — beviser at auto-afslut er væk).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/teamMatches.js
git commit -m @'
Backend: tillad flere aktive holdkampe + cross-match bane-guard (valg B)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## FASE 2 — Admin Holdkamp-side

### Task 3: List alle aktive holdkampe + altid-synlig opret-formular

**Files:**
- Modify: `frontend/admin-script.js` (`loadActiveHoldkamp` ~1089-1128; `renderActiveHoldkamp` signatur ~1155; `assignCourtToGame` ~1485)
- Modify: `frontend/admin.html` (bump `admin-script.js?v=`)

**Interfaces:**
- Konsumerer: `api.getActiveTeamMatches()`, `api.getActiveTournaments()`.
- Ændrer: `renderActiveHoldkamp(teamMatch, container, allGameStates, courtCount, gameMode, allActiveGames)` — tilføjet 6. param `allActiveGames` (flad liste af alle aktive holdkampes delkampe) til cross-match optaget-beregning. Funktionen sætter fortsat `container.innerHTML`, men kaldes nu med ét under-container pr. holdkamp.

- [ ] **Step 1: Omskriv `loadActiveHoldkamp`** (~1089-1128) til at loope over alle aktive holdkampe. Erstat funktionskroppen fra `if (teamMatch) {` til dens afsluttende `}` med:

```javascript
        const teamMatches = await api.getActiveTeamMatches();
        const container = document.getElementById('activeHoldkampContainer');
        const createForm = document.getElementById('createHoldkampForm');
        const courtCount = settings.courtCount || 5;

        if (activeTournaments && activeTournaments.length > 0) {
            // Aktiv turnering blokerer holdkampe
            stopHoldkampRefresh();
            container.style.display = 'none';
            createForm.style.display = 'none';
            renderHoldkampBlocker(activeTournaments[0]);
            return;
        }

        renderHoldkampBlocker(null);
        createForm.style.display = 'block'; // opret-formular ALTID synlig

        if (!teamMatches || teamMatches.length === 0) {
            container.style.display = 'none';
            container.innerHTML = '';
            stopHoldkampRefresh();
            return;
        }

        container.style.display = 'block';

        // Genstart polling hvis stoppet
        if (!holdkampRefreshTimer) {
            holdkampRefreshTimer = setInterval(loadActiveHoldkamp, 3000);
        }

        // Re-render ikke mens en redigér-formular eller bane-dropdown er aktiv
        if (!holdkampEditOpen && !holdkampCourtSelectOpen) {
            const selectedCourts = {};
            container.querySelectorAll('select[id^="courtSelect_"]').forEach(sel => {
                selectedCourts[sel.id] = sel.value;
            });

            const allActiveGames = teamMatches.flatMap(tm => tm.games || []);
            container.innerHTML = teamMatches.map(tm =>
                `<div class="holdkamp-block" style="margin-bottom:18px;">` +
                renderActiveHoldkampBlock(tm, allGameStates, courtCount, settings.defaultGameMode || '15', allActiveGames) +
                `</div>`
            ).join('');

            Object.entries(selectedCourts).forEach(([id, val]) => {
                const sel = document.getElementById(id);
                if (sel && val && sel.querySelector(`option[value="${val}"]`)) sel.value = val;
            });
        }
```

(Bemærk: vi har nu fjernet brugen af `api.getActiveTeamMatch()` her. Tjek at `allGameStates`, `settings` og `activeTournaments` stadig hentes i `Promise.all` øverst i funktionen — de gør, uændret.)

- [ ] **Step 2: Konverter `renderActiveHoldkamp` til `renderActiveHoldkampBlock` der RETURNERER HTML.** Find funktionssignaturen (~1155):

```javascript
function renderActiveHoldkamp(teamMatch, container, allGameStates = [], courtCount = 5, gameMode = '21') {
```
Erstat med:
```javascript
function renderActiveHoldkampBlock(teamMatch, allGameStates = [], courtCount = 5, gameMode = '21', allActiveGames = null) {
```
Find til sidst i funktionen linjen der sætter `container.innerHTML = ` ... `;` (~1291) og erstat `container.innerHTML =` med `return` (funktionen returnerer nu HTML-strengen i stedet for at skrive til container). Fjern den efterfølgende afsluttende markup-håndtering så funktionen ender med `return \`...\`;`.

- [ ] **Step 3: Brug cross-match optaget-baner i blokken.** Inde i `renderActiveHoldkampBlock`, find `occupiedByCourts` (~1198-1201):

```javascript
            const occupiedByCourts = new Set(
                teamMatch.games
                    .filter(og => og.status === 'active' && og.court_number)
                    .map(og => og.court_number)
            );
```
Erstat `teamMatch.games` med kilden på tværs af alle aktive holdkampe:
```javascript
            const occupiedByCourts = new Set(
                (allActiveGames || teamMatch.games)
                    .filter(og => og.status === 'active' && og.court_number)
                    .map(og => og.court_number)
            );
```

- [ ] **Step 4: Ret `assignCourtToGame`** (~1485) så den ikke bruger den singulære `getActiveTeamMatch`. Find:

```javascript
        const teamMatch = (await api.getActiveTeamMatch());
        const game = teamMatch?.games?.find(g => g.id === gameId);
```
Erstat med:
```javascript
        const teamMatches = await api.getActiveTeamMatches();
        const teamMatch = (teamMatches || []).find(tm => tm.id === teamMatchId);
        const game = teamMatch?.games?.find(g => g.id === gameId);
```
Håndtér også 409 fra bane-guarden — find `catch (error) {` i `assignCourtToGame` og sørg for at vise serverbeskeden:
```javascript
    } catch (error) {
        console.error('Failed to assign court:', error);
        const msg = error.status === 409 ? error.message : 'Kunne ikke tildele bane. Prøv igen.';
        showMessage(error.status === 409 ? 'Bane optaget' : 'Fejl', msg);
    }
```

- [ ] **Step 5: Bump cache-version** i `frontend/admin.html`: skift `admin-script.js?v=29` → `admin-script.js?v=30`.

- [ ] **Step 6: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 7: Manuel verifikation** (browser, Ctrl+F5 på `http://localhost/admin.html` → Holdkamp):
  - Opret holdkamp A. Bekræft den vises OG at opret-formularen stadig er synlig nedenunder.
  - Opret holdkamp B. Bekræft begge vises som separate blokke, hver med egen score-header og delkampe.
  - I A: tildel bane 1 til en delkamp. I B: åbn bane-dropdownen på en delkamp — bane 1 skal være markeret optaget.
  - Tildel (i B) en ledig bane; bekræft ingen fejl.

- [ ] **Step 8: Commit**

```bash
git add frontend/admin-script.js frontend/admin.html
git commit -m @'
Admin: vis alle aktive holdkampe + altid-synlig opret-formular

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## FASE 3 — Court v3 to-trins valg

### Task 4: To dropdowns (holdkamp → delkamp) i panelet

**Files:**
- Modify: `frontend/court-v3.html` (holdkamp-panelet ~128; bump `court-script-v3.js?v=`)
- Modify: `frontend/court-script-v3.js` (`initHoldkampPanel` ~2070, `refreshHoldkampPanel` ~2202, ny `populateHoldkampMatchSelect`/`onHoldkampMatchChange`, `assignHoldkampGame` ~2159)

**Interfaces:**
- Konsumerer: `api.getActiveTeamMatches()`, `api.getTeamMatchByCourt(courtId)` (fra Task 1), `holdkampCategoryNumbers(games)` (findes allerede), globale `courtId`, `holdkampSelectFocused`.
- Producerer: nyt element `#holdkampMatchSelect`; funktioner `populateHoldkampMatchSelect(matches)`, `onHoldkampMatchChange()`. Bevarer `assignedHoldkampGameId`.

- [ ] **Step 1: Tilføj match-dropdown i `frontend/court-v3.html`** umiddelbart FØR `<select id="holdkampGameSelect" ...>` (~128):

```html
                <select id="holdkampMatchSelect" onfocus="holdkampSelectFocused=true" onblur="holdkampSelectFocused=false" style="flex:1; min-width:200px; padding:8px 10px; background:#1a1a2e; color:#eaeaea; border:1px solid #533483; border-radius:5px; font-size:0.9em; margin-bottom:8px;">
                    <option value="">-- Vælg holdkamp --</option>
                </select>
```

- [ ] **Step 2: Tilføj match-state + populate-funktioner i `court-script-v3.js`** (nær de øvrige holdkamp-funktioner, fx før `initHoldkampPanel`):

```javascript
let holdkampMatches = []; // alle aktive holdkampe (cache til de to dropdowns)

function populateHoldkampMatchSelect(matches) {
    holdkampMatches = matches || [];
    const matchSel = document.getElementById('holdkampMatchSelect');
    const prev = matchSel.value;
    matchSel.innerHTML = '<option value="">-- Vælg holdkamp --</option>';
    holdkampMatches.forEach(tm => {
        // Vis kun holdkampe der har mindst én ventende delkamp
        if (!(tm.games || []).some(g => g.status === 'pending')) return;
        const opt = document.createElement('option');
        opt.value = tm.id;
        opt.textContent = `${tm.team1_name} vs ${tm.team2_name}`;
        matchSel.appendChild(opt);
    });
    if (prev && matchSel.querySelector(`option[value="${prev}"]`)) matchSel.value = prev;
    onHoldkampMatchChange();
}

function onHoldkampMatchChange() {
    const matchSel = document.getElementById('holdkampMatchSelect');
    const select = document.getElementById('holdkampGameSelect');
    const tm = holdkampMatches.find(m => String(m.id) === matchSel.value);
    select.innerHTML = '<option value="">-- Vælg delkamp --</option>';
    if (!tm) return;
    const catNums = holdkampCategoryNumbers(tm.games);
    (tm.games || []).filter(g => g.status === 'pending').forEach(g => {
        const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
        const t1 = isDoubles
            ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
            : (g.team1_player1 || '?');
        const t2 = isDoubles
            ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
            : (g.team2_player1 || '?');
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.category} ${catNums[g.id]}: ${t1} vs ${t2}`;
        select.appendChild(opt);
    });
}
```

- [ ] **Step 3: Flyt holdkamp-listeners til engangs-opsætning.** I dag registrerer `initHoldkampPanel` knap-listeners inline (~linje 2077-2086), hvilket vil dobbelt-binde nu hvor sync-loopet kan kalde init flere gange. Tilføj denne blok i `DOMContentLoaded`-setup (efter de øvrige `addEventListener`-kald, ~linje 188):

```javascript
    // Holdkamp-panel listeners (registreres én gang)
    document.getElementById('closeHoldkampPanelBtn').addEventListener('click', () => {
        document.getElementById('holdkampPanel').style.display = 'none';
    });
    document.getElementById('assignHoldkampBtn').addEventListener('click', assignHoldkampGame);
    document.getElementById('showHoldkampPanelBtn').addEventListener('click', async () => {
        document.getElementById('settingsMenu').style.display = 'none';
        await refreshHoldkampPanel();
    });
    document.getElementById('holdkampMatchSelect').addEventListener('change', onHoldkampMatchChange);
```

Disse fire registreringer FJERNES fra `initHoldkampPanel` i næste step (de inline-kald ~2077-2086).

- [ ] **Step 4: Omskriv `initHoldkampPanel`** (~2070) til by-court + to dropdowns. Erstat HELE funktionen (inkl. de inline listener-registreringer ~2077-2086, som nu bor i Step 3) med:

```javascript
async function initHoldkampPanel() {
    try {
        // Er denne bane allerede bundet til en aktiv delkamp?
        const byCourt = await api.getTeamMatchByCourt(courtId);
        if (byCourt && byCourt.game) {
            document.getElementById('showHoldkampPanelBtn').style.display = 'block';
            activeTeamMatch = byCourt;
            assignedHoldkampGameId = byCourt.game.id;
            applyHoldkampGameToState(byCourt.game);
            showHoldkampAssigned(byCourt.game);
            return;
        }

        // Ellers: vis panel med to-trins valg fra alle aktive holdkampe
        const matches = await api.getActiveTeamMatches();
        const hasPending = (matches || []).some(tm => (tm.games || []).some(g => g.status === 'pending'));
        if (!hasPending) return;

        document.getElementById('showHoldkampPanelBtn').style.display = 'block';
        populateHoldkampMatchSelect(matches);
        document.getElementById('holdkampPanel').style.display = 'block';
    } catch (error) {
        console.error('Failed to init holdkamp panel:', error);
    }
}
```

- [ ] **Step 5: Omskriv `refreshHoldkampPanel`** (~2202) til samme kilde:

```javascript
async function refreshHoldkampPanel() {
    try {
        const matches = await api.getActiveTeamMatches();
        const hasPending = (matches || []).some(tm => (tm.games || []).some(g => g.status === 'pending'));
        if (!hasPending) return;

        assignedHoldkampGameId = null;
        const panel = document.getElementById('holdkampPanel');
        const assignedDiv = document.getElementById('holdkampAssigned');
        const assignBtn = document.getElementById('assignHoldkampBtn');

        assignedDiv.style.display = 'none';
        document.getElementById('holdkampMatchSelect').style.display = '';
        document.getElementById('holdkampGameSelect').style.display = '';
        assignBtn.style.display = '';

        populateHoldkampMatchSelect(matches);
        panel.style.display = 'block';
    } catch (error) {
        console.error('Failed to refresh holdkamp panel:', error);
    }
}
```

- [ ] **Step 6: Ret `assignHoldkampGame`** (~2159) til at bruge valgt holdkamp + delkamp og håndtere 409:

```javascript
async function assignHoldkampGame() {
    const matchId = parseInt(document.getElementById('holdkampMatchSelect').value, 10);
    const gameId = parseInt(document.getElementById('holdkampGameSelect').value, 10);
    if (!matchId || !gameId) return;
    const tm = holdkampMatches.find(m => m.id === matchId);
    const game = tm && (tm.games || []).find(g => g.id === gameId);
    if (!tm || !game) return;

    try {
        await api.updateTeamMatchGame(matchId, gameId, { courtNumber: courtId, status: 'active' });
        activeTeamMatch = tm;
        assignedHoldkampGameId = gameId;
        applyHoldkampGameToState(game);
        showHoldkampAssigned(game);
    } catch (error) {
        console.error('Failed to assign holdkamp game:', error);
        if (error.status === 409) {
            showMessage('Bane optaget', error.message);
            await refreshHoldkampPanel();
        }
    }
}
```
(`showMessage` findes i `court-script-v3.js` ~linje 1468.)

- [ ] **Step 7: Opdater sync-loopet** (~1869-1911). Erstat holdkamp-grenen der bruger `api.getActiveTeamMatch()`. Find blokken der starter med `const tm = await api.getActiveTeamMatch();` inde i sync-loopet og erstat hele holdkamp-`try`-blokken med:

```javascript
        // Holdkamp sync: opdag binding/ny holdkamp uden at antage én aktiv
        try {
            if (assignedHoldkampGameId) {
                // Allerede bundet — synk navne fra delkampen (kun før sider er byttet)
                const byCourt = await api.getTeamMatchByCourt(courtId);
                if (byCourt && byCourt.game) {
                    activeTeamMatch = byCourt;
                    const myGame = byCourt.game;
                    const sidesHaveBeenSwitched = gameState.sidesManuallySwitched || gameState.player1.games > 0 || gameState.player2.games > 0;
                    if (myGame && !sidesHaveBeenSwitched) {
                        syncHoldkampNamesToCourt(myGame); // se note nedenfor
                    }
                }
            } else {
                // Ikke bundet endnu — er der pludselig en kamp på denne bane?
                const byCourt = await api.getTeamMatchByCourt(courtId);
                if (byCourt && byCourt.game) {
                    activeTeamMatch = byCourt;
                    assignedHoldkampGameId = byCourt.game.id;
                    applyHoldkampGameToState(byCourt.game);
                    showHoldkampAssigned(byCourt.game);
                } else {
                    // Ellers: hold de to dropdowns friske (medmindre brugeren vælger)
                    const panel = document.getElementById('holdkampPanel');
                    const matchSel = document.getElementById('holdkampMatchSelect');
                    const gameSel = document.getElementById('holdkampGameSelect');
                    const userIsSelecting = holdkampSelectFocused || (matchSel && matchSel.value) || (gameSel && gameSel.value);
                    if (panel && panel.style.display !== 'none' && !userIsSelecting) {
                        await refreshHoldkampPanel();
                    } else if (!panel || panel.style.display === 'none') {
                        await initHoldkampPanel();
                    }
                }
            }
        } catch (error) {
            console.error('Failed to sync holdkamp:', error);
        }
```

**Note om `syncHoldkampNamesToCourt`:** dette er den eksisterende navne-synk-logik der i dag står inline i `else if (assignedHoldkampGameId)`-grenen (~1893-1909, hvor den sammenligner `namesChanged` og opdaterer `gameState.player1/2.name`). Udtræk den nuværende inline-logik til en lille funktion `syncHoldkampNamesToCourt(myGame)` med præcis samme krop, og kald den som vist. Hvis du foretrækker, behold logikken inline i stedet for at kalde en hjælpefunktion — vigtigst er at `myGame` nu kommer fra `byCourt.game`.

- [ ] **Step 8: Opdater `saveMatchResult`-fallback** (~1700-1710). Find:

```javascript
            if (!capturedTournamentMatchId) {
                try {
                    const tm = await api.getActiveTeamMatch();
                    const g = tm && (tm.games || []).find(gg => gg.court_number === courtId && gg.status === 'active');
                    if (g) { capturedGameId = g.id; capturedTeamMatch = tm; }
                } catch (e) {
                    console.error('Fallback-opslag af holdkamp fejlede:', e);
                }
            }
```
Erstat med by-court:
```javascript
            if (!capturedTournamentMatchId) {
                try {
                    const byCourt = await api.getTeamMatchByCourt(courtId);
                    if (byCourt && byCourt.game) { capturedGameId = byCourt.game.id; capturedTeamMatch = byCourt; }
                } catch (e) {
                    console.error('Fallback-opslag af holdkamp fejlede:', e);
                }
            }
```

- [ ] **Step 9: Bump cache-version** i `frontend/court-v3.html`: `court-script-v3.js?v=10` → `?v=11`.

- [ ] **Step 10: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 11: Manuel verifikation** (browser): med to aktive holdkampe og en ledig bane, åbn court v3 på den bane:
  - Holdkamp-dropdownen viser begge holdkampe. Vælg én → delkamp-dropdownen viser kun dens ventende delkampe med korrekt per-kategori-nummer (MD1, DS1 …).
  - Tildel en delkamp; spil den færdig; bekræft resultatet lander på den RIGTIGE holdkamp/delkamp (tjek admin Kamphistorik/Oversigt).
  - Med begge dropdowns åbne i >5 sek: de blinker/nulstilles ikke.

- [ ] **Step 12: Commit**

```bash
git add frontend/court-v3.html frontend/court-script-v3.js
git commit -m @'
Court v3: to-trins valg af holdkamp og delkamp via by-court

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## FASE 4 — Oversigt.html

### Task 5: 50/50 holdkamp-kort med live patch-opdatering

**Files:**
- Modify: `frontend/oversigt.html` (fjern `#holdkampOverview` ~25-38; tilføj `#holdkampCardsGrid`; bump `oversigt-script.js?v=`)
- Modify: `frontend/oversigt-script.js` (`loadHoldkamp` ~44, `renderHoldkampGames` ~85, ny `renderHoldkampCards`/`patchHoldkampCards`)
- Modify: `frontend/oversigt-styles.css` (grid-styling)

**Interfaces:**
- Konsumerer: `api.getActiveTeamMatches()`, global `allCourtData`, `escapeHtml`, `orientHistorySetScoreNumbers`.
- Producerer: `#holdkampCardsGrid` container; funktioner `renderHoldkampCards(matches)` (fuld render) og `patchHoldkampCards(matches)` (opdater kun ændrede værdier).

- [ ] **Step 1: Erstat den store rubrik i `frontend/oversigt.html`.** Fjern hele `<div id="holdkampOverview" ...>...</div>` (~25-38) og indsæt i stedet:

```html
        <div id="holdkampCardsGrid" style="display:none;"></div>
```

- [ ] **Step 2: Tilføj grid-styling i `frontend/oversigt-styles.css`:**

```css
#holdkampCardsGrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
}
#holdkampCardsGrid .hk-card {
    background: rgba(83,52,131,0.15);
    border: 1px solid rgba(83,52,131,0.5);
    border-radius: 10px;
    padding: 14px 16px;
}
#holdkampCardsGrid .hk-card-header {
    display: flex; align-items: baseline; gap: 16px;
    margin-bottom: 10px; font-family: 'Bebas Neue', sans-serif;
}
#holdkampCardsGrid .hk-card-header .t1 { color: #4CAF50; font-size: 1.8em; }
#holdkampCardsGrid .hk-card-header .sc { color: #fff; font-size: 1.8em; letter-spacing: 3px; }
#holdkampCardsGrid .hk-card-header .t2 { color: var(--color-accent); font-size: 1.8em; }
#holdkampCardsGrid .hk-games { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
@media (max-width: 1100px) { #holdkampCardsGrid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: Omskriv `loadHoldkamp`** (~44) til at hente alle aktive og vælge render vs patch:

```javascript
let _hkRenderedKey = ''; // signatur af struktur (match-ids + game-ids + status-antal)

async function loadHoldkamp() {
    try {
        const matches = await api.getActiveTeamMatches();
        const grid = document.getElementById('holdkampCardsGrid');
        const containerEl = document.querySelector('.overview-container');

        if (!matches || matches.length === 0) {
            grid.style.display = 'none';
            grid.innerHTML = '';
            _hkRenderedKey = '';
            if (containerEl) containerEl.classList.remove('has-holdkamp');
            updateIdleState();
            return;
        }

        grid.style.display = 'grid';
        if (containerEl) containerEl.classList.add('has-holdkamp');

        // Struktur-signatur: kun fuld re-render når den ændrer sig (undgår flicker)
        const key = matches.map(tm =>
            `${tm.id}:${(tm.games || []).map(g => g.id + g.status).join(',')}`
        ).join('|');

        if (key !== _hkRenderedKey) {
            renderHoldkampCards(matches);
            _hkRenderedKey = key;
        } else {
            patchHoldkampCards(matches); // kun opdater tal/score
        }
        updateIdleState();
    } catch (error) {
        console.error('Failed to load holdkamp:', error);
    }
}
```

- [ ] **Step 4: Tilføj `renderHoldkampCards` og `patchHoldkampCards`.** Erstat den gamle `renderHoldkampGames`-funktion (~85) med disse to:

```javascript
const HK_FORMAT_NAMES = {
    liga11: 'Liga-format (11 kampe)', '13kamps': '13-kamps format',
    '2plus2': '2+2-format (8 kampe)', '4plus2': '4+2-format (8 kampe)',
    '4plus3': '4+3-format (9 kampe)', '4spillere': '4-spillere-format (6 kampe)'
};
const HK_DOUBLES = ['MD', 'DD', 'HD', 'Double'];

function hkGameCellHtml(g, num, teamMatch) {
    const isDoubles = HK_DOUBLES.includes(g.category);
    const t1 = isDoubles ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}` : (g.team1_player1 || '?');
    const t2 = isDoubles ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}` : (g.team2_player1 || '?');
    return `<div class="hk-game" data-game-id="${g.id}" style="background:rgba(83,52,131,0.15); border-left:3px solid #555; border-radius:6px; padding:8px 10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="background:#e94560; color:#fff; padding:2px 7px; border-radius:4px; font-size:0.85em; font-weight:bold;">${g.category} ${num}</span>
            <span class="hk-game-status" style="font-size:0.85em;"></span>
        </div>
        <div style="color:#eaeaea; font-size:0.95em;">${escapeHtml(t1)}</div>
        <div style="color:#aaa; font-size:0.78em; margin:2px 0;">vs</div>
        <div style="color:#eaeaea; font-size:0.95em;">${escapeHtml(t2)}</div>
    </div>`;
}

function hkStatusFor(g, teamMatch) {
    if (g.status === 'pending') return { html: '<span style="color:#aaa;">Afventer</span>', border: '#555' };
    if (g.status === 'active') {
        const cd = allCourtData.find(c => c.courtId === g.court_number);
        const live = cd ? ` · ${cd.player1.score}-${cd.player2.score} (${cd.player1.games}-${cd.player2.games} sæt)` : '';
        return { html: `<span style="color:#fff;">▶ Bane ${g.court_number}${live}</span>`, border: '#533483' };
    }
    // finished
    const winner = g.winner_team === 1 ? teamMatch.team1_name : teamMatch.team2_name;
    const side1Key = HK_DOUBLES.includes(g.category) && g.team1_player2
        ? `${g.team1_player1 || ''} / ${g.team1_player2}` : (g.team1_player1 || '');
    const nums = g.set_scores ? orientHistorySetScoreNumbers(g.set_scores, side1Key).join(' · ') : '';
    const sc = nums ? ` <span style="color:#aaa;">${nums}</span>` : '';
    return { html: `<span style="color:#4CAF50;">✓ ${escapeHtml(winner)}${sc}</span>`, border: g.winner_team === 1 ? '#4CAF50' : '#e94560' };
}

function renderHoldkampCards(matches) {
    const grid = document.getElementById('holdkampCardsGrid');
    grid.innerHTML = matches.map(tm => {
        const t1w = tm.games.filter(g => g.winner_team === 1).length;
        const t2w = tm.games.filter(g => g.winner_team === 2).length;
        const counts = {};
        const cells = tm.games.map(g => {
            counts[g.category] = (counts[g.category] || 0) + 1;
            return hkGameCellHtml(g, counts[g.category], tm);
        }).join('');
        return `<div class="hk-card" data-match-id="${tm.id}">
            <div class="hk-card-header">
                <span class="t1">${escapeHtml(tm.team1_name)}</span>
                <span class="sc">${t1w} – ${t2w}</span>
                <span class="t2">${escapeHtml(tm.team2_name)}</span>
            </div>
            <div class="hk-games">${cells}</div>
        </div>`;
    }).join('');
    patchHoldkampCards(matches); // sæt status/score + border på de friske celler
}

function patchHoldkampCards(matches) {
    matches.forEach(tm => {
        const card = document.querySelector(`.hk-card[data-match-id="${tm.id}"]`);
        if (!card) return;
        const t1w = tm.games.filter(g => g.winner_team === 1).length;
        const t2w = tm.games.filter(g => g.winner_team === 2).length;
        const scEl = card.querySelector('.hk-card-header .sc');
        if (scEl) scEl.textContent = `${t1w} – ${t2w}`;
        tm.games.forEach(g => {
            const cell = card.querySelector(`.hk-game[data-game-id="${g.id}"]`);
            if (!cell) return;
            const st = hkStatusFor(g, tm);
            const statusEl = cell.querySelector('.hk-game-status');
            if (statusEl) statusEl.innerHTML = st.html;
            cell.style.borderLeftColor = st.border;
        });
    });
}
```

- [ ] **Step 5: Fjern forældede referencer.** Søg i `oversigt-script.js` efter `getActiveTeamMatch(` og `holdkampOverview` / `hk_team1Name` / `hk_score` / `renderHoldkampGames` / `holdkampFormatLabel` og fjern/erstat tilbageværende brug (alt er nu dækket af de nye funktioner). Bekræft at `loadHoldkamp` kaldes i refresh-loopet (uændret kald).

- [ ] **Step 6: Bump cache-version** i `frontend/oversigt.html`: `oversigt-script.js?v=<n>` → næste nummer.

- [ ] **Step 7: Deploy frontend**

```bash
cd /c/Users/jespe/.local/bin/badminton-app && docker-compose build frontend && docker-compose up -d frontend
```

- [ ] **Step 8: Manuel verifikation** (browser `http://localhost/oversigt.html`, Ctrl+F5):
  - To aktive holdkampe vises side om side (50/50). En 3. holdkamp får siden til at scrolle.
  - Mens en delkamp spilles: scoren i rubrikken opdateres live uden at hele siden blinker eller hopper i scroll.
  - Afsluttede delkampe viser vinder + orienteret score; stillingen (X – Y) i kort-headeren opdateres.

- [ ] **Step 9: Commit**

```bash
git add frontend/oversigt.html frontend/oversigt-script.js frontend/oversigt-styles.css
git commit -m @'
Oversigt: 50/50 holdkamp-kort med live patch-opdatering uden flicker

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
'@
```

---

## Afsluttende verifikation (hele featuren)

- [ ] Opret 2 holdkampe; begge synlige på Admin; opret-formular forbliver.
- [ ] Tildel baner i begge; forsøg at tildele en i-gang bane → "Bane optaget"; tildel en tildelt-men-ikke-startet bane → den gamle frigøres.
- [ ] Court v3: vælg holdkamp → delkamp; spil færdig; resultat på rigtig holdkamp.
- [ ] Oversigt: begge holdkampe 50/50, live, ingen flicker; 3. holdkamp → scroll.
- [ ] Aktiv turnering blokerer stadig oprettelse af holdkamp (og omvendt).
- [ ] Push til `main` når alle faser er verificeret; husk Pi'en kræver `build backend frontend`.

## Noter til Pi-deploy (produktion)

Backend + frontend ændres, så på Pi'en:
```bash
git pull && docker-compose build backend frontend && docker-compose up -d backend frontend
```
