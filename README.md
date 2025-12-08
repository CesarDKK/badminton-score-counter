# Badminton Counter App

A real-time badminton score tracking system with multi-device support, sponsor slideshow, and match history tracking.

## Features

- **Real-time Score Tracking**: Track scores for multiple courts simultaneously
- **Multi-Device Sync**: All devices stay in sync via MySQL database
- **TV Display Mode**: Full-screen display for showing current games
- **Admin Panel**: Manage courts, view match history, and configure settings
- **Sponsor Slideshow**: Upload and display sponsor images with configurable duration
- **Match History**: Automatic tracking of completed matches with statistics
- **Timer Support**: Built-in timer for tracking match duration

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

**settings**: Global app settings (admin password, court count)

**courts**: Court configurations (active status, doubles mode, game mode)

**game_states**: Current game state per court (scores, timers, player names)

**match_history**: Completed match records with winner/loser and duration

**sponsor_images**: Sponsor image metadata (filename, dimensions, upload date)

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

**GET** `/api/sponsors/settings` - Get slideshow settings (public)

**PUT** `/api/sponsors/settings` - Update slideshow duration (requires auth)
- Body: `{ "slideDuration": number }` (3-60 seconds)

**POST** `/api/sponsors/upload` - Upload sponsor images (requires auth)
- Content-Type: `multipart/form-data`
- Field name: `images` (supports multiple files, max 10)
- Max file size: 10MB per image
- Supported formats: JPG, PNG, GIF
- Images automatically resized to max 1920x1080 and EXIF rotation applied

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
├── backend/
│   ├── config/          # Database & Multer configuration
│   ├── middleware/      # Auth & error handling
│   ├── routes/          # API route handlers
│   ├── uploads/         # Uploaded images storage
│   ├── init.sql         # Database initialization
│   ├── server.js        # Express entry point
│   └── package.json
├── frontend/
│   ├── js/
│   │   └── api-v2.js    # Centralized API client
│   ├── admin.html       # Admin panel
│   ├── admin-script.js
│   ├── court.html       # Court scoring page
│   ├── court-script-v2.js
│   ├── tv.html          # TV display mode
│   ├── tv-script.js
│   ├── sponsor.html     # Sponsor management
│   ├── sponsor-script.js
│   └── index.html       # Landing page
├── docker-compose.yml   # Multi-container orchestration
├── Dockerfile.backend   # Backend container
├── Dockerfile.frontend  # Frontend container (Nginx)
├── nginx.conf          # Nginx configuration
└── README.md           # This file
```

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
- **Image Optimization**: Uploaded images are automatically resized to 1920x1080 max and compressed to 90% quality
- **Connection Pooling**: Backend uses MySQL connection pool (max 10 connections)
- **Caching**: Static assets cached for 1 year, API responses not cached

## Security

- **Password Hashing**: Admin password stored with bcrypt (salt rounds: 10)
- **JWT Authentication**: Protected endpoints require valid JWT token
- **Input Validation**: All API inputs validated before processing
- **File Upload Validation**: MIME type and file size checks
- **SQL Injection Prevention**: Parameterized queries only
- **XSS Prevention**: User input escaped with escapeHtml() on frontend
- **HTTPS Ready**: Configure reverse proxy (Caddy/Traefik) for production HTTPS

## License

MIT License - See LICENSE file for details

## Credits

Developed for badminton clubs and tournaments needing real-time score tracking with multi-device support.
