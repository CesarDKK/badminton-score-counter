# Raspberry Pi som TV-skærm i hallen

Denne vejledning sætter en Raspberry Pi op som **visningsmaskine** — den booter
direkte til TV-siden eller oversigten i fuldskærm, uden skrivebord og uden at
nogen skal røre en mus.

> **Bemærk forskellen på de to Pi-roller i dette projekt:**
>
> | Dokument | Rolle | Kører |
> |---|---|---|
> | [QUICKSTART.RASPBERRY_PI.md](QUICKSTART.RASPBERRY_PI.md) | **Server** | Docker, backend, database |
> | **KIOSK.RASPBERRY_PI.md** (denne) | **Skærm** | Chromium i fuldskærm |
>
> Læg dem ikke på samme Pi. En kiosk-Pi skal helst have read-only filsystem og
> må gerne genstartes ubekymret — det passer dårligt sammen med en database.

---

## Hvorfor Raspberry Pi frem for en mini-PC

TV-siden er ren vanilla JavaScript uden framework. Opdateringer kommer via SSE
(server push), og det tungeste på siden er sponsor-slideshowet, DVD-screensaveren
og et par `backdrop-filter`-blurs. Det er en let side efter browserstandarder, og
en Pi 4 kører den uden at svede.

Regn ikke med at spare voldsomt på strømmen: en Pi 4 i kiosk-drift bruger ca.
5–7 W mod en mini-PC's 10–15 W. Det er omkring 100–150 kr/år. **Den reelle
besparelse er anskaffelsesprisen** — og hvis du bruger HDMI-CEC til at slukke
TV'et om natten (se nedenfor), sparer selve TV'et langt mere end computeren
nogensinde gør.

---

## Hardware

| Del | Anbefaling | Note |
|---|---|---|
| Board | **Raspberry Pi 4, 2 GB** | 4 GB hvis du vil have luft til ugers uafbrudt drift |
| | Pi 5 er overkill her | Kræver aktiv køling og kraftigere strømforsyning |
| | ❌ Ikke Pi 3 eller Zero 2 W | Chromium på 1 GB RAM bliver træg og screensaveren hakker |
| Kabinet | Passivt køleribbe-kabinet | Ingen blæser = ingen støv og ingen slidddele |
| Kabel | **micro-HDMI → HDMI** | Pi 4/5 har micro-HDMI, ikke fuld størrelse. Nemmeste fejl at lave. |
| Lagring | 16 GB A1-klasse SD-kort | Eller en lille USB-SSD hvis du vil være helt sikker |
| Strøm | Officiel USB-C strømforsyning | Underspænding giver tilfældige grafikfejl |
| Netværk | Kabel hvis muligt | WiFi virker, men kabel giver færre overraskelser i en hal |

Brug **Raspberry Pi OS Lite (64-bit)**, Bookworm eller nyere. Du skal ikke bruge
desktop-udgaven — scriptet installerer kun den grafiske stak der rent faktisk er
brug for.

### Skal der ikke en GUI til?

Du skal ikke bruge et *skrivebordsmiljø*, men du skal have en *grafisk stak* —
Chromium er en grafisk applikation og kan ikke tegne på en tekstkonsol. Der
findes ingen "CLI-browser der viser siden på TV'et".

Løsningen her er [`cage`](https://www.hjdskes.nl/projects/cage/): en minimal
Wayland-compositor der kun kan én ting — køre ét program i fuldskærm. Ingen
panel, ingen filmanager, ingen skærmlås, intet der kan poppe op hen over
kampen. Det er omkring 200 KB frem for et par gigabyte skrivebord.

---

## Installation

### 1. Flash og forbered SD-kortet

Brug Raspberry Pi Imager, vælg **Raspberry Pi OS Lite (64-bit)**, og sæt i
imagerens avancerede indstillinger (tandhjulet):

- Hostname, fx `tv-bane1`
- Brugernavn og adgangskode
- **SSH slået til** — så du kan styre skærmen fra din egen maskine bagefter
- WiFi, hvis den ikke får kabel

### 2. Log ind og hent projektet

```bash
ssh pi@tv-bane1.local
```

```bash
sudo apt update && sudo apt install -y git
git clone <repo-url> badminton-app && cd badminton-app
```

Har du ikke lyst til at klone hele repoet på skærmmaskinen, kan du nøjes med at
kopiere `setup-kiosk-rpi.sh` over med `scp`.

### 3. Kør opsætningsscriptet

```bash
chmod +x setup-kiosk-rpi.sh
```

```bash
sudo ./setup-kiosk-rpi.sh --url "http://SERVER-IP:8080/tv-v3.html?id=1"
```

Udskift `SERVER-IP` med IP-adressen på den maskine der kører selve appen, og
`id=1` med banenummeret.

Vil du have TV'et til også at tænde og slukke sig selv:

```bash
sudo ./setup-kiosk-rpi.sh --url "http://SERVER-IP:8080/tv-v3.html?id=1" --tv-on 15:30 --tv-off 23:00
```

### 4. Genstart

```bash
sudo reboot
```

Pi'en booter nu direkte til siden. Der er ingen login-skærm, intet skrivebord og
ingen musemarkør.

---

## URL'er du kan pege på

| Side | URL |
|---|---|
| TV-visning, bane 1 | `http://SERVER:8080/tv-v3.html?id=1` |
| TV-visning, bane 3 | `http://SERVER:8080/tv-v3.html?id=3` |
| Oversigt over alle baner | `http://SERVER:8080/oversigt.html` |
| Via device-token | `http://SERVER:8080/t/<token>` |
| TV uden QR-kode | `http://SERVER:8080/tv-v3.html?id=1&qr=0` |

Device-token-varianten er værd at overveje: så styres bane og QR-indstilling fra
admin-siden i stedet for fra Pi'ens konfigurationsfil, og du kan flytte en skærm
til en anden bane uden at logge ind på den.

---

## Tilvalg til scriptet

```
--url <URL>            Siden der skal vises (påkrævet)
--user <navn>          Bruger kiosken kører som (default: den der kørte sudo)
--resolution <mode>    HDMI-mode der tvinges igennem (default: 1920x1080@60)
--no-video-force       Lad TV'et bestemme opløsningen via EDID
--restart-at <HH:MM>   Dagligt genstartstidspunkt for browseren (default: 04:00)
--tv-on <HH:MM>        Tænd TV'et via HDMI-CEC
--tv-off <HH:MM>       Sluk (standby) TV'et via HDMI-CEC
```

---

## Hvad scriptet faktisk gør

| Trin | Handling | Hvorfor |
|---|---|---|
| 1 | Installerer `cage` + `chromium` | Grafisk stak uden skrivebord |
| 2 | Skriver `/etc/badminton-kiosk.conf` | URL'en ligger for sig, så du kan skifte bane uden at redigere systemd-filer |
| 3 | Skriver `/usr/local/bin/badminton-kiosk` | Start-wrapperen — kan køres manuelt til fejlsøgning |
| 4 | Opretter systemd-servicen | Starter ved boot, genstarter automatisk ved crash |
| 5 | Tilføjer `video=` til `cmdline.txt` | Så opløsningen er rigtig selv når TV'et er slukket ved boot |
| 6 | Lægger cron-jobs ind | Natlig browser-genstart, og evt. HDMI-CEC-styring |

Et par detaljer der er værd at kende:

**Servicen bruger `PAMName=login` + `TTYPath=/dev/tty1`.** Det giver processen en
rigtig logind-session på seat0, hvilket `cage` skal bruge for at få adgang til
skærm og input. Det er også grunden til at du *ikke* behøver at slå konsol-
autologin til — mange kiosk-vejledninger på nettet gør det, men det er
overflødigt med denne opsætning.

**`Restart=always`** betyder at browseren rejser sig selv hvis den crasher midt i
en turnering. Det alene er en opgradering i forhold til en Windows-maskine.

**Chromium-cachen ligger i `/dev/shm`** (altså i RAM). Det sparer SD-kortet og
virker også når du senere slår read-only overlay-filsystem til.

**Wrapperen nulstiller Chromiums `exit_type` før start.** Efter en
strømafbrydelse mener Chromium at den crashede og vil vise en "Gendan sider?"-
boble hen over TV-billedet. Den kommer aldrig frem med det her.

---

## Daglig drift

**Skift bane eller side:**

```bash
sudo nano /etc/badminton-kiosk.conf
```

```bash
sudo systemctl restart badminton-kiosk
```

**Se hvad der sker:**

```bash
journalctl -u badminton-kiosk -f
```

**Stop midlertidigt** (giver dig konsollen tilbage på skærmen):

```bash
sudo systemctl stop badminton-kiosk
```

**Test start-kommandoen manuelt:**

```bash
sudo systemctl stop badminton-kiosk && /usr/local/bin/badminton-kiosk
```

---

## HDMI-CEC — Pi'en kan styre selve TV'et

Det her er en gratis gevinst som en mini-PC typisk ikke kan levere. Over
HDMI-kablet kan Pi'en tænde TV'et og sende det i standby:

```bash
echo "on 0" | cec-client -s -d 1
```

```bash
echo "standby 0" | cec-client -s -d 1
```

Scriptet lægger det i cron hvis du bruger `--tv-on` / `--tv-off`. Så tænder
skærmen af sig selv før træning og slukker om aftenen, uden at nogen skal huske
det — og *der* er den rigtige strømbesparelse.

CEC skal være slået til i TV'ets menu. Producenterne kalder det næsten aldrig
"CEC": Samsung kalder det *Anynet+*, LG *SimpLink*, Sony *BRAVIA Sync*,
Philips *EasyLink*, Panasonic *VIERA Link*.

---

## Beskyt SD-kortet

Et kiosk-system bliver slukket på kontakten, ikke via menuen. Det slider på
SD-kortet, og før eller siden korrumperer filsystemet.

**Når alt virker**, slå read-only overlay-filsystem til:

```bash
sudo raspi-config
```

→ *Performance Options* → *Overlay File System* → slå til, og sæt boot-partitionen
til read-only.

Derefter er SD-kortet urørt under drift, og maskinen tåler at blive revet ud af
stikket. Alle ændringer forsvinder ved genstart — så husk at slå overlay fra igen,
før du ændrer noget, og til igen bagefter.

Gør det **til sidst**, efter alt andet er på plads.

---

## Fejlsøgning

| Symptom | Sandsynlig årsag | Løsning |
|---|---|---|
| Sort skærm efter boot | TV'et var slukket ved boot | Tjek at `video=HDMI-A-1:1920x1080@60D` står i `/boot/firmware/cmdline.txt` |
| Intet billede overhovedet | Forkert HDMI-port på Pi'en | Brug den port der er **nærmest USB-C-stikket** (HDMI0) |
| Billedet er skåret af i kanterne | TV'ets overscan | Slå TV'ets billedtilpasning fra — søg efter "Just Scan", "Screen Fit", "1:1" eller "Full Pixel" |
| Siden hakker eller animationen stammer | GPU-belastning | `backdrop-filter` er første mistænkte — prøv at slå den fra i [tv-v3-styles.css](frontend/tv-v3-styles.css) |
| Regnbue-ikon i hjørnet | Underspænding | Brug den officielle strømforsyning, ikke en telefonoplader |
| Servicen starter ikke | Se logs | `journalctl -u badminton-kiosk -n 50` |
| "Ingen forbindelse til serveren" | App-serveren er ikke oppe endnu | Servicen prøver igen hvert 5. sekund — vent, eller tjek serveren |
| CEC virker ikke | CEC er slået fra i TV'et | Se producentnavnene ovenfor. Tjek også med `echo "scan" \| cec-client -s -d 1` |
| Skærmen går i sort efter et stykke tid | Skærmslukning | Skulle ikke ske under `cage`. Tjek at `consoleblank=0` står i `cmdline.txt` |

---

## Flere skærme

Hver skærm er sin egen Pi med sin egen URL. Giv dem hostnames der siger noget:
`tv-bane1`, `tv-bane2`, `tv-oversigt`. Så kan du styre dem alle fra din egen
maskine:

```bash
ssh pi@tv-bane2.local 'sudo systemctl restart badminton-kiosk'
```

Oversigtsskærmen får bare en anden URL:

```bash
sudo ./setup-kiosk-rpi.sh --url "http://SERVER-IP:8080/oversigt.html"
```

---

## Manuel opsætning uden scriptet

Hvis du hellere vil gøre det i hånden, er det i praksis fire ting:

```bash
sudo apt install -y cage chromium
```

Derefter en systemd-service på `/etc/systemd/system/badminton-kiosk.service`:

```ini
[Unit]
Description=Badminton Counter TV kiosk
After=systemd-user-sessions.service network-online.target getty@tty1.service
Wants=network-online.target
Conflicts=getty@tty1.service

[Service]
Type=simple
User=pi
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
ExecStart=/usr/bin/cage -- /usr/bin/chromium --kiosk --ozone-platform=wayland --use-gl=egl --noerrdialogs --disable-infobars --disable-session-crashed-bubble http://SERVER-IP:8080/tv-v3.html?id=1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now badminton-kiosk
```

Og til sidst `video=HDMI-A-1:1920x1080@60D consoleblank=0` tilføjet til den
eksisterende linje i `/boot/firmware/cmdline.txt` — filen **skal** blive ved med
at være én enkelt linje.

---

## Se også

- [QUICKSTART.RASPBERRY_PI.md](QUICKSTART.RASPBERRY_PI.md) — kør *serveren* på en Pi
- [README.RASPBERRY_PI.md](README.RASPBERRY_PI.md) — fuld serverguide
- [RASPBERRY_PI_FILES.md](RASPBERRY_PI_FILES.md) — oversigt over Pi-filer
