# Badminton Score Counter

A web-based badminton score tracking application with multi-court support.

## Features

- **Landing Page**: Central hub to select courts, TV displays, and access admin panel
- **Separate Court Pages**: Each court has its own dedicated page with isolated data
- **TV Display Mode**: Large screen, read-only displays for spectators
  - **Auto-Refresh**: Updates every 1 second for real-time viewing
  - **Full Screen Ready**: Optimized for large displays and projectors
  - **Spectator Friendly**: Large fonts, high contrast, minimal UI
  - **Live Indicator**: Pulsing "LIVE" badge shows active updates
- **Data Isolation**: Court data is completely isolated - no cross-court data visibility
- **Score Tracking**: Real-time score tracking for two players/teams
- **Game/Set Tracking**: Automatic game win detection following official badminton rules (first to 21, win by 2, max 30)
- **Auto-Start Timer**: Timer automatically starts when the first point is scored
- **Multi-Court Support**: Manage multiple courts (1-20) with independent scores
- **Match History**: Automatically saves match results for each court (last 10 matches)
- **Dark Theme**: Modern dark color scheme throughout the application
- **Admin Dashboard**: Separate password-protected admin page with:
  - **Court Overview**: Real-time view of all courts and their current matches
  - **Auto-Refresh**: Court states update automatically every 2 seconds
  - **Edit Any Court**: Change player names for courts before or during matches
  - **Active Status Toggle**: Mark courts as active before games start (reservations, pre-setup)
  - **Reset Courts**: Reset individual courts from the admin panel
  - **Court Management**: Configure number of courts (1-20)
  - **Security**: Change admin password
  - **Data Management**: Clear all court data if needed
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Local Storage**: All data persists in browser's localStorage

## Default Admin Credentials

- **Password**: `admin123`

(Change this in the admin panel after first login!)

## Running with Docker

### Build and run:
```bash
docker-compose up -d
```

### Access the application:
- **Landing Page**: http://localhost:8080 (redirects to landing page)
- **Court Selection**: http://localhost:8080/landing.html
- **Individual Courts**: http://localhost:8080/court.html?id=1 (replace 1 with court number)
- **TV Displays**: http://localhost:8080/tv.html?id=1 (replace 1 with court number)
- **Admin Dashboard**: http://localhost:8080/admin.html

### Stop the application:
```bash
docker-compose down
```

### Rebuild after changes:
```bash
docker-compose up -d --build
```

## Usage

### Landing Page (Entry Point)
1. **Select Court**: Click on any court button to open that court's page
2. **TV Displays Section**: Below court buttons, find TV display links
   - Click "Court X TV" to open spectator display
   - Opens in new window/tab
   - Perfect for large screens or projectors
3. **Admin Access**: Click "Admin Panel" in the top right to access admin features
4. **Court Count**: Automatically displays all configured courts

### Court Pages (Individual Court)
1. **Court Display**: Header shows which court you're on
2. **Back Button**: Return to landing page anytime
3. **Enter Player Names**: Click on "Player 1" and "Player 2" to edit names
4. **Score Points**: Use the +1 buttons to add points (or -1 to remove)
   - **Timer automatically starts** when you score the first point!
5. **Timer Controls**: Manually start/pause/reset the timer if needed
6. **New Game**: Start a new game while keeping the game count
7. **New Match**: Reset everything and start fresh
8. **Match History**: View previous matches for this specific court only
9. **Admin Access**: Quick link to admin dashboard
10. **Data Isolation**: Each court only sees and saves its own data

### TV Display Pages (Spectator View)
1. **Large Format**: Designed for big screens, projectors, or TVs
2. **Read-Only**: No controls or interactive elements
3. **Auto-Update**: Refreshes every 1 second automatically
4. **Shows**:
   - Court number in header
   - Large player names
   - Huge score displays (main focus)
   - Games won count
   - Match timer
   - Live indicator
5. **Usage**: Open on TV/projector near each court for spectators to follow matches
6. **Full Screen**: Press F11 in browser for full-screen experience

### Admin Dashboard (Management)
1. **Login**: Enter admin password (default: `admin123`)
2. **Court Overview**: View all courts and their current match states in real-time
   - See player names, scores, games won, and match duration
   - Active/Inactive status indicators
   - Auto-refreshes every 2 seconds
3. **Edit Court**: Click "Edit Court" button on any court card to:
   - Set or change player names (works before game starts)
   - **Mark as Active**: Toggle to mark court as occupied/reserved before scoring begins
   - This is perfect for pre-game setup or indicating court reservations
   - Reset the entire court
4. **Court Management**: Adjust the number of available courts (1-20)
5. **Change Password**: Update the admin password for security
6. **Clear All Data**: Remove all court data if needed (requires double confirmation)
7. **Back to Courts**: Return to landing page

## Game Rules

- First player to reach 21 points wins
- Must win by at least 2 points
- If score reaches 29-29, next point wins (30 point cap)
- Timer automatically starts on first point scored
- Match history automatically saved when a game is won

## Technical Details

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Design**: Dark theme with purple/pink gradient accents
- **Web Server**: Nginx (Alpine Linux)
- **Storage**: Browser localStorage
- **Container**: Docker

## Data Persistence & Isolation

All data (scores, settings, history) is stored in browser's localStorage:
- **Complete Court Isolation**: Each court stores data with a unique key (`gameState_court1`, `gameState_court2`, etc.)
- **No Cross-Court Visibility**: Court pages only load and display data for their specific court ID
- **Independent Match History**: Each court maintains its own match history (last 10 matches)
- **Global Settings**: Admin password and court count stored globally
- **Session Persistence**: All data persists across browser sessions
- **Clean Slate**: Clearing browser data will reset everything

## Architecture

- **Landing Page** (`landing.html`): Court selection hub with TV display links
- **Court Pages** (`court.html?id=X`): Individual court interfaces using URL parameters
- **TV Display** (`tv.html?id=X`): Spectator-friendly, auto-updating display pages
- **Admin Dashboard** (`admin.html`): Central management and monitoring
- **Data Keys**: `gameState_court{N}` and `matchHistory_court{N}` ensure complete isolation

## Professional Setup Recommendations

For a professional badminton facility:

1. **Court Scorekeeping**: Tablets/phones at each court running `court.html?id=X`
2. **TV Displays**: Large screens near courts showing `tv.html?id=X` for spectators
3. **Admin Station**: Central desk running `admin.html` to monitor all courts
4. **Landing Kiosk**: Entry area with `landing.html` for easy navigation

All devices can run from the same Docker instance!