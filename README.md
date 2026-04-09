# Badminton Counter App

A real-time badminton score tracking system with multi-device support, sponsor slideshow, and match history tracking.

## Features

- **Real-time Score Tracking**: Track scores for multiple courts simultaneously
- **Multi-Device Sync**: All devices stay in sync via MySQL database
- **Dual Court Views**:
  - **Classic View**: Traditional scoring interface
  - **Court V3 (Bane View)**: Visual court representation with player positioning
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

**Upgrading from 1.7.0:**
```bash
git pull
docker-compose down
docker-compose up -d --build
```
Run any new migration files in `backend/migrations/` after rebuilding (see migration list below).

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

**Upgrading from previous versions:**
```bash
git pull
docker-compose down
docker-compose up -d --build
```
The `--build` flag ensures all new dependencies are installed automatically.

## 📋 Installationsvejledning

Komplet trin-for-trin guide til installation på ny server (inkl. Git og Docker):

**[→ INSTALL.md](INSTALL.md)** — Komplet installationsvejledning (Ubuntu/Debian + Windows)

---

## 🍓 Raspberry Pi Support

This app runs great on Raspberry Pi! We provide optimized Docker configurations for ARM architecture.

**Quick Start for Raspberry Pi**:
```bash
./start-rpi.sh
```

**Or manually**:
```bash
docker-compose -f docker-compose.rpi.yml up -d
```

**Full guides available**:
- 📘 [Raspberry Pi Installation Guide](README.RASPBERRY_PI.md) - Complete setup instructions
- 🚀 [Quick Start Guide](QUICKSTART.RASPBERRY_PI.md) - Get running in 4 commands

**Tested on**: Raspberry Pi 3B+, 4 (2GB/4GB/8GB), 5, and Pi 400

---

## 📱 Android App

A dedicated Android app is available for court-side displays. The app provides a fullscreen WebView optimized for tablets and phones.

### Features

- **Dynamic Court Version**: Automatically loads Klassisk or Bane view based on server settings
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

The app offers two court display modes, selectable in Admin → Settings:

### Klassisk View (Classic)
Traditional scoring interface optimized for quick score entry. Best for simple, fast-paced scoring.

**Features:**
- Large score displays
- Quick +1 buttons
- Timer and set tracking
- Player name inputs
- Doubles/singles toggle

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

### Prerequisites

- Docker and Docker Compose installed
- Git installed

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd badminton-app
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Edit `.env` and set your passwords and secrets:
```env
MYSQL_ROOT_PASSWORD=your_secure_root_password
MYSQL_PASSWORD=your_secure_db_password
JWT_SECRET=your_jwt_secret_min_32_chars
```

4. Start the application:
```bash
docker-compose up -d
```

5. Access the application:
- **Main App**: http://localhost:8080
- **Backend API**: http://localhost:3000 (internal use)

### First Time Setup

1. Open http://localhost:8080
2. Set the number of courts you want to track
3. Click on "Admin" and log in with default password: `admin123`
4. **IMPORTANT**: Change the admin password immediately in Admin > Settings

## Complete Beginner's Guide to Docker Deployment

### What is Docker?

Docker is a tool that packages your application with everything it needs (code, database, web server) into "containers" - think of them as lightweight virtual machines. This means the app will work the same way on any computer.

### Step 1: Install Docker Desktop

**Windows:**
1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop
2. Run the installer (DockerDesktop.exe)
3. Follow the installation wizard
4. Restart your computer when prompted
5. Open Docker Desktop - you'll see a whale icon in your system tray when it's running
6. Wait for "Docker Desktop is running" message

**Mac:**
1. Download Docker Desktop for Mac from: https://www.docker.com/products/docker-desktop
2. Open the .dmg file and drag Docker to Applications
3. Launch Docker from Applications
4. Grant permissions when asked
5. Wait for Docker to start (whale icon in menu bar)

**Linux:**
- Follow instructions at: https://docs.docker.com/engine/install/

### Step 2: Verify Docker is Working

Open a terminal/command prompt and run:
```bash
docker --version
docker-compose --version
```

You should see version numbers. If you get "command not found", Docker isn't installed correctly.

### Step 3: Get the Code

**Option A: If you have Git installed**
```bash
# Open terminal/command prompt and run:
git clone https://github.com/CesarDKK/badminton-score-counter.git
cd badminton-score-counter
```

**Option B: Without Git**
1. Go to: https://github.com/CesarDKK/badminton-score-counter
2. Click green "Code" button → "Download ZIP"
3. Extract the ZIP file
4. Open terminal/command prompt
5. Navigate to the extracted folder:
   ```bash
   # Windows example:
   cd C:\Users\YourName\Downloads\badminton-score-counter

   # Mac/Linux example:
   cd ~/Downloads/badminton-score-counter
   ```

### Step 4: Configure Environment Variables

**Windows:**
```bash
copy .env.example .env
notepad .env
```

**Mac/Linux:**
```bash
cp .env.example .env
nano .env
```

Edit the file and change these values to something secure:
```env
MYSQL_ROOT_PASSWORD=MySecurePassword123!
MYSQL_PASSWORD=AnotherSecurePass456!
JWT_SECRET=ThisIsMyVeryLongSecretKeyForJWTTokens32CharsMin
```

**Important:**
- Use strong passwords (no simple passwords like "password123")
- JWT_SECRET must be at least 32 characters long
- Save the file and close the editor

### Step 5: Start the Application

In the terminal (make sure you're in the badminton-score-counter folder):

```bash
docker-compose up -d
```

**What this command does:**
- `docker-compose` - Uses the docker-compose.yml file to start multiple containers
- `up` - Start the services
- `-d` - Run in background (detached mode)

**First time running:** This will take 5-10 minutes because Docker needs to:
1. Download the base images (MySQL, Node.js, Nginx)
2. Build your custom containers
3. Start the database and initialize tables
4. Start the backend and frontend

You'll see lots of text scrolling - this is normal!

### Step 6: Check if Everything is Running

```bash
docker-compose ps
```

You should see 3 services running:
- `badminton-app-mysql-1` (database)
- `badminton-app-backend-1` (API server)
- `badminton-app-frontend-1` (web server)

All should show "Up" status.

### Step 7: Access Your Application

Open your web browser and go to:
```
http://localhost:8080
```

You should see the Badminton Counter landing page!

### Step 8: Initial Setup

1. Select how many courts you want (e.g., 4)
2. Click "Admin Panel" button
3. Login with password: `admin123`
4. **IMMEDIATELY** go to Admin → Change Password and set a new password
5. Start using the app!

### Common Docker Commands

**View running containers:**
```bash
docker-compose ps
```

**View logs (helpful for troubleshooting):**
```bash
# All services
docker-compose logs

# Just backend
docker-compose logs backend

# Just database
docker-compose logs mysql

# Follow logs in real-time (Ctrl+C to stop)
docker-compose logs -f
```

**Stop the application:**
```bash
docker-compose down
```

**Start again:**
```bash
docker-compose up -d
```

**Restart after making code changes:**
```bash
docker-compose down
docker-compose up -d --build
```

**Remove everything (including data - careful!):**
```bash
docker-compose down -v
```

### Troubleshooting for Beginners

**Problem: "Port already in use" error**

Another program is using port 8080 or 3000.

Solution:
```bash
# Windows - check what's using the port
netstat -ano | findstr :8080

# Mac/Linux
lsof -i :8080

# Kill the process or change the port in docker-compose.yml
```

**Problem: "Cannot connect to Docker daemon"**

Docker Desktop isn't running.

Solution:
- Open Docker Desktop application
- Wait for it to fully start (green light in bottom left)
- Try the command again

**Problem: Application shows error or blank page**

Database might still be initializing.

Solution:
```bash
# Check backend logs
docker-compose logs backend

# Wait 30-60 seconds for MySQL to initialize
# Look for "ready for connections" in MySQL logs
docker-compose logs mysql
```

**Problem: Changes not appearing**

Browser cache issue.

Solution:
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Or open in incognito/private window

**Problem: Upload images failing**

Permissions issue on uploads folder.

Solution:
```bash
# Windows (in PowerShell as Administrator)
docker exec badminton-app-backend-1 mkdir -p /app/uploads
docker exec badminton-app-backend-1 chmod 777 /app/uploads

# Mac/Linux
docker exec badminton-app-backend-1 mkdir -p /app/uploads
docker exec badminton-app-backend-1 chmod 777 /app/uploads
```

### Where is My Data Stored?

Your data is stored in Docker volumes (persistent storage):
- **Database:** All scores, courts, history
- **Uploads:** Sponsor images

Even if you stop the containers, your data is safe. It only gets deleted if you run `docker-compose down -v` (the `-v` flag removes volumes).

### Accessing from Other Devices (Same Network)

Want to access from tablets/phones on the same WiFi?

1. Find your computer's IP address:
   ```bash
   # Windows
   ipconfig
   # Look for "IPv4 Address" (usually 192.168.x.x)

   # Mac/Linux
   ifconfig
   # Look for inet address (usually 192.168.x.x)
   ```

2. On other devices, open browser and go to:
   ```
   http://192.168.x.x:8080
   ```
   (Replace x.x with your actual IP numbers)

3. Make sure your firewall allows connections on port 8080

### Next Steps

Once everything is running:
- Test scoring on a court
- Check the TV display updates in real-time
- Try uploading sponsor images
- Explore the admin panel
- View match history

If you run into issues, check the logs with `docker-compose logs` and look for error messages.

## Architecture

### Automated Background Tasks

The backend runs scheduled tasks using `node-cron`:

1. **Midnight Court Reset** (Daily at 00:00 Europe/Copenhagen)
   - Clears all game states
   - Sets all courts to inactive
   - Fresh start for each day

2. **Sponsor Expiration Check** (Hourly at minute 0)
   - Deactivates sponsor images past their expiration date
   - Ensures expired sponsorships don't display
   - Runs even when TV displays are off

**Hybrid Expiration Strategy:**
- On-demand: Checked on every `/api/sponsors/images` request (max 10 sec delay for TV)
- Scheduled: Hourly background check as safety net

### Three-Tier System

```
┌─────────────────────────────────────────┐
│         Frontend (Nginx)                │
│  - Serves static HTML/CSS/JS            │
│  - Proxies /api/* to backend            │
│  - Proxies /uploads/* to backend        │
│  Port: 8080                             │
└─────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│      Backend (Node.js + Express)        │
│  - REST API endpoints                   │
│  - JWT authentication                   │
│  - Image upload & processing (Sharp)    │
│  - File storage management              │
│  Port: 3000                             │
└─────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│         Database (MySQL 8.0)            │
│  - Courts configuration                 │
│  - Game states                          │
│  - Match history                        │
│  - Sponsor metadata                     │
│  - Settings                             │
│  Port: 3306 (internal)                  │
└─────────────────────────────────────────┘
```

### Database Schema

**settings**: Global app settings
- `admin_password_hash`: Bcrypt hashed admin password
- `court_count`: Number of available courts
- `show_reset_button`: Tournament mode toggle (false = tournament mode)
- `court_version`: Court view version ('v2' = Klassisk, 'v3' = Bane view)
- `theme_*`: Color theme settings

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

**GET** `/api/match-history/all` - Get all match history (public)
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
- Supported formats: JPG, PNG, GIF
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

### Required Variables

**MYSQL_ROOT_PASSWORD**: MySQL root password (used by Docker)

**MYSQL_PASSWORD**: Application database password

**JWT_SECRET**: Secret key for JWT token signing (minimum 32 characters)

### Optional Variables

**MAX_FILE_SIZE**: Maximum upload file size in bytes (default: 10485760 = 10MB)

**NODE_ENV**: Environment mode (development|production)

## Docker Volumes

The application uses persistent volumes for data storage:

- **mysql_data**: MySQL database files
- **uploads_data**: Uploaded sponsor images

To backup data:
```bash
# Backup database
docker-compose exec mysql mysqldump -u badminton_user -p badminton_app > backup.sql

# Backup uploads
docker cp badminton-app-backend-1:/app/uploads ./uploads-backup
```

To restore data:
```bash
# Restore database
docker-compose exec -T mysql mysql -u badminton_user -p badminton_app < backup.sql

# Restore uploads
docker cp ./uploads-backup/. badminton-app-backend-1:/app/uploads
```

## Development

### Running Without Docker

**Backend:**
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your settings
npm start
```

**Frontend:**
Serve the `frontend` directory with any static file server:
```bash
cd frontend
npx http-server -p 8080
```

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
│   │   ├── api.js       # Centralized API client (v4)
│   │   └── api-v2.js    # Legacy API client
│   ├── admin.html       # Admin panel
│   ├── admin-script.js
│   ├── court.html       # Court scoring page (Classic)
│   ├── court-script-v2.js
│   ├── court-v3.html    # Court scoring page (Bane View)
│   ├── court-script-v3.js
│   ├── court-v3-styles.css
│   ├── fonts.css        # @font-face declarations for local fonts
│   ├── settings.html    # Settings page
│   ├── settings-script.js
│   ├── tv.html          # TV display mode
│   ├── tv-script-v2.js
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

**⚠️ CRITICAL: When adding new database columns or tables, you MUST update BOTH files:**

1. **`backend/init.sql`** - For NEW installations
   - This file creates the database schema from scratch
   - Add new columns/tables directly to the CREATE TABLE statements
   - Example: `ALTER TABLE` → `CREATE TABLE ... new_column TYPE`

2. **`backend/migrations/XXX_description.sql`** - For EXISTING installations
   - Create a new migration file with the next number (e.g., `004_add_new_feature.sql`)
   - Use `ALTER TABLE` statements to add columns to existing tables
   - Include comments explaining the purpose
   - Example: `ALTER TABLE table_name ADD COLUMN new_column TYPE`

**Why both files?**
- `init.sql` runs ONLY on fresh installations (first time setup)
- Migration files run on existing installations to update their schema
- Without updating `init.sql`, new installations will be missing columns!

**Example workflow:**

If you add a new column `is_active` to the `sponsor_images` table:

```sql
-- backend/init.sql
CREATE TABLE IF NOT EXISTS sponsor_images (
  id INT PRIMARY KEY AUTO_INCREMENT,
  filename VARCHAR(255) UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,  -- ← ADD HERE
  ...
);
```

```sql
-- backend/migrations/004_add_sponsor_active.sql
ALTER TABLE sponsor_images
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
```

**Running migrations on existing installations:**

The `backend/migrations/` folder is mounted in the MySQL container, making it easy to run migrations:

```bash
# Option 1: Interactive (connect to MySQL shell)
docker exec -it badminton-mysql mysql -u badminton_user -p badminton_counter

# In MySQL prompt, run the migration:
source /docker-entrypoint-initdb.d/migrations/004_add_sponsor_active.sql;
exit;

# Option 2: One-liner (replace 'password' with your DB password)
docker exec -i badminton-mysql mysql -u badminton_user -pYOUR_PASSWORD badminton_counter \
  -e "source /docker-entrypoint-initdb.d/migrations/004_add_sponsor_active.sql"
```

**Migration folder structure:**

```
backend/migrations/
├── 001_add_match_completed.sql
├── 002_add_sponsor_type.sql
├── 003_add_sponsor_court_assignments.sql
├── 004_add_sponsor_active_expiration.sql  # Adds is_active and expiration_date
├── 005_add_court_version.sql              # Adds court_version to settings
├── 006_add_tv_version.sql                 # Adds tv_version to settings
├── 007_add_is_doubles_reset.sql           # Ensures is_doubles resets with court
└── 008_fix_version_defaults.sql           # Corrects court_version/tv_version defaults to 'v3'
```

All migration files are automatically available in the container at `/docker-entrypoint-initdb.d/migrations/`.

**Recent Migrations:**
- **004_add_sponsor_active_expiration.sql**: Adds active/inactive status and automatic expiration for sponsor images
  - `is_active BOOLEAN NOT NULL DEFAULT TRUE` - Manual visibility control
  - `expiration_date TIMESTAMP NULL` - Automatic deactivation date
  - Creates index for efficient filtering
  - Backwards compatible (existing images set to active, no expiration)
- **005_add_court_version.sql**: Adds `court_version` column to the settings table
- **006_add_tv_version.sql**: Adds `tv_version` column to the settings table
- **007_add_is_doubles_reset.sql**: Ensures `is_doubles` is included in court reset logic
- **008_fix_version_defaults.sql**: Corrects `court_version` and `tv_version` default values from `'v2'` to `'v3'`

## Deploying Updates

When you pull new code changes or make modifications, follow these steps to deploy them:

### For Code Changes (Backend/Frontend)

```bash
# 1. Pull latest changes (if from git)
git pull

# 2. Stop containers
docker-compose down

# 3. Rebuild and start with new code
docker-compose up -d --build

# The --build flag ensures Docker rebuilds images with your new code
```

### For Database Schema Changes

If the update includes new migration files in `backend/migrations/`:

```bash
# 1. Deploy the code first (see above)
docker-compose down
docker-compose up -d --build

# 2. Check which migrations need to be run
# Compare migration files with your database state

# 3. Run the new migration
docker exec -it badminton-mysql mysql -u badminton_user -p badminton_counter

# In MySQL prompt:
source /docker-entrypoint-initdb.d/migrations/XXX_new_migration.sql;
exit;
```

**Important Notes:**
- `init.sql` only runs on FIRST database creation (new installations)
- Existing installations MUST run migration files manually
- Always backup your database before running migrations
- Test migrations on a development copy first

### Quick Deploy Checklist

- [ ] Backup database: `docker-compose exec mysql mysqldump -u badminton_user -p badminton_counter > backup.sql`
- [ ] Pull/update code: `git pull` or copy new files
- [ ] Rebuild containers: `docker-compose down && docker-compose up -d --build`
- [ ] Run migrations: Check `backend/migrations/` for new files and run them
- [ ] Verify deployment: Check `/health` endpoint and test functionality
- [ ] Clear browser cache: Hard refresh (Ctrl+Shift+R) on all devices

## Troubleshooting

### Application won't start

**Issue**: `docker-compose up` fails

**Solution**: Check if ports 8080 or 3000 are already in use:
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
docker-compose logs mysql
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
docker-compose logs backend
docker-compose logs frontend
# Ensure /uploads/ location has ^~ modifier in nginx.conf
```

### Upload fails with "Request Entity Too Large"

**Issue**: Image upload fails with 413 error

**Solution**: Check `client_max_body_size` in nginx.conf (should be 50M)

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
- **Connection Pooling**: Backend uses MySQL connection pool (max 10 connections)
- **Caching**: Static assets cached for 1 year, API responses not cached

## Security

- **Password Hashing**: Admin password stored with bcrypt (salt rounds: 10)
- **JWT Authentication**: Protected endpoints require valid JWT token
- **Rate Limiting**: Protection against brute force and DOS attacks
  - Login attempts: Max 5 per 15 minutes
  - Upload operations: Max 10 per 15 minutes
  - Admin operations: Max 100 per 15 minutes
  - Public endpoints: Max 200 per 15 minutes
- **Input Validation**: All API inputs validated before processing
- **File Upload Validation**: MIME type and file size checks
- **SQL Injection Prevention**: Parameterized queries only
- **XSS Prevention**: User input escaped with escapeHtml() on frontend
- **HTTPS Ready**: Configure reverse proxy (Caddy/Traefik) for production HTTPS

## License

MIT License - See LICENSE file for details

## Credits

Developed for badminton clubs and tournaments needing real-time score tracking with multi-device support.
