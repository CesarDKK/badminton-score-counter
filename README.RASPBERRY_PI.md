# Badminton Counter App - Raspberry Pi Installation Guide

Complete guide for deploying the Badminton Counter App on Raspberry Pi (ARM64 architecture).

## Compatible Raspberry Pi Models

This application will run on:
- **Raspberry Pi 4** (2GB+ RAM recommended, 4GB+ ideal)
- **Raspberry Pi 5** (optimal performance)
- **Raspberry Pi 3 Model B+** (minimum 1GB RAM, slower performance)
- **Raspberry Pi 400** (4GB RAM, good performance)

**Note**: Raspberry Pi Zero and older models are NOT recommended due to insufficient resources.

## Prerequisites

### 1. Raspberry Pi OS Setup

**Recommended OS**: Raspberry Pi OS (64-bit) Lite or Desktop

```bash
# Check your system architecture (should show aarch64 or arm64)
uname -m

# Update your system
sudo apt update && sudo apt upgrade -y
```

### 2. Install Docker on Raspberry Pi

```bash
# Install Docker using the official convenience script
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to the docker group (replace 'pi' with your username)
sudo usermod -aG docker $USER

# Log out and log back in for group changes to take effect
# Or run: newgrp docker

# Verify Docker installation
docker --version
docker run hello-world
```

### 3. Install Docker Compose

```bash
# Install docker-compose
sudo apt install -y docker-compose

# Verify installation
docker-compose --version
```

**Alternative method** (if apt version is outdated):
```bash
# Install docker-compose v2 (recommended)
sudo apt install -y python3-pip libffi-dev
sudo pip3 install docker-compose
```

## Installation Steps

### 1. Clone or Copy the Repository

```bash
# If you have git installed
git clone https://github.com/CesarDKK/badminton-score-counter.git
cd badminton-score-counter

# OR download and extract manually
wget https://github.com/CesarDKK/badminton-score-counter/archive/main.zip
unzip main.zip
cd badminton-score-counter-main
```

### 2. Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit the environment file
nano .env
```

Set secure passwords and secrets:
```env
MYSQL_ROOT_PASSWORD=YourSecureRootPassword123!
MYSQL_PASSWORD=YourSecureDBPassword456!
JWT_SECRET=YourVeryLongSecretKeyForJWTMinimum32Characters
```

**Save and exit**: Press `Ctrl+X`, then `Y`, then `Enter`

### 3. Start the Application (Raspberry Pi Version)

```bash
# Use the Raspberry Pi specific docker-compose file
docker-compose -f docker-compose.rpi.yml up -d
```

**First run**: Building and starting will take 10-20 minutes on a Raspberry Pi 4, longer on older models.

### 4. Monitor the Startup Process

```bash
# Watch the logs to see progress
docker-compose -f docker-compose.rpi.yml logs -f

# Press Ctrl+C to stop watching logs
```

Wait until you see:
- `[Server] listening on port 3000` (backend ready)
- MariaDB showing `ready for connections`

### 5. Access the Application

Once running, access from:

**On the Raspberry Pi itself**:
```
http://localhost:8080
```

**From other devices on your network**:
```
http://[PI_IP_ADDRESS]:8080
```

Find your Pi's IP address:
```bash
hostname -I
# Example output: 192.168.1.100
# Then access: http://192.168.1.100:8080
```

### 6. Initial Setup

1. Open the application in your browser
2. Set the number of courts
3. Click "Admin Panel" and login with: `admin123`
4. **IMMEDIATELY** change the admin password in Admin > Settings

## Raspberry Pi Specific Optimizations

The Raspberry Pi version includes several optimizations:

### Database (MariaDB instead of MySQL)
- Uses MariaDB 11 (better ARM performance)
- Limited to 512MB memory
- Reduced buffer pool size (128MB)
- Max 50 connections (vs unlimited)
- Optimized for SD card I/O

### Backend (Node.js)
- Memory limited to 768MB
- Node.js heap size capped at 512MB
- Longer startup grace period (60s)
- Optimized npm install process

### Frontend (Nginx)
- Memory limited to 256MB
- Reduced worker processes (2 workers)
- Lower connection limits (512 per worker)
- Minimal resource footprint

## Performance Tips

### 1. Use a Quality SD Card

**Recommended**: SanDisk Extreme or Samsung EVO Plus (A2 rating)
- Minimum Class 10
- A2 application class preferred
- 32GB or larger

### 2. Enable Swap (if using 2GB Pi)

```bash
# Check current swap
free -h

# If swap is less than 2GB, increase it
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile

# Change CONF_SWAPSIZE=100 to CONF_SWAPSIZE=2048

# Save, then:
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### 3. Overclock (Optional - Raspberry Pi 4 only)

**Warning**: Only if you have good cooling!

```bash
sudo nano /boot/config.txt

# Add these lines:
over_voltage=6
arm_freq=2000

# Save and reboot
sudo reboot
```

### 4. Monitor Temperature

```bash
# Check CPU temperature
vcgencmd measure_temp

# Monitor resources in real-time
htop
# Install htop if not available: sudo apt install htop
```

**Safe operating temperatures**: Keep below 70°C under load

## Docker Management Commands

### Check Status
```bash
docker-compose -f docker-compose.rpi.yml ps
```

### View Logs
```bash
# All services
docker-compose -f docker-compose.rpi.yml logs

# Specific service
docker-compose -f docker-compose.rpi.yml logs backend
docker-compose -f docker-compose.rpi.yml logs mysql

# Follow logs in real-time
docker-compose -f docker-compose.rpi.yml logs -f
```

### Stop the Application
```bash
docker-compose -f docker-compose.rpi.yml down
```

### Start Again
```bash
docker-compose -f docker-compose.rpi.yml up -d
```

### Restart After Changes
```bash
docker-compose -f docker-compose.rpi.yml down
docker-compose -f docker-compose.rpi.yml up -d --build
```

### Remove Everything (including data)
```bash
docker-compose -f docker-compose.rpi.yml down -v
```

## Troubleshooting

### Issue: Out of Memory / System Freeze

**Symptoms**: System becomes unresponsive, containers crash

**Solutions**:
```bash
# 1. Check memory usage
free -h
docker stats

# 2. Increase swap space (see Performance Tips above)

# 3. Reduce number of courts in use (each court uses memory)

# 4. Restart with fresh state
docker-compose -f docker-compose.rpi.yml restart
```

### Issue: Slow Database Initialization

**Symptoms**: Backend can't connect to database for several minutes

**Solution**: This is normal on first run. MariaDB initialization can take 5-10 minutes.

```bash
# Monitor database initialization
docker-compose -f docker-compose.rpi.yml logs -f mysql

# Wait for: "ready for connections"
```

### Issue: Build Fails with "No Space Left on Device"

**Solution**: Clean up Docker images and expand storage

```bash
# Clean up old Docker images
docker system prune -a

# Check disk space
df -h

# If SD card is full, consider:
# - Using a larger SD card
# - Moving Docker data to USB drive
```

### Issue: Image Upload Extremely Slow

**Symptoms**: Sponsor image uploads timeout or take several minutes

**Cause**: SD card write speed and image processing on ARM

**Solutions**:
```bash
# 1. Use smaller images (max 2MB recommended)
# 2. Upload fewer images at once (max 2-3 at a time)
# 3. Consider using USB 3.0 SSD for storage
```

### Issue: Cannot Access from Other Devices

**Solutions**:
```bash
# 1. Find Pi's IP address
hostname -I

# 2. Check if firewall is blocking
sudo ufw status
# If active, allow port 8080:
sudo ufw allow 8080/tcp

# 3. Test if service is listening
sudo netstat -tlnp | grep 8080

# 4. Try accessing from Pi itself first
curl http://localhost:8080
```

### Issue: Containers Keep Restarting

**Check logs for errors**:
```bash
docker-compose -f docker-compose.rpi.yml logs --tail=100
```

Common causes:
- Database not fully initialized (wait longer)
- Insufficient memory (increase swap)
- Corrupted volumes (remove and recreate)

```bash
# Reset volumes and start fresh
docker-compose -f docker-compose.rpi.yml down -v
docker-compose -f docker-compose.rpi.yml up -d
```

## Backup and Restore

### Backup Your Data

```bash
# Backup database
docker-compose -f docker-compose.rpi.yml exec mysql mysqldump \
  -u badminton_user -p badminton_counter > backup.sql

# Backup uploaded images
docker cp badminton-backend:/app/uploads ./uploads-backup

# Create a complete backup archive
tar -czf badminton-backup-$(date +%Y%m%d).tar.gz backup.sql uploads-backup
```

### Restore Data

```bash
# Restore database
docker-compose -f docker-compose.rpi.yml exec -T mysql mysql \
  -u badminton_user -p badminton_counter < backup.sql

# Restore images
docker cp ./uploads-backup/. badminton-backend:/app/uploads
```

## Auto-Start on Boot

To make the application start automatically when your Raspberry Pi boots:

```bash
# Enable Docker service
sudo systemctl enable docker

# Create a startup script
sudo nano /etc/systemd/system/badminton-app.service
```

Add this content:
```ini
[Unit]
Description=Badminton Counter App
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/pi/badminton-score-counter
ExecStart=/usr/bin/docker-compose -f docker-compose.rpi.yml up -d
ExecStop=/usr/bin/docker-compose -f docker-compose.rpi.yml down
User=pi

[Install]
WantedBy=multi-user.target
```

**Activate it**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable badminton-app.service
sudo systemctl start badminton-app.service

# Check status
sudo systemctl status badminton-app.service
```

## Performance Benchmarks

Typical performance on Raspberry Pi 4 (4GB):

- **Startup time**: 10-15 minutes (first run), 2-3 minutes (subsequent)
- **Memory usage**: ~1.2GB total (all containers)
- **Court updates**: Real-time (<100ms latency)
- **Image upload**: 5-15 seconds for 5MB image
- **Concurrent users**: 10-15 devices comfortably

## Security Recommendations

### 1. Change Default Passwords
- Admin password (immediately after first login)
- Database passwords in `.env` file

### 2. Firewall Setup
```bash
# Enable firewall
sudo ufw enable

# Allow SSH (important!)
sudo ufw allow 22/tcp

# Allow application
sudo ufw allow 8080/tcp

# Check status
sudo ufw status
```

### 3. Keep System Updated
```bash
# Weekly maintenance
sudo apt update && sudo apt upgrade -y
docker-compose -f docker-compose.rpi.yml pull
docker-compose -f docker-compose.rpi.yml up -d --build
```

### 4. Disable SSH Password Login (use keys)
```bash
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart ssh
```

## Advanced: External Storage (USB SSD)

For better performance, move Docker data to a USB 3.0 SSD:

```bash
# 1. Stop Docker
sudo systemctl stop docker

# 2. Move Docker data
sudo rsync -aP /var/lib/docker/ /mnt/usb-ssd/docker/

# 3. Configure Docker to use new location
sudo nano /etc/docker/daemon.json
```

Add:
```json
{
  "data-root": "/mnt/usb-ssd/docker"
}
```

```bash
# 4. Restart Docker
sudo systemctl start docker

# 5. Verify
docker info | grep "Docker Root Dir"
```

## Getting Help

If you encounter issues:

1. Check logs: `docker-compose -f docker-compose.rpi.yml logs`
2. Verify system resources: `free -h` and `df -h`
3. Check temperature: `vcgencmd measure_temp`
4. Review this troubleshooting guide
5. Open an issue on GitHub with logs and system info

## Resource Requirements Summary

| Component | Min RAM | Recommended RAM | Storage |
|-----------|---------|-----------------|---------|
| MariaDB   | 256MB   | 512MB          | 1-5GB   |
| Backend   | 256MB   | 768MB          | 100MB   |
| Frontend  | 64MB    | 256MB          | 50MB    |
| **Total** | **576MB** | **1.5GB**    | **2-6GB** |

**Recommendation**: Raspberry Pi 4 with 4GB RAM for comfortable operation with multiple courts.

## License

MIT License - Same as main project
