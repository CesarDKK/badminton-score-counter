# Raspberry Pi Files Overview

This document lists all Raspberry Pi-specific files and their purposes.

## Core Configuration Files

### `docker-compose.rpi.yml`
**Purpose**: Docker Compose configuration optimized for Raspberry Pi ARM architecture

**Key differences from standard version**:
- Uses MariaDB 11 instead of MySQL 8.0 (better ARM support)
- Platform specification: `linux/arm64`
- Memory limits: 512MB for DB, 768MB for backend, 256MB for frontend
- Optimized database settings for Raspberry Pi
- Extended startup grace periods
- Node.js heap size limited to 512MB

**Usage**:
```bash
docker-compose -f docker-compose.rpi.yml up -d
```

---

### `Dockerfile.backend.rpi`
**Purpose**: Backend Docker image build file for ARM architecture

**Optimizations**:
- Based on `node:18-alpine` (ARM compatible)
- npm cache cleaned after install
- Node.js memory limit: 512MB
- Longer health check start period (60s)

---

### `Dockerfile.frontend.rpi`
**Purpose**: Frontend Docker image build file for ARM architecture

**Optimizations**:
- Based on `nginx:alpine` (ARM compatible)
- Reduced worker processes for Raspberry Pi
- Lower connection limits
- Minimal resource footprint

---

## Documentation Files

### `README.RASPBERRY_PI.md`
**Purpose**: Comprehensive Raspberry Pi installation and operation guide

**Contents**:
- Compatible Raspberry Pi models
- Complete installation steps
- Docker installation on Raspberry Pi
- Raspberry Pi specific optimizations explained
- Performance tips and tuning
- Troubleshooting guide
- Backup and restore procedures
- Auto-start on boot setup
- Security recommendations
- Advanced configurations (USB SSD, overclocking)

**When to use**: Full reference guide for setting up and managing the app on Raspberry Pi

---

### `QUICKSTART.RASPBERRY_PI.md`
**Purpose**: Fast-track guide to get running quickly

**Contents**:
- 4-command installation
- One-line command reference
- Quick troubleshooting
- System requirements table
- First-time setup checklist

**When to use**: When you want to get up and running fast without reading the full guide

---

### `KIOSK.RASPBERRY_PI.md`
**Purpose**: Setting up a Raspberry Pi as a **TV display** in the hall (not as a server)

**Contents**:
- Hardware recommendations for the display Pi
- Why no desktop environment is needed (`cage` instead)
- Step-by-step install via `setup-kiosk-rpi.sh`
- HDMI-CEC: turning the TV on/off from the Pi
- SD card protection with overlay filesystem
- Troubleshooting table (black screen, overscan, undervoltage, CEC)
- Manual setup without the script

**When to use**: When a screen in the hall should boot straight into `tv-v3.html`
or `oversigt.html` in fullscreen.

> **Note**: This is a *different role* from the other Raspberry Pi documents.
> The others cover running the **server** (Docker, backend, database).
> Don't put both roles on the same Pi.

---

### `RASPBERRY_PI_FILES.md` (this file)
**Purpose**: Overview of all Raspberry Pi-specific files

---

## Helper Scripts

### `start-rpi.sh`
**Purpose**: Automated startup script with system checks

**Features**:
- Verifies ARM architecture
- Checks Docker and docker-compose installation
- Validates .env file exists
- Displays system info (memory, disk, temperature)
- Warns about low resources
- Pulls latest images (if internet available)
- Starts the application
- Shows access URLs

**Usage**:
```bash
chmod +x start-rpi.sh
./start-rpi.sh
```

---

### `stop-rpi.sh`
**Purpose**: Clean shutdown script

**Usage**:
```bash
chmod +x stop-rpi.sh
./stop-rpi.sh
```

---

### `setup-kiosk-rpi.sh`
**Purpose**: One-shot setup of a Raspberry Pi as a fullscreen **TV display**

**Features**:
- Installs `cage` + `chromium` (no desktop environment)
- Writes `/etc/badminton-kiosk.conf` so the URL can be changed without touching systemd
- Creates a systemd service that starts at boot and restarts on crash
- Forces the HDMI resolution so the picture is right even if the TV was off at boot
- Optional HDMI-CEC schedule for turning the TV on/off
- Nightly browser restart

**Usage**:
```bash
chmod +x setup-kiosk-rpi.sh
sudo ./setup-kiosk-rpi.sh --url "http://SERVER-IP:8080/tv-v3.html?id=1"
```

**Note**: Runs on the *display* Pi, not on the server Pi. See `KIOSK.RASPBERRY_PI.md`.

---

## File Structure

```
badminton-app/
├── docker-compose.yml              # Standard x86/x64 version
├── docker-compose.rpi.yml          # Raspberry Pi ARM version ⭐
├── Dockerfile.backend              # Standard backend
├── Dockerfile.backend.rpi          # Raspberry Pi backend ⭐
├── Dockerfile.frontend             # Standard frontend
├── Dockerfile.frontend.rpi         # Raspberry Pi frontend ⭐
├── README.md                       # Main documentation (updated with Pi info)
├── README.RASPBERRY_PI.md          # Full Raspberry Pi guide ⭐
├── QUICKSTART.RASPBERRY_PI.md      # Quick start guide ⭐
├── KIOSK.RASPBERRY_PI.md           # TV display guide (different role) ⭐
├── RASPBERRY_PI_FILES.md           # This file ⭐
├── start-rpi.sh                    # Start script ⭐
├── stop-rpi.sh                     # Stop script ⭐
├── setup-kiosk-rpi.sh              # TV display setup ⭐
├── .env.example                    # Environment variables template
├── .env                            # Your actual environment file (create this)
├── backend/                        # Backend source code
├── frontend/                       # Frontend source code
└── nginx.conf                      # Nginx configuration

⭐ = Raspberry Pi specific files
```

---

## Quick Reference

### Standard Installation (x86/x64)
```bash
docker-compose up -d
```

### Raspberry Pi Installation (ARM)
```bash
docker-compose -f docker-compose.rpi.yml up -d
# OR
./start-rpi.sh
```

---

## Resource Usage Comparison

| Component | Standard | Raspberry Pi |
|-----------|----------|--------------|
| Database Image | MySQL 8.0 | MariaDB 11 |
| DB Memory Limit | Unlimited | 512MB |
| Backend Memory | Unlimited | 768MB |
| Frontend Memory | Unlimited | 256MB |
| Node Heap Size | Default (~1.4GB) | 512MB |
| DB Connections | Unlimited | 50 max |
| Worker Processes | Auto | 2 |

---

## Migration Notes

### From Standard to Raspberry Pi

If you're moving from the standard version to Raspberry Pi:

1. **Backup your data first**:
```bash
docker-compose exec mysql mysqldump -u badminton_user -p badminton_counter > backup.sql
docker cp badminton-backend:/app/uploads ./uploads-backup
```

2. **Stop standard version**:
```bash
docker-compose down
```

3. **Start Raspberry Pi version**:
```bash
docker-compose -f docker-compose.rpi.yml up -d
```

4. **Restore data** (after DB is ready):
```bash
docker-compose -f docker-compose.rpi.yml exec -T mysql mysql -u badminton_user -p badminton_counter < backup.sql
docker cp ./uploads-backup/. badminton-backend:/app/uploads
```

**Note**: MariaDB is compatible with MySQL dumps, so data transfer is seamless.

---

## Maintenance Commands

### Update to Latest Version
```bash
cd badminton-app
git pull
docker-compose -f docker-compose.rpi.yml down
docker-compose -f docker-compose.rpi.yml up -d --build
```

### View Logs
```bash
docker-compose -f docker-compose.rpi.yml logs -f
```

### Check Resource Usage
```bash
docker stats
free -h
vcgencmd measure_temp
```

### Clean Up Old Images
```bash
docker system prune -a
```

---

## Getting Help

1. **Quick issues**: Check `QUICKSTART.RASPBERRY_PI.md`
2. **Detailed troubleshooting**: See `README.RASPBERRY_PI.md`
3. **Check logs**: `docker-compose -f docker-compose.rpi.yml logs`
4. **System status**: `free -h && df -h && vcgencmd measure_temp`
5. **GitHub issues**: Report problems with logs and system info

---

## Version Compatibility

These Raspberry Pi files are compatible with:
- Raspberry Pi OS (32-bit and 64-bit)
- Ubuntu Server for Raspberry Pi
- Other ARM-based Linux distributions

**Minimum requirements**:
- ARM64/AARCH64 architecture
- 1GB RAM (2GB recommended, 4GB ideal)
- Docker 20.10+
- Docker Compose 1.27+

---

## License

MIT License - Same as main project

---

**Last Updated**: December 2024
**Maintained**: Yes
**Status**: Production Ready ✅
