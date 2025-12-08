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
