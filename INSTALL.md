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

Hvis kommandoen ikke findes, installer Compose-pluginet (`deploy.sh` bruger
`docker compose`, ikke den gamle `docker-compose`):

```bash
sudo apt install -y docker-compose-plugin
docker compose version
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
- Alt der mangler, får en stærk tilfældig værdi — men kun på en frisk
  installation. Mangler en MySQL-adgangskode eller `JWT_SECRET`, og kan den
  ikke genskabes, mens der allerede findes en database, stopper scriptet med en
  forklaring, før noget er ændret. (`JWT_SECRET` er også nøglen til de gemte
  hemmeligheder som klubbernes YouTube-forbindelse; en ny nøgle tages kun
  bevidst med `NY_JWT_SECRET=ja ./deploy.sh`.)

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

`deploy.sh` sikrer `.env`, bygger + starter alle containere og venter (højst
120 s) på, at backenden svarer sundt på `/health`; ellers viser den backendens
log og slutter med en fejl. Den er sikker at køre igen og igen. (Vil du køre det
manuelt: `sh scripts/ensure-env.sh` og derefter `docker compose up -d --build`.)

**Første gang** tager dette 5–10 minutter da Docker skal:
1. Downloade base-images (MySQL 8.4, Node 22, nginx, Python)
2. Bygge dine containers
3. Initialisere databasen og oprette tabeller
4. Starte backend og frontend

Følg opstarten i realtid:
```bash
docker compose logs -f
```

Tryk `Ctrl+C` for at stoppe log-visningen (appen kører stadig).

Tjek at alt kører:
```bash
docker compose ps
```

Du bør se disse med status `Up` eller `healthy` (`football-db-init` kører kun
ved opstart og stopper bagefter):
```
badminton-mysql, badminton-backend, badminton-frontend, football-backend,
football-frontend, badminton-stats, planner-solver, badminton-backup
```

Helbred: `curl -s http://127.0.0.1:3000/health` (backenden direkte) og
`curl -s http://localhost/api/health` (gennem nginx).

---

## 8. Første gang setup

### Åbn appen

Find serverens IP-adresse:
```bash
hostname -I
# Eksempel output: 192.168.1.50
```

Åbn i browser: `http://192.168.1.50:8080` (eller port 80)

### Grundopsætning

1. **Vælg antal baner** — f.eks. 4 eller 6
2. Klik **"Admin Panel"**
3. Log ind med standardadgangskoden: `admin123`
4. Gå til **Admin → Indstillinger**
5. **SKIFT ADGANGSKODEN MED DET SAMME** — standardkoden er ikke sikker

### Klubber og super-admin

Klubber på egne subdomæner (`klub.<APP_DOMAIN>`) oprettes i super-admin på
`admin.<APP_DOMAIN>`. Første login er `superadmin` / `superadmin123`, og koden
skal skiftes ved første login. `APP_DOMAIN` står i `installation.env`.

---

## 9. Automatisk opstart ved boot

Alle tjenester har `restart: unless-stopped` i `docker-compose.yml`, så de
starter selv igen, når Docker starter. Det eneste, der skal til, er at Docker
starter ved boot:

```bash
sudo systemctl enable docker
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

# Tillad appen (nginx lytter på 80 og 8080; MySQL og backenden er kun bundet til 127.0.0.1)
sudo ufw allow 80/tcp
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

# Byg og genstart — venter på, at backenden er sund
./deploy.sh
```

Migrationerne kører af sig selv, når backenden starter; der skal ikke køres
SQL i hånden, og `docker compose down` er ikke nødvendig.

Hard-refresh i browseren: `Ctrl+Shift+R` (Windows/Linux) eller `Cmd+Shift+R` (Mac).

---

## 12. Backup og gendannelse

### Automatisk backup (kører af sig selv)

`backup`-servicen tager automatisk en fuld backup **hver 24. time** og beholder
dem i **14 dage**. Hver backup dækker:

- **Alle** databaser i én dump (`badminton_counter`, alle klub-databaser,
  `badminton_master` og `football_tournament`) — filen `db-<tidsstempel>.sql.gz`.
- Alle uploadede billeder (badminton + football) — filen `uploads-<tidsstempel>.tar.gz`.

Backup'erne ligger i Docker-volumet `<projekt>_backups`, hvor `<projekt>` er
mappenavnet (efter trin 5: `badminton-score-counter`). Find navnet, og se dem:

```bash
docker volume ls --filter name=backups
```

```bash
docker run --rm -v badminton-score-counter_backups:/b alpine ls -lh /b
```

Kopiér de nyeste backups ud til den mappe du står i (fx før du flytter serveren):

```bash
docker run --rm -v badminton-score-counter_backups:/b -v "$PWD":/ud alpine sh -c 'cp /b/db-* /b/uploads-* /ud/'
```

> Interval og opbevaring kan ændres i `.env` med `BACKUP_INTERVAL_HOURS` og
> `BACKUP_RETENTION_DAYS` (standard 24 og 14). Status for den seneste kørsel
> står i super-admin → Serverens helbred.

### Klubbernes egne backups

Backenden tager desuden en backup af hver klub hver mandag kl. 02:00 og før
hver gendannelse (de 4 seneste af hver slags beholdes, i volumet
`<projekt>_club_backups`). De kan hentes og gendannes under **Indstillinger →
Backup & Gendannelse** og i super-admin, hvor man også kan hente en backup-fil
og gendanne fra fil.

### Gendannelse

```bash
# Gendan ALLE databaser fra en dump (erstatter nuværende data)
gunzip -c db-YYYYMMDD-HHMMSS.sql.gz | docker exec -i badminton-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

```bash
# Gendan billeder (pak arkivet ud i uploads-volumet)
docker run --rm -v badminton-score-counter_uploads_data:/data -v "$PWD":/ind alpine \
  sh -c 'tar xzf /ind/uploads-YYYYMMDD-HHMMSS.tar.gz -C /data --strip-components=1 uploads'
```

> Én enkelt klub gendannes lettest fra dens egne backups (se ovenfor).

---

## 13. Fejlfinding

### App starter ikke

```bash
# Tjek hvad der sker
docker compose logs --tail 200

# Tjek specifik service
docker compose logs backend
docker compose logs mysql

# Helbred: backenden direkte og gennem nginx
curl -s http://127.0.0.1:3000/health
curl -s http://localhost/api/health
```

### "Port already in use"

```bash
# Se hvad der bruger port 8080 (samme for 80)
sudo lsof -i :8080
# Eller
sudo netstat -tlnp | grep 8080

# Stop processen eller skift porten i docker-compose.yml
```

### Database starter ikke / tager lang tid

MySQL kan tage 1–3 minutter første gang. Vent og tjek:
```bash
docker compose logs -f mysql
# Vent på: "ready for connections"
```

### Ændringer vises ikke

```bash
# Byg og genstart igen
./deploy.sh

# Hard-refresh i browser: Ctrl+Shift+R
```

### Nulstil alt og start forfra (sletter al data — også backup'erne!)

```bash
docker compose down -v
./deploy.sh
```

### Nyttige kommandoer

```bash
# Se kørende containers
docker compose ps

# Se live logs
docker compose logs -f

# Stop appen
docker compose down

# Start appen
docker compose up -d

# Genstart én service
docker compose restart backend
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

Åbn `.env` i Notesblok og sæt sikre adgangskoder for **alle** værdier i filen
(også football-værdierne — compose stopper med en besked, hvis én mangler):
```bash
notepad .env
```

Start appen:
```bash
docker compose up -d --build
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
| `git pull && ./deploy.sh` | Opdatér: hent seneste kode, byg, start og tjek helbredet |
| `docker compose up -d` | Start appen |
| `docker compose down` | Stop appen |
| `docker compose ps` | Tjek status |
| `docker compose logs -f` | Se live logs |
| `docker compose down -v` | Stop + slet al data (også backup'erne) |

**Standard login**: `admin123` — **skift det med det samme!**

**App-adresse**: `http://[SERVER-IP]:8080`

Find server-IP: `hostname -I` (Linux) eller `ipconfig` (Windows)
