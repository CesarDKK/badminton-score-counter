# Raspberry Pi Quick Start Guide

**TL;DR** - Get running in 4 commands on your Raspberry Pi:

## Fastest Installation

```bash
# 1. Install Docker (one-time setup)
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
sudo usermod -aG docker $USER && newgrp docker

# 2. Install docker-compose (one-time setup)
sudo apt install -y docker-compose

# 3. Configure environment
cp .env.example .env
nano .env  # Set secure passwords, then Ctrl+X to save

# 4. Start the app
chmod +x start-rpi.sh
./start-rpi.sh
```

**Access**: Open `http://[YOUR_PI_IP]:8080` in your browser

Find your Pi's IP: `hostname -I`

---

## One-Line Commands

### Start
```bash
docker-compose -f docker-compose.rpi.yml up -d
```

### Stop
```bash
docker-compose -f docker-compose.rpi.yml down
```

### View Logs
```bash
docker-compose -f docker-compose.rpi.yml logs -f
```

### Check Status
```bash
docker-compose -f docker-compose.rpi.yml ps
```

### Restart Everything
```bash
docker-compose -f docker-compose.rpi.yml restart
```

---

## Required .env Variables

Edit `.env` and set these **before** first start:

```env
MYSQL_ROOT_PASSWORD=YourRootPassword123!
MYSQL_PASSWORD=YourDBPassword456!
JWT_SECRET=YourLongJWTSecretAtLeast32Characters
```

---

## System Requirements

| Model | RAM | Works? | Performance |
|-------|-----|--------|-------------|
| Pi 5  | 4GB+ | ✅ Excellent | Real-time, smooth |
| Pi 4  | 4GB | ✅ Great | Recommended |
| Pi 4  | 2GB | ⚠️ OK | Use swap, limit courts |
| Pi 3B+ | 1GB | ⚠️ Slow | Minimal setup only |
| Pi Zero | | ❌ No | Insufficient |

**Recommendation**: Raspberry Pi 4 with 4GB RAM

---

## Troubleshooting One-Liners

### Out of memory?
```bash
# Increase swap to 2GB
sudo dphys-swapfile swapoff
sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup && sudo dphys-swapfile swapon
```

### Check system resources
```bash
free -h && df -h && vcgencmd measure_temp
```

### Database not ready?
```bash
# Wait and watch for "ready for connections"
docker-compose -f docker-compose.rpi.yml logs -f mysql
```

### Can't access from other devices?
```bash
# Allow firewall
sudo ufw allow 8080/tcp

# Show your IP
hostname -I
```

### Fresh start (deletes all data!)
```bash
docker-compose -f docker-compose.rpi.yml down -v
docker-compose -f docker-compose.rpi.yml up -d
```

---

## Auto-Start on Boot

```bash
# Create service file
sudo tee /etc/systemd/system/badminton-app.service > /dev/null <<EOF
[Unit]
Description=Badminton Counter App
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/docker-compose -f docker-compose.rpi.yml up -d
ExecStop=/usr/bin/docker-compose -f docker-compose.rpi.yml down
User=$USER

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable badminton-app.service
sudo systemctl start badminton-app.service
```

---

## Performance Tips

### Use good SD card
- SanDisk Extreme or Samsung EVO Plus
- A2 rating preferred
- 32GB+ recommended

### Cool your Pi
- Active cooling (fan) recommended
- Keep temperature below 70°C
- Check: `vcgencmd measure_temp`

### Limit courts
- Each court uses ~50-100MB RAM
- Start with 2-4 courts on 2GB Pi
- 6-8 courts fine on 4GB Pi

---

## Key Differences from Standard Version

| Feature | Standard | Raspberry Pi |
|---------|----------|--------------|
| Database | MySQL 8.0 | MariaDB 11 |
| Memory Limits | None | 512MB DB, 768MB backend |
| Startup Time | 2-3 min | 10-20 min |
| Node Heap | Default | 512MB max |
| Connections | Unlimited | 50 max |

---

## Backup in One Command

```bash
# Backup everything
docker-compose -f docker-compose.rpi.yml exec mysql mysqldump -u badminton_user -p badminton_counter > backup-$(date +%Y%m%d).sql && docker cp badminton-backend:/app/uploads ./uploads-backup-$(date +%Y%m%d)
```

---

## First Time Setup Checklist

- [ ] Install Docker and docker-compose
- [ ] Copy and edit `.env` file
- [ ] Run `./start-rpi.sh` (or docker-compose command)
- [ ] Wait 10-20 minutes for first build
- [ ] Access http://[PI_IP]:8080
- [ ] Set number of courts
- [ ] Login to admin (password: `admin123`)
- [ ] **Change admin password immediately!**
- [ ] Test scoring on a court
- [ ] Check TV display mode

---

## Need More Help?

**Full documentation**: See `README.RASPBERRY_PI.md`

**Check logs**: `docker-compose -f docker-compose.rpi.yml logs`

**System status**: `free -h && docker stats`

**Common issues**: Most problems are solved by:
1. Waiting longer (DB initialization takes time)
2. Increasing swap space
3. Checking temperature
4. Restarting: `docker-compose -f docker-compose.rpi.yml restart`

---

## URLs to Remember

- **Application**: `http://[YOUR_PI_IP]:8080`
- **Find IP**: `hostname -I`
- **Admin Login**: Default password `admin123` (change it!)

---

**Estimated Setup Time**:
- First time: 30-40 minutes (including Docker install + build)
- Subsequent starts: 2-3 minutes

**Enjoy your Badminton Counter App on Raspberry Pi!** 🏸
