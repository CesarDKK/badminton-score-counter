# Badminton Counter App

[![Tests](https://github.com/CesarDKK/badminton-score-counter/actions/workflows/tests.yml/badge.svg)](https://github.com/CesarDKK/badminton-score-counter/actions/workflows/tests.yml)

A real-time badminton score tracking system with multi-device support, sponsor slideshow, and match history tracking.

## Features

- **Real-time Score Tracking**: Track scores for multiple courts simultaneously
- **Multi-Device Sync**: All devices stay in sync via MySQL database
- **Court View (Bane View, V3)**: Visual court representation with player positioning (den klassiske visning er udfaset — kun V3 findes)
- **Android App**: Native app with WebView for dedicated court displays
- **Smartwatch View**: Minimalistisk browser-side optimeret til Apple Watch og andre smartwatches
- **TV Display Mode**: Full-screen display for showing current games
- **Undo Functionality**: Full game state history with position-aware restore
- **Tournament Mode**: Lock down controls during competitive play
- **Admin Panel**: Manage courts, view match history, and configure settings
- **Sponsor Slideshow**: Upload and display sponsor images with configurable duration
  - Active/inactive status control for each image
  - Automatic expiration dates for time-limited sponsorships
  - Separate slideshow and court banner image types
  - Court-specific banner assignments
- **Match History**: Automatic tracking of completed matches with statistics
- **Doubles Support**: Proper serving rules, position tracking, and player swapping
- **Timer Support**: Built-in timer for tracking match duration
- **Security**: Rate limiting, JWT authentication, and password hashing

## Recent Updates

### Version 2.5.0 - Multi-Tenant, Migration Runner & Rate Limit Fix

#### 🏢 Multi-Tenant arkitektur
- **Database-per-klub**: Hver klub får sin egen isolerede database (`klub.badmintonapp.dk`)
- **Super admin panel**: Opret, aktiver/deaktiver og slet klubber samt administrer klub-admins
- **Subdomain-routing**: Automatisk tenant-resolution via `APP_DOMAIN` miljøvariabel
- **Club admin login**: Klubber kan logge ind med egne credentials via `club-login.html`

#### 🔄 Automatisk migration runner
- Ny `migrationRunner.js` kører migrations mod **alle** databaser (default + alle klub-databaser) ved opstart
- Tracker applied migrations i en `migrations`-tabel per database
- Nye klub-databaser markeres automatisk som up-to-date ved oprettelse
- Håndterer ikke-idempotente migrations og MySQL/MariaDB syntaksforskelle

#### 🚦 Rate limiting fjernet fra polling-endpoints
- Fjernet `publicLimiter` og `adminLimiter` fra alle read/poll endpoints (`/api/game-states`, `/api/courts`, `/api/sponsors`, `/api/settings` m.fl.)
- Beholder kun `loginLimiter` (brute-force beskyttelse) og `uploadLimiter` (fil-upload)
- Løser problem med NAT: alle enheder på én klubs netværk deler offentlig IP og ville ramme grænsen ved skala (10 klubber × 20 baner × TV-skærme + tilskuere)

### Version 2.0.0 - Smartwatch Support, Holdkamp Sync & UI Improvements

#### ⌚ Smartwatch / Mini Browser View (`watch.html`)
> **Udfaset (juli 2026):** `watch.html` er fjernet — siden manglede live-sync og
> ignorerede kamptilstand (15/21). Beskrivelsen nedenfor er historisk.
- **Dedikeret mini-side** optimeret til meget små skærme — herunder Apple Watch via Safari
- **URL:** `http://[server-ip]/watch.html?court=1` (skift `1` til ønsket banenummer)
- **Fire knapper** fylder hele skærmen:
  - Øverste halvdel styrer spiller 1, nederste halvdel styrer spiller 2
  - Stort grønt felt (80% af bredden): tryk for at give et point
  - Grå felt til venstre (20%): fortryd sidst registrerede point
- **Første tryk** starter kampen og sætter den trykke spiller som server
- **Servering** skifter automatisk efter badminton-reglerne
- **Sæt- og kamplogik:** Første til 21 (skal vinde med 2, maks 30), bedst af 3 sæt
- **Sætvisning:** Fyldte/tomme cirkler (●/○) viser vundne sæt
- **Sæt vundet:** Besked vises — tryk "Fortsæt" for næste sæt
- **Kamp vundet:** Besked med vinder — tryk "Ny kamp" for nulstilling
- **Synkroniserer** i realtid med TV-view, admin og Court V3

**Brug på Apple Watch:**
1. Åbn Safari på Apple Watch
2. Naviger til `http://[server-ip]/watch.html?court=[banenummer]`
3. Gem siden som bogmærke for hurtig adgang

#### 🏸 Holdkamp Forbedringer
- **Automatisk opdagelse:** Court view opdager ny holdkamp inden for 5 sekunder uden sideopdatering
- **Tovejs navne-sync:** Navne redigeret på holdkamp-siden synkroniseres til court view og omvendt (hvert 5 sek)
- **Holdnavn-fallback:** Hvis spillernavne mangler, vises holdnavnet som placeholder (f.eks. "FC Køge spiller")
- **Fix:** Delkamp-dropdown bruger korrekt spilnummer — MD2 vises ikke længere som MD1 efter MD1 er tildelt
- **Fix:** Dropdown refreshes ikke mens bruger har valgt en delkamp
- **Rediger aktive delkampe:** Navne kan nu redigeres fra holdkamp-siden også efter en kamp er startet

#### 🖥️ TV View
- "Ingen aktiv kamp" tekst 3× større
- Bane-nummer under teksten 3× større
- Bevægelseshastighed halveret for mere rolig screensaver

#### 🔐 Admin
- Password-feltet er nu auto-fokuseret ved siden load — man kan taste passwordet med det samme
- Rettighedsmarkering tilføjet i bunden: © 2026 Jesper Brink Sørensen

---

### Version 1.9.0 - Arena Design, Offline Fonts & Game Rules

#### Arena Design (All Pages)
- **Unified Arena Design**: All pages now share a consistent arena aesthetic — Bebas Neue as the display font for scores and headings, DM Sans as the body font, dark background with radial glow (`bg-glow`) and a subtle grid pattern, glass card styling with accent borders
- **Court V3 Arena Design**: Court V3 fully updated to match — Bebas Neue for scores and buttons, glass settings menu, visually consistent with the rest of the app

#### Offline Fonts
- **Local Font Serving**: Removed Google Fonts CDN dependency entirely. All fonts are now served locally from `frontend/fonts/` (4 woff2 files: Bebas Neue latin/latin-ext, DM Sans latin/latin-ext)
- **`frontend/fonts.css`**: New stylesheet containing all `@font-face` declarations
- **Fully Offline**: The app now works completely without an internet connection

#### Court V3 - Layout & Controls
- **No-Scroll Layout**: Court height is now constrained using the CSS `min()` function so the court and buttons always fit on screen without scrolling
- **"Skift side" on Court Surface**: Moved from the settings menu to an icon button (⇆) placed directly on the court surface at the bottom of the net area, matching the style of the doubles swap buttons. Only visible before the match starts
- **"Bane X" Court Name Label**: Displays the court name (e.g. "Bane 1", "Bane 2") on the top 20% of the court surface before a match starts. The label is double the size of the "Start Kamp" button. Hidden when the match starts and reappears after a reset

#### Game Rules & Controls
- **Match-Active Guards** (Court V2 and V3): While a match is active, the "Skift til Double/Single" toggle and the "Skift side" button are both disabled/hidden. Automatic side switching at set boundaries and at 11 points in the 3rd set continues to work as before
- **Doubles Between Sets**: When a new set starts, the winning team's right-court player is automatically set as the server. Players can still use the ⇅ swap button to change positions; the server updates automatically to reflect the new right-court player
- **Reset Court Fix**: "Nulstil bane" (Reset Court) now also resets `is_doubles` — previously doubles mode persisted after a reset

#### Admin Navigation
- **Consistent Navigation Bar**: All admin sub-pages (Holdkamp, Kamphistorik, Spiller Info, Indstillinger, Sponsorer) now share the same full navigation bar
- **"← Oversigt" Button**: Appears before "Holdkamp" in the nav on all sub-pages; hidden on the main Baneoversigt (overview) page
- **Hash-Based Navigation**: `admin.html` supports `#holdkamp` and `#history` URL hashes for direct linking from other pages

#### Bug Fixes
- **TV V3 Screensaver Fix**: Fixed a blank screen issue when no active match was present — screensaver/sponsor slideshow CSS was missing after the redesign
- **Database Defaults Fix**: `init.sql` defaults for `court_version` and `tv_version` corrected to `'v3'` (were incorrectly set to `'v2'`)

**Opdatering:** `git pull` og `./deploy.sh` — migrationerne kører af sig selv (se [Deploying Updates](#deploying-updates)).

---

### Version 1.7.0 - Android App, Court V3, & Optimizations

#### 🤖 Android App Enhancements
- **Dynamic Court Version**: App now fetches court version (Klassisk/Bane view) from server settings automatically
- **New App Icon**: Improved shuttlecock icon with emoji-style design
- **Signed Releases**: Secure release builds with keystore configuration
- **Fix**: Reliable court version loading using native HTTP requests

#### 🏸 Court V3 - Compact & Feature-Rich
- **Compact Layout**: 30% smaller scores and buttons to fit smaller screens
  - Point scores: 5em → 3.5em
  - Set scores: 3em → 2em
  - Buttons: 60px → 65px (larger touch targets)
  - All margins/padding reduced by 50%
- **Frameless Design**: Edge-to-edge display with no borders or padding
- **Undo Functionality**: Full history tracking (last 20 actions)
  - Restores scores, serving state, and player positions
  - Works correctly for both singles and doubles modes
  - Respects player court positions in doubles
- **Tournament Mode**: Hides non-essential buttons during tournaments
  - Hides: "Ryd Banen", "Skift til Double", "Tilbage", "Admin"
  - Prevents accidental changes during competitive play

#### ⚙️ Settings Improvements
- **Court Version Selection**: Choose between "Klassisk" (classic) and "Bane view" (court visualization)
- **Tournament Mode Toggle**: One-click activation to lock down court controls

#### 🖼️ Sponsor Management
- **Active/Inactive Status**: Toggle visibility of sponsor images without deleting them
  - Manual control via toggle switch in admin panel
  - Visual indicators (Active/Inactive/Expired badges)
  - Inactive images dimmed with grayscale filter
- **Automatic Expiration**: Set expiration dates for time-limited sponsorships
  - Datetime picker for easy date selection
  - Images automatically deactivated after expiration
  - Hourly background check ensures timely deactivation
  - Expired images show red badge and warning notice
  - Clear button to remove expiration dates
- **Smart Filtering**: TV displays only show active, non-expired images
- **Admin Visibility**: Admin panel shows all images including inactive/expired
- **Backwards Compatible**: Existing images automatically set to active with no expiration

#### 🔧 Performance & Security
- **Performance**: Reduced admin panel polling by 60% (1s → 2.5s interval)
- **Performance**: Eliminated N+1 database query problem in sponsor image loading
- **Security**: Added comprehensive rate limiting to prevent brute force and DOS attacks
- **Security**: Login attempts limited to 5 per 15 minutes
- **Dependencies**: Added `express-rate-limit` for rate limiting functionality

**Opdatering:** `git pull` og `./deploy.sh` (se [Deploying Updates](#deploying-updates)).

## 📋 Installationsvejledning

Komplet trin-for-trin guide til installation på ny server (inkl. Git og Docker):

**[→ INSTALL.md](INSTALL.md)** — Komplet installationsvejledning (Ubuntu/Debian + Windows)

---

## 📱 Android App

A dedicated Android app is available for court-side displays. The app provides a fullscreen WebView optimized for tablets and phones.

### Features

- **Court View**: Loads the court page (Bane View, V3) for the configured court
- **Fullscreen Mode**: Immersive display without navigation bars
- **Keep Screen On**: Prevents screen from sleeping during matches (10-minute timeout)
- **Navigation Lock**: Prevents accidental navigation away from court page
- **Easy Setup**: Configure server URL and court number on first launch
- **Cache Busting**: Always loads latest CSS and JavaScript updates

### Building the Android App

See [ANDROID_BUILD_GUIDE.md](ANDROID_BUILD_GUIDE.md) for detailed build instructions.

**Quick build:**
```bash
cd android-app
./gradlew assembleRelease  # or assembleDebug for testing
```

APK location: `android-app/app/build/outputs/apk/release/BadmintonApp.apk`

**Distributing to tablets:** `android-app\build-apk.ps1 -Release` also copies the
signed APK to `frontend/downloads/BadmintonApp.apk` and writes
`frontend/downloads/badminton-app.json` (version, build date, size, sha256).
Commit both files and deploy; the app can then be downloaded directly on a
tablet from **Admin → Indstillinger → Tablet-app** (served by nginx under
`/downloads/`). Updates install over the existing app because every release is
signed with the same keystore — never distribute a debug build this way.

**Requirements:**
- Java 17 (configured in gradle.properties)
- Android SDK with build tools 33.0.1+
- Gradle 8.12+ (wrapper included)

### Keystore Configuration

The app uses `keystore.properties` (gitignored) for release signing:
```properties
storePassword=your_password
keyPassword=your_password
keyAlias=your_alias
storeFile=../path/to/keystore.jks
```

---

## 🏸 Court Views

Banesiden findes kun som Bane View (V3); den klassiske visning og valget i Indstillinger er udfaset (juli 2026).

### Bane View (Court V3)
Visual court representation showing player positions and serving zones.

**Features:**
- **Arena Design**: Bebas Neue display font for scores and buttons, glass settings menu, dark background with radial glow and grid pattern — consistent with the rest of the app
- **No-Scroll Layout**: CSS `min()` constrains court height so court + buttons always fit on screen without scrolling
- **Compact Layout**: Optimized for smaller screens with 30% size reduction
- **Frameless Design**: Edge-to-edge display maximizes screen space
- **Visual Court**: Top-down badminton court with accurate dimensions
- **Court Name Label**: "Bane X" displayed on the court surface (top 20%) before the match starts; hidden during play and restored after reset
- **Player Positioning**: See player positions in doubles mode
- **Serving Indicator**: Shuttlecock emoji shows current serving position
- **"Skift side" on Court**: Side-switch button (⇆) placed directly on the court surface at the bottom of the net area; only visible before the match starts
- **Position Swapping**: Swap player positions between sets in doubles; server updates automatically to reflect the right-court player
- **Doubles Between Sets**: Winning team's right-court player is automatically set as server when a new set starts
- **Match-Active Guards**: "Skift til Double/Single" toggle and "Skift side" button are disabled/hidden during an active match
- **Undo System**: Full game state history tracking (last 20 actions)
  - Restores scores, serving state, and player court positions
  - Position-aware undo for doubles mode
- **Tournament Mode**: Hides unnecessary controls during competitive play
- **Settings Menu**: Collapsible gear menu keeps interface clean

**Optimizations:**
- Point scores: 3.5em (30% smaller than v2)
- Set scores: 2em (33% smaller)
- Buttons: 65px tall with 2em font (easier touch targets)
- Zero padding/margins for maximum space efficiency

**Tournament Mode:**
When enabled in settings, Court V3 hides:
- "Ryd Banen" (Clear Court)
- "Skift til Double" (Toggle Doubles)
- "Tilbage" (Back)
- "Admin" (Admin Panel)

This prevents accidental changes during tournaments while keeping essential controls accessible.

---

## Quick Start

Kræver Git og Docker med Compose v2 (`docker compose`). Trin for trin, også Windows: **[INSTALL.md](INSTALL.md)**.

```bash
git clone https://github.com/CesarDKK/badminton-score-counter.git
cd badminton-score-counter
./deploy.sh
```

`deploy.sh` sørger selv for `.env` (via `scripts/ensure-env.sh` — ingen manuel redigering), bygger og starter alle tjenester og venter på, at backenden svarer sundt.

- **Appen**: http://localhost:8080 (og port 80)
- **Backendens API**: kun internt (bundet til `127.0.0.1:3000`); udefra går alt gennem nginx

### First Time Setup

1. Åbn http://localhost:8080
2. Vælg antal baner
3. Log ind under "Admin" med standardkoden `admin123` (gælder den lokale/demo-databasen)
4. **Skift adgangskoden med det samme** under Admin → Indstillinger

Klubber på egne subdomæner oprettes i super-admin (`admin.<domæne>`); første login er `superadmin` / `superadmin123`, og koden skal skiftes ved første login.

## Architecture

### Tjenester (docker-compose.yml)

| Tjeneste (container) | Hvad | Port |
|---|---|---|
| `mysql` (badminton-mysql) | MySQL 8.4: demo-/standarddatabasen `badminton_counter`, `badminton_master`, én database pr. klub og `football_tournament` | `127.0.0.1:3306` |
| `backend` (badminton-backend) | Node 22 + Express: API, uploads, baggrundsjob, migrationer ved opstart | `127.0.0.1:3000` |
| `frontend` (badminton-frontend) | nginx: alle statiske sider (app, marketing, statistik, planner m.fl.) og proxy til backenderne | `80`, `8080` |
| `football-db-init` | Engangsjob: opretter football-databasen og -brugeren, stopper bagefter | — |
| `football-backend`, `football-frontend` | Football-modulet (footballapp.dk), Node 22 + nginx | kun internt |
| `stats-backend` (badminton-stats) | Klubstatistik (statistik.badmintonapp.dk), Node 22 | kun internt |
| `planner-solver` | Planner-løseren (Python 3.12 + OR-Tools CP-SAT) bag planner.badmintonapp.dk | kun internt |
| `backup` (badminton-backup) | Fuld backup af alle databaser og uploads én gang i døgnet (se [Docker Volumes](#docker-volumes)) | — |

Sundhed: `GET /health` på backenden (bruges af Docker og `deploy.sh`) og den offentlige `GET /api/health` gennem nginx (200/503, til overvågning udefra).

### Automated Background Tasks

Backenden kører sine faste job med `node-cron` (`backend/scheduler.js`), bl.a.:

- Nulstilling af banerne ved midnat (Europe/Copenhagen) og timevis deaktivering af udløbne sponsorbilleder
- Holdkamp- og turneringssynkronisering, planner- og livestream-vagter (hvert minut eller oftere)
- Ugentlig automatisk backup af hver klub (mandag kl. 02:00) og natlig oprydning

### Database Schema

**settings**: Global app settings
- `admin_password_hash`: Bcrypt hashed admin password
- `court_count`: Number of available courts
- `show_reset_button`: Tournament mode toggle (false = tournament mode)
- `default_game_mode`: Default game mode for new courts ('15' or '21')
- `theme_*`: Color theme settings
- _(`court_version`/`tv_version` udfaset juli 2026 — kun v3 findes nu)_

**courts**: Court configurations (active status, doubles mode, game mode)

**game_states**: Current game state per court
- Scores, timers, player names
- Serving state (servingPlayer, servingTeam, servingPlayerOnTeam)
- Player positions (team1RightCourt, team2RightCourt)
- Between sets flag for position swapping

**match_history**: Completed match records with winner/loser and duration

**sponsor_images**: Sponsor image metadata
- Basic: filename, dimensions, upload date, type (slideshow/court)
- Status: `is_active` (manual visibility control), `expiration_date` (automatic deactivation)
- Display: display_order for sorting
- Court banners: separate table `sponsor_image_courts` for court assignments

**sponsor_settings**: Slideshow configuration (slide duration)

## API Documentation

### Authentication

All admin endpoints require JWT token in `Authorization: Bearer <token>` header.

**POST** `/api/auth/login`
- Body: `{ "password": "string" }`
- Returns: `{ "token": "jwt_token" }`

### Courts

**GET** `/api/courts` - Get all courts (public)

**GET** `/api/courts/:id` - Get specific court (public)

**PUT** `/api/courts/:id` - Update court settings (requires auth)
- Body: `{ "isActive": boolean, "isDoubles": boolean, "gameMode": "best-of-1|best-of-3|single-game" }`

### Game States

**GET** `/api/game-states/:courtId` - Get current game state (public)

**PUT** `/api/game-states/:courtId` - Update game state (public)
- Body: `{ "player1": {...}, "player2": {...}, "timerSeconds": number, "decidingGameSwitched": boolean }`
- Query param: `skipAutoActive=true` to prevent auto-activation

**DELETE** `/api/game-states/:courtId` - Reset court (requires auth)

### Match History

**GET** `/api/match-history/:courtId` - Get history for court (public)

**GET** `/api/match-history/all` - Get all match history (admin, page by page)
- Query params: `limit` (default: 30), `offset` (default: 0)

**POST** `/api/match-history` - Save match result (public)
- Body: `{ "courtId": number, "winnerName": string, "loserName": string, "gamesWon": number, "duration": number }`

### Sponsors

**GET** `/api/sponsors/images` - Get all sponsor images (public)
- Query params: `type` (slideshow/court), `includeInactive` (true/false)
- Returns only active, non-expired images by default
- Admin panel can use `includeInactive=true` to see all images
- Automatically deactivates expired images on each request

**GET** `/api/sponsors/settings` - Get slideshow settings (public)

**PUT** `/api/sponsors/settings` - Update slideshow duration (requires auth)
- Body: `{ "slideDuration": number }` (3-60 seconds)

**POST** `/api/sponsors/upload` - Upload sponsor images (requires auth)
- Content-Type: `multipart/form-data`
- Field name: `images` (supports multiple files, max 10)
- Field name: `type` (slideshow/court)
- Max file size: 10MB per image
- Supported formats: JPG, PNG, GIF, WebP (kontrolleret på filens indhold; forkert type giver 400)
- Images automatically resized to max 1920x1080 (slideshow) or 1920x216 (court banners)
- EXIF rotation applied automatically
- New images default to active with no expiration

**PUT** `/api/sponsors/:id/active` - Toggle active status (requires auth)
- Body: `{ "isActive": boolean }`
- Manual control over image visibility
- Expired images cannot be reactivated via toggle

**PUT** `/api/sponsors/:id/expiration` - Set expiration date (requires auth)
- Body: `{ "expirationDate": "ISO-8601 string" | null }`
- Set automatic deactivation date
- Use `null` to remove expiration
- Date must be in the future (max 5 years)
- Images deactivate automatically after expiration

**PUT** `/api/sponsors/:id/courts` - Update court assignments (requires auth)
- Body: `{ "courts": [1, 2, 3] }`
- Only applies to court banner type images
- Assigns banner to specific court numbers

**DELETE** `/api/sponsors/:id` - Delete sponsor image (requires auth)

**GET** `/uploads/:filename` - Serve uploaded images (public)

## Environment Variables

Hemmelighederne står i `.env` (i `.gitignore`), som `deploy.sh` → `scripts/ensure-env.sh` selv opretter og udfylder: værdier, der står der, røres aldrig; mangler de på en kørende installation, hentes de fra containerne; ellers genereres de — men kun på en frisk installation. Skabelonen er `.env.example`.

**Påkrævet** (compose stopper med en besked, hvis én mangler): `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `JWT_SECRET` (også nøglen til de krypterede hemmeligheder i databasen — skift den aldrig i hånden), `FOOTBALL_DB_PASSWORD`, `FOOTBALL_JWT_SECRET`.

**Valgfri**: `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` (indtastes normalt i super-admin), `PLANNER_SOLVER_*`, `BACKUP_INTERVAL_HOURS`/`BACKUP_RETENTION_DAYS` (standard 24 og 14), `MYSQL_MAX_CONNECTIONS` (standard 300). `MAX_FILE_SIZE` (10485760 = 10 MB) og `APP_DOMAIN` (i `installation.env`) er sat i compose.

## Docker Volumes

| Volume | Indhold |
|---|---|
| `mysql_data` | Alle MySQL-databaser |
| `uploads_data` | Badmintons uploads (sponsorbilleder, livestream-logoer, logo-biblioteket) |
| `football_uploads` | Football-modulets uploads |
| `club_backups` | Klubbernes automatiske backups (gzippet JSON) |
| `backups` | Den fulde backup (`db-*.sql.gz` + `uploads-*.tar.gz`) |
| `stats_cache` | Statistikkens cache |

Volumenavnene får compose-projektets navn foran (mappenavnet), fx `badminton-score-counter_backups` — find dem med `docker volume ls`.

Backup sker af sig selv i tre lag:

- **Fuld backup** (`backup`-tjenesten): alle databaser og alle uploads én gang i døgnet, beholdes i 14 dage. Status under super-admin → Serverens helbred.
- **Klubbernes automatiske backup**: hver mandag kl. 02:00 (de 4 seneste beholdes) og før hver gendannelse (de 4 seneste) — kan hentes og gendannes under Indstillinger → Backup & Gendannelse og i super-admin.
- **Download**: klubbens admin og super-admin kan hente en backup-fil og gendanne fra fil.

Gendannelse af den fulde backup: se [INSTALL.md → Backup og gendannelse](INSTALL.md#12-backup-og-gendannelse).

## Tests

| Type | Hvor | Kører |
|------|------|-------|
| **Unit-tests** | `backend/tests/unit/`, `stats/backend/tests/unit/`, `football-app/backend/tests/unit/`, `planner/tests/unit/` (+ planner-løseren i Python og kontrakten JS ↔ Python) | Ingen database eller netværk. GitHub Actions-jobbet `unit` ved hvert push og pull request (`.github/workflows/tests.yml`), sammen med `nginx -t` af konfigurationen |
| **Integrationstests** | `backend/tests/0*.test.js` og `backend/tests/integration/` (skema, klub-isolation, backup → gendan, uploads m.fl.) | Backenden mod en frisk MySQL 8.4 med opdigtede hemmeligheder. GitHub Actions-jobbet `integration` og lokalt i Docker (kommandoen herunder) |

```bash
# Unit-tests (Node 22 som containerne)
cd backend && npm ci && npm run test:unit
cd stats/backend && npm ci && npm run test:unit
cd football-app/backend && npm ci && npm run test:unit
cd planner && npm ci && npm run test:unit

# Integrationstestene lokalt i Docker, fra repoets rod — egen MySQL i hukommelsen,
# rører hverken den lokale installation eller dens volumes
docker compose -f backend/tests/integration/compose.yml up --force-recreate --renew-anon-volumes --abort-on-container-exit --exit-code-from tests --attach tests
```

Kør ikke `npm test` mod en rigtig installation: de gamle integrationstest (`backend/tests/0*.test.js`) ændrer indstillinger, baner og sponsorbilleder i den database, de rammer. Kør dem med compose-kommandoen ovenfor; `backend/tests/integration/koer.js` nægter at køre mod en MySQL, der allerede har data.

## Development

### Running Without Docker

Udvikling og afprøvning sker i Docker (`./deploy.sh` lokalt). Frontenden forventer nginx foran (`/api`, `/uploads` og de andre domæner i `nginx.conf`), og backenden forventer miljøvariablerne fra backend-tjenesten i `docker-compose.yml` (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET` m.fl.) — der er ingen `backend/.env.example`. Unit-testene kører uden database (se [Tests](#tests)).

### Project Structure

```
badminton-app/
├── android-app/         # Android WebView app
│   ├── app/
│   │   ├── src/main/java/com/badminton/courtcounter/
│   │   │   └── MainActivity.kt
│   │   └── build.gradle
│   ├── build.gradle
│   ├── keystore.properties  # Gitignored signing config
│   └── badminton-release-key.jks  # Gitignored keystore
├── backend/
│   ├── config/          # Database & Multer configuration
│   ├── middleware/      # Auth & error handling
│   ├── routes/          # API route handlers
│   ├── migrations/      # Database migrations (for existing installations)
│   ├── uploads/         # Uploaded images storage
│   ├── init.sql         # Database initialization (for NEW installations)
│   ├── server.js        # Express entry point
│   └── package.json
├── frontend/
│   ├── fonts/           # Local woff2 font files (offline support)
│   │   ├── bebas-neue-latin.woff2
│   │   ├── bebas-neue-latin-ext.woff2
│   │   ├── dm-sans-latin.woff2
│   │   └── dm-sans-latin-ext.woff2
│   ├── js/
│   │   └── api.js       # Centralized API client
│   ├── admin.html       # Admin panel
│   ├── admin-script.js
│   ├── court-v3.html    # Court scoring page (Tælleren)
│   ├── court-script-v3.js
│   ├── court-v3-styles.css
│   ├── fonts.css        # @font-face declarations for local fonts
│   ├── settings.html    # Settings page
│   ├── settings-script.js
│   ├── tv-v3.html       # TV display mode
│   ├── tv-script-v3.js
│   ├── sponsor.html     # Sponsor management
│   ├── sponsor-script.js
│   ├── landing.html     # Landing page
│   └── styles.css       # Global styles
├── docker-compose.yml   # Multi-container orchestration
├── Dockerfile.backend   # Backend container
├── Dockerfile.frontend  # Frontend container (Nginx)
├── nginx.conf          # Nginx configuration
└── README.md           # This file
```

### Making Database Schema Changes

Migrationerne kører af sig selv: ved hver opstart kører `backend/config/migrationRunner.js` nye filer i `backend/migrations/` (i navneorden, fx `053_livestream_side.sql`) mod standarddatabasen og alle klubbernes databaser og noterer dem i tabellen `migrations`. Der skal intet køres i hånden.

- Ny tabel eller kolonne: tilføj den både i `backend/init.sql` (nye databaser) og som en ny nummereret migration (eksisterende databaser).
- En migration, der retter **data** (ikke kun skema), skal også stå i `DATA_MIGRATIONER` i `backend/config/dataMigrationer.js`, så den køres igen, når en ældre backup gendannes.

## Deploying Updates

```bash
git pull
./deploy.sh
```

`deploy.sh` sikrer `.env` (`scripts/ensure-env.sh`), bygger og starter alle tjenester med commit og byggetidspunkt (vises i super-admin → Serverens helbred), venter højst 120 s på, at backenden svarer sundt på `/health`, tjekker `/api/health` gennem nginx og rydder ubrugte images (aldrig volumes). Migrationerne kører ved backendens opstart. Fejler helbredstjekket, viser scriptet backendens log og slutter med fejlkode.

Hard-refresh i browseren efter en opdatering: `Ctrl+Shift+R`.

## Troubleshooting

### Application won't start

**Issue**: `./deploy.sh` / `docker compose up` fails

**Solution**: Se loggen (`docker compose logs --tail 200 backend`), og tjek om port 80, 8080 eller 3000 allerede er i brug:
```bash
# Windows
netstat -ano | findstr :8080
netstat -ano | findstr :3000

# Linux/Mac
lsof -i :8080
lsof -i :3000
```

### Database connection errors

**Issue**: Backend can't connect to MySQL

**Solution**: Wait for MySQL to fully initialize (can take 30-60 seconds on first run):
```bash
docker compose logs mysql
# Wait until you see "ready for connections"
```

### Changes not appearing

**Issue**: Frontend changes not visible after update

**Solution**: Browser caching issue. Hard refresh:
- Chrome/Edge: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)
- Firefox: `Ctrl + F5`

### Images not displaying

**Issue**: Uploaded sponsor images show as broken links

**Solution**: Check backend logs and Nginx configuration:
```bash
docker compose logs backend
docker compose logs frontend
# Ensure /uploads/ location has ^~ modifier in nginx.conf
```

### Upload fails with "Request Entity Too Large"

**Issue**: Image upload fails with 413 error

**Solution**: Check `client_max_body_size` in nginx.conf: 50M generelt, 101M for gendan fra fil (`/api/backup/restore` og super-admins restore/logo-pakke). Backenden selv tillader 10 MB pr. billede (5 MB i logo-biblioteket) og 100 MB pr. backup-fil (10 MB på demoen).

### Scores not syncing

**Issue**: TV display not showing current scores

**Solution**:
1. Check if court is marked as "Active" in Admin panel
2. Verify game has activity (score > 0 or timer running)
3. Check browser console for API errors

## Performance Notes

- **Auto-save Debouncing**: Court page saves are debounced to maximum 1 save per 2 seconds
- **Admin Panel Polling**: Admin overview refreshes every 2.5 seconds (optimized from 1 second)
- **Database Optimization**: Efficient query batching eliminates N+1 query problems
- **Image Optimization**: Uploaded images are automatically resized to 1920x1080 max and compressed to 90% quality
- **Connection Pooling**: Én MySQL-pulje pr. klub (højst 15 forbindelser, `DB_POOL_SIZE`; ledige lukkes efter 60 s) og en lille til master-databasen
- **Caching**: Static assets cached for 1 year, API responses not cached

## Security

- **Password Hashing**: Admin password stored with bcrypt (salt rounds: 10)
- **JWT Authentication**: Protected endpoints require valid JWT token
- **Rate Limiting**: Protection against brute force and DOS attacks
  - Login (admin/klub-admin): 10 forsøg pr. 5 min pr. IP; super-admin: 5 pr. 15 min
  - Upload: 20 pr. 5 min pr. IP (lokalt net undtaget)
  - Ingen grænse på læse-/poll-endpoints (se version 2.5.0)
- **Input Validation**: All API inputs validated before processing
- **File Upload Validation**: type (whitelist), filens indhold (magic bytes) og størrelse; multer 2.x
- **SQL Injection Prevention**: Parameterized queries only
- **XSS Prevention**: User input escaped with escapeHtml() on frontend
- **HTTPS Ready**: Configure reverse proxy (Caddy/Traefik) for production HTTPS

## License

MIT (som angivet i `package.json`; der er ingen separat LICENSE-fil)

## Credits

Developed for badminton clubs and tournaments needing real-time score tracking with multi-device support.
