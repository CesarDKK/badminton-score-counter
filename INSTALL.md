# Badminton App — Komplet Installationsvejledning

Denne guide dækker komplet installation fra bunden på en ny server eller PC med **Ubuntu/Debian Linux**.
For Windows: se afsnittet [Installation på Windows](#installation-på-windows) nederst.

---

## Indhold

1. [Systemkrav](#1-systemkrav)
2. [Installer Git](#2-installer-git)
3. [Installer Docker](#3-installer-docker)
4. [Installer Docker Compose](#4-installer-docker-compose)
5. [Hent koden](#5-hent-koden)
6. [Konfigurer miljøvariabler](#6-konfigurer-miljøvariabler)
7. [Start appen](#7-start-appen)
8. [Første gang setup](#8-første-gang-setup)
9. [Automatisk opstart ved boot](#9-automatisk-opstart-ved-boot)
10. [Firewall](#10-firewall)
11. [Opdatering af appen](#11-opdatering-af-appen)
12. [Backup og gendannelse](#12-backup-og-gendannelse)
13. [Fejlfinding](#13-fejlfinding)
14. [Installation på Windows](#installation-på-windows)

---

## 1. Systemkrav

| Komponent | Minimum | Anbefalet |
|-----------|---------|-----------|
| OS | Ubuntu 20.04 / Debian 11 | Ubuntu 22.04 LTS |
| RAM | 1 GB | 2 GB+ |
| Disk | 5 GB ledig | 10 GB+ |
| Netværk | Lokalt netværk | Lokalt netværk |

Tjek din Ubuntu-version:
```bash
lsb_release -a
```

Opdater systemet før installation:
```bash
sudo apt update && sudo apt upgrade -y
```

---

## 2. Installer Git

```bash
sudo apt install -y git

# Verificer installation
git --version
# Forventet output: git version 2.x.x
```

---

## 3. Installer Docker

Brug Dockers officielle installationsscript (anbefalet):

```bash
# Download og kør installationsscript
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Tilføj din bruger til docker-gruppen (så du ikke behøver sudo)
sudo usermod -aG docker $USER

# Aktivér gruppeændringen (eller log ud og ind igen)
newgrp docker

# Verificer installation
docker --version
# Forventet output: Docker version 27.x.x

# Test at Docker virker
docker run hello-world
```

> **Tip**: Hvis `hello-world` kører korrekt, er Docker installeret rigtigt.

---

## 4. Installer Docker Compose

Docker Compose V2 er inkluderet i nyere Docker-installationer. Tjek om det er tilgængeligt:

```bash
docker compose version
# Forventet output: Docker Compose version v2.x.x
```

Hvis kommandoen ikke findes, installer det manuelt:

```bash
# Hent seneste version
COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)

sudo curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose

sudo chmod +x /usr/local/bin/docker-compose

# Verificer
docker-compose --version
```

---

## 5. Hent koden

```bash
# Gå til den mappe du vil installere i (f.eks. din hjemmemappe)
cd ~

# Klon repositoriet
git clone https://github.com/CesarDKK/badminton-score-counter.git

# Gå ind i mappen
cd badminton-score-counter

# Bekræft at filerne er der
ls
```

Du bør se filer som: `docker-compose.yml`, `backend/`, `frontend/`, `.env.example` osv.

---

## 6. Konfigurer miljøvariabler (automatisk)

Appen kræver en `.env`-fil med adgangskoder og hemmeligheder — men du behøver
**ikke** oprette eller redigere den i hånden. `deploy.sh` (næste trin) kører
`scripts/ensure-env.sh`, som selv sørger for en komplet `.env`:

- Værdier der allerede står i `.env` røres aldrig.
- Kører appen allerede, genskabes de nuværende hemmeligheder fra containerne,
  så databasen bliver ved med at forbinde.
- Alt der mangler, får en stærk tilfældig værdi.

Der er bevidst **ingen** standardværdier i koden, og `.env` er i `.gitignore`,
så hemmeligheder aldrig havner på GitHub.

Vil du hellere sætte værdierne selv, kan du oprette `.env` ud fra `.env.example`
først — så bevarer scriptet dine værdier og udfylder kun resten. Football-admins
oprettes separat med `seedClub.js` (ikke via en env-variabel).

---

## 7. Start appen

```bash
./deploy.sh
```

`deploy.sh` sikrer `.env` og bygger + starter alle containere. Den er sikker at
køre igen og igen. (Vil du køre det manuelt: `sh scripts/ensure-env.sh` og
derefter `docker compose up -d --build`.)

**Første gang** tager dette 5–10 minutter da Docker skal:
1. Downloade base-images (MySQL, Node.js, Nginx)
2. Bygge dine containers
3. Initialisere databasen og oprette tabeller
4. Starte backend og frontend

Følg opstarten i realtid:
```bash
docker-compose logs -f
```

Tryk `Ctrl+C` for at stoppe log-visningen (appen kører stadig).

Tjek at alt kører:
```bash
docker-compose ps
```

Du bør se 3–4 services med status `Up` eller `healthy`:
```
NAME                   STATUS
badminton-mysql        Up (healthy)
badminton-backend      Up (healthy)
badminton-frontend     Up
```

---

## 8. Første gang setup

### Åbn appen

Find serverens IP-adresse:
```bash
hostname -I
# Eksempel output: 192.168.1.50
```

Åbn i browser: `http://192.168.1.50:8080`

### Grundopsætning

1. **Vælg antal baner** — f.eks. 4 eller 6
2. Klik **"Admin Panel"**
3. Log ind med standardadgangskoden: `admin123`
4. Gå til **Admin → Indstillinger**
5. **SKIFT ADGANGSKODEN MED DET SAMME** — standardkoden er ikke sikker

### Anbefalede indstillinger

Under **Admin → Indstillinger**:
- Skift admin-adgangskode
- Vælg Court-version: **Bane View (V3)** (anbefalet)
- Vælg TV-version: **Minimalistisk (V3)** (anbefalet)

---

## 9. Automatisk opstart ved boot

For at appen starter automatisk når serveren genstartes:

```bash
# Sørg for at Docker starter ved boot
sudo systemctl enable docker

# Opret en systemd-service til appen
sudo tee /etc/systemd/system/badminton-app.service > /dev/null <<EOF
[Unit]
Description=Badminton Counter App
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/docker-compose up -d
ExecStop=/usr/bin/docker-compose down
User=$USER

[Install]
WantedBy=multi-user.target
EOF

# Aktivér og start servicen
sudo systemctl daemon-reload
sudo systemctl enable badminton-app.service
sudo systemctl start badminton-app.service

# Tjek at den kører
sudo systemctl status badminton-app.service
```

Test at det virker ved at genstarte serveren:
```bash
sudo reboot
```

Åbn appen igen i browseren efter genstart — den bør starte automatisk inden for 2–3 minutter.

---

## 10. Firewall

Hvis serveren er tilgængelig fra internettet, opsæt firewall:

```bash
# Aktiver firewall
sudo ufw enable

# Tillad SSH (VIGTIGT — ellers mister du adgang!)
sudo ufw allow 22/tcp

# Tillad appen
sudo ufw allow 8080/tcp

# Tjek status
sudo ufw status
```

Hvis appen kun skal bruges på lokalt netværk, er firewall valgfri.

---

## 11. Opdatering af appen

Når der er kommet en ny version:

```bash
cd ~/badminton-score-counter

# Hent nyeste kode
git pull

# Genbyg og genstart containers
docker-compose down
docker-compose up -d --build
```

Tjek at alt kører:
```bash
docker-compose ps
```

Hard-refresh i browseren: `Ctrl+Shift+R` (Windows/Linux) eller `Cmd+Shift+R` (Mac).

---

## 12. Backup og gendannelse

### Automatisk backup (kører af sig selv)

`backup`-servicen tager automatisk en fuld backup **hver 24. time** og beholder
dem i **14 dage**. Hver backup dækker:

- **Alle** databaser i én dump (`badminton_counter`, alle klub-databaser,
  `badminton_master` og `football_tournament`) — filen `db-<tidsstempel>.sql.gz`.
- Alle uploadede billeder (badminton + football) — filen `uploads-<tidsstempel>.tar.gz`.

Backup'erne ligger i Docker-volumet `badminton-app_backups`. Se dem, og find
host-stien:

```bash
docker run --rm -v badminton-app_backups:/b alpine ls -lh /b
```

```bash
docker volume inspect badminton-app_backups
```

Kopiér de nyeste backups ud til den mappe du står i (fx før du flytter serveren):

```bash
docker run --rm -v badminton-app_backups:/b -v "$PWD":/ud alpine sh -c 'cp /b/db-* /b/uploads-* /ud/'
```

> Interval og opbevaring kan ændres i `.env` med `BACKUP_INTERVAL_HOURS` og
> `BACKUP_RETENTION_DAYS` (standard 24 og 14).

### Gendannelse

```bash
# Gendan ALLE databaser fra en dump (erstatter nuværende data)
gunzip -c db-YYYYMMDD-HHMMSS.sql.gz | docker exec -i badminton-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

```bash
# Gendan billeder (pak arkivet ud i uploads-volumet)
docker run --rm -v badminton-app_uploads_data:/data -v "$PWD":/ind alpine \
  sh -c 'tar xzf /ind/uploads-YYYYMMDD-HHMMSS.tar.gz -C /data --strip-components=1 uploads'
```

> Vil du hellere gendanne én enkelt klub via admin-fladen, findes der stadig en
> per-klub backup/restore under super-admin.

---

## 13. Fejlfinding

### App starter ikke

```bash
# Tjek hvad der sker
docker-compose logs

# Tjek specifik service
docker-compose logs backend
docker-compose logs mysql
```

### "Port already in use"

```bash
# Se hvad der bruger port 8080
sudo lsof -i :8080
# Eller
sudo netstat -tlnp | grep 8080

# Stop processen eller skift porten i docker-compose.yml
```

### Database starter ikke / tager lang tid

MySQL kan tage 1–3 minutter første gang. Vent og tjek:
```bash
docker-compose logs -f mysql
# Vent på: "ready for connections"
```

### Ændringer vises ikke

```bash
# Tving genbyg af containers
docker-compose down
docker-compose up -d --build

# Hard-refresh i browser: Ctrl+Shift+R
```

### Nulstil alt og start forfra (sletter al data!)

```bash
docker-compose down -v
docker-compose up -d --build
```

### Nyttige kommandoer

```bash
# Se kørende containers
docker-compose ps

# Se live logs
docker-compose logs -f

# Stop appen
docker-compose down

# Start appen
docker-compose up -d

# Genstart én service
docker-compose restart backend
```

---

## Installation på Windows

### Forudsætninger

1. **Installer Git for Windows**: https://git-scm.com/download/win
   - Vælg standardindstillinger under installation

2. **Installer Docker Desktop**: https://www.docker.com/products/docker-desktop
   - Kræver Windows 10/11 64-bit
   - Aktivér WSL 2 backend hvis du bliver spurgt
   - Genstart computeren efter installation
   - Start Docker Desktop og vent på "Docker Desktop is running" (hvalikon i systembakken)

### Installation

Åbn **Git Bash** eller **PowerShell** og kør:

```bash
# Klon repositoriet
git clone https://github.com/CesarDKK/badminton-score-counter.git
cd badminton-score-counter

# Kopiér miljøfil (PowerShell)
copy .env.example .env

# Eller i Git Bash
cp .env.example .env
```

Åbn `.env` i Notesblok og sæt sikre adgangskoder:
```bash
notepad .env
```

Start appen:
```bash
docker-compose up -d --build
```

Åbn `http://localhost:8080` i browseren.

### Auto-start på Windows

Docker Desktop starter automatisk med Windows. For at sikre at containerne også starter:

1. Åbn Docker Desktop
2. Gå til **Settings → General**
3. Aktivér **"Start Docker Desktop when you log in"**

Containerne genstarter automatisk fordi `docker-compose.yml` har `restart: unless-stopped`.

---

## Hurtig reference

| Kommando | Beskrivelse |
|----------|-------------|
| `docker-compose up -d` | Start appen |
| `docker-compose down` | Stop appen |
| `docker-compose up -d --build` | Genbyg og start |
| `docker-compose ps` | Tjek status |
| `docker-compose logs -f` | Se live logs |
| `docker-compose down -v` | Stop + slet al data |
| `git pull` | Hent seneste kode |

**Standard login**: `admin123` — **skift det med det samme!**

**App-adresse**: `http://[SERVER-IP]:8080`

Find server-IP: `hostname -I` (Linux) eller `ipconfig` (Windows)
