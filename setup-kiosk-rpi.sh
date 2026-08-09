#!/bin/bash
# Badminton Counter - Kiosk Setup for Raspberry Pi
#
# Saetter en Raspberry Pi op som TV-skaerm i hallen: den booter direkte til
# Chromium i fuldskaerm paa TV-siden eller oversigten, uden skrivebord.
#
# Koeres paa en frisk Raspberry Pi OS Lite (64-bit), Bookworm eller nyere:
#   sudo ./setup-kiosk-rpi.sh --url "http://192.168.1.50:8080/tv-v3.html?id=1"
#
# Se KIOSK.RASPBERRY_PI.md for den fulde vejledning.

set -euo pipefail

# ── Standardvaerdier ───────────────────────────────────────
KIOSK_URL=""
KIOSK_USER=""
RESOLUTION="1920x1080@60"
FORCE_VIDEO=1
RESTART_AT="04:00"
TV_ON=""
TV_OFF=""
INSTALL_CEC=0

CONF_FILE="/etc/badminton-kiosk.conf"
WRAPPER="/usr/local/bin/badminton-kiosk"
SERVICE="/etc/systemd/system/badminton-kiosk.service"
CRON_CEC="/etc/cron.d/badminton-kiosk-cec"

usage() {
    cat <<'EOF'
Badminton Counter - Kiosk Setup for Raspberry Pi

BRUG:
  sudo ./setup-kiosk-rpi.sh --url <URL> [tilvalg]

PAAKRAEVET:
  --url <URL>          Siden der skal vises. Eksempler:
                         http://SERVER:8080/tv-v3.html?id=1
                         http://SERVER:8080/oversigt.html
                         http://SERVER:8080/t/<device-token>

TILVALG:
  --user <navn>        Bruger kiosken koerer som (default: den der koerte sudo)
  --resolution <mode>  HDMI-mode der tvinges igennem (default: 1920x1080@60)
  --no-video-force     Tving ikke oploesning - lad TV'et bestemme via EDID
  --restart-at <HH:MM> Dagligt genstartstidspunkt for browseren (default: 04:00)
                       Saet til "none" for at slaa fra
  --tv-on <HH:MM>      Taend TV'et via HDMI-CEC paa dette tidspunkt
  --tv-off <HH:MM>     Sluk (standby) TV'et via HDMI-CEC paa dette tidspunkt
  -h, --help           Vis denne hjaelp

EKSEMPEL - bane 1, TV taendt 15:30-23:00:
  sudo ./setup-kiosk-rpi.sh \
    --url "http://192.168.1.50:8080/tv-v3.html?id=1" \
    --tv-on 15:30 --tv-off 23:00

EFTER INSTALLATION:
  Skift side:     sudo nano /etc/badminton-kiosk.conf
                  sudo systemctl restart badminton-kiosk
  Se logs:        journalctl -u badminton-kiosk -f
  Stop midlertidigt: sudo systemctl stop badminton-kiosk
EOF
}

# ── Parse argumenter ───────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --url)         KIOSK_URL="${2:-}"; shift 2 ;;
        --user)        KIOSK_USER="${2:-}"; shift 2 ;;
        --resolution)  RESOLUTION="${2:-}"; shift 2 ;;
        --no-video-force) FORCE_VIDEO=0; shift ;;
        --restart-at)  RESTART_AT="${2:-}"; shift 2 ;;
        --tv-on)       TV_ON="${2:-}"; INSTALL_CEC=1; shift 2 ;;
        --tv-off)      TV_OFF="${2:-}"; INSTALL_CEC=1; shift 2 ;;
        -h|--help)     usage; exit 0 ;;
        *) echo "Ukendt argument: $1"; echo; usage; exit 1 ;;
    esac
done

echo "========================================"
echo "Badminton Counter - Kiosk Setup"
echo "========================================"
echo ""

# ── Forudsaetninger ────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    echo "ERROR: Skal koeres med sudo."
    echo "  sudo ./setup-kiosk-rpi.sh --url \"...\""
    exit 1
fi

if [ -z "$KIOSK_URL" ]; then
    echo "ERROR: --url mangler."
    echo ""
    usage
    exit 1
fi

ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" && "$ARCH" != "armv7l" ]]; then
    echo "WARNING: Dette ligner ikke en Raspberry Pi (arkitektur: $ARCH)."
    read -p "Fortsaet alligevel? (y/N): " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Find brugeren kiosken skal koere som. Kiosken maa ikke koere som root -
# Chromium naegter at starte som root, og den skal have en rigtig logind-session.
if [ -z "$KIOSK_USER" ]; then
    KIOSK_USER="${SUDO_USER:-}"
fi
if [ -z "$KIOSK_USER" ] || [ "$KIOSK_USER" = "root" ]; then
    if id -u pi >/dev/null 2>&1; then
        KIOSK_USER="pi"
    else
        echo "ERROR: Kunne ikke bestemme hvilken bruger kiosken skal koere som."
        echo "Angiv den med --user <navn>"
        exit 1
    fi
fi
if ! id -u "$KIOSK_USER" >/dev/null 2>&1; then
    echo "ERROR: Brugeren '$KIOSK_USER' findes ikke."
    exit 1
fi

echo "Konfiguration:"
echo "  URL:          $KIOSK_URL"
echo "  Bruger:       $KIOSK_USER"
if [ "$FORCE_VIDEO" -eq 1 ]; then
    echo "  Oploesning:   $RESOLUTION (tvunget)"
else
    echo "  Oploesning:   auto (EDID fra TV'et)"
fi
echo "  Genstart:     ${RESTART_AT}"
[ -n "$TV_ON" ]  && echo "  CEC taend:    $TV_ON"
[ -n "$TV_OFF" ] && echo "  CEC sluk:     $TV_OFF"
echo ""

# ── 1. Pakker ──────────────────────────────────────────────
echo "[1/6] Installerer pakker..."
PACKAGES="cage chromium"
if [ "$INSTALL_CEC" -eq 1 ]; then
    PACKAGES="$PACKAGES cec-utils"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# Nogle Pi OS-versioner hedder pakken chromium-browser i stedet for chromium.
if ! apt-get install -y -qq $PACKAGES 2>/dev/null; then
    echo "  chromium ikke fundet, proever chromium-browser..."
    PACKAGES="${PACKAGES/chromium/chromium-browser}"
    apt-get install -y -qq $PACKAGES
fi

# Find den installerede Chromium-binaer.
CHROMIUM_BIN=""
for candidate in /usr/bin/chromium /usr/bin/chromium-browser; do
    [ -x "$candidate" ] && CHROMIUM_BIN="$candidate" && break
done
if [ -z "$CHROMIUM_BIN" ]; then
    echo "ERROR: Fandt ikke Chromium efter installation."
    exit 1
fi
echo "  Chromium: $CHROMIUM_BIN"

# Kiosk-brugeren skal kunne tilgaa skaerm og input direkte.
for grp in video render input tty; do
    getent group "$grp" >/dev/null 2>&1 && usermod -aG "$grp" "$KIOSK_USER"
done
echo "  OK"
echo ""

# ── 2. Konfigurationsfil ───────────────────────────────────
# URL'en ligger for sig, saa man kan skifte bane uden at roere ved unit-filen.
echo "[2/6] Skriver $CONF_FILE..."
# Vaerdierne skal staa i enkelte anfoerselstegn: filen laeses af bash, og en URL
# med & (fx &qr=0) ville ellers blive opfattet som en kommando. Escapingen sker
# her og ikke inde i heredoc'en, hvor backslashes bliver aedt undervejs.
SQ="'"
SQ_ESCAPED="'\\''"
KIOSK_URL_ESC=${KIOSK_URL//$SQ/$SQ_ESCAPED}
cat > "$CONF_FILE" <<EOF
# Badminton Counter kiosk - konfiguration
# Ret URL'en her og koer derefter:
#   sudo systemctl restart badminton-kiosk
#
# BEHOLD de enkelte anfoerselstegn omkring URL'en.

KIOSK_URL='$KIOSK_URL_ESC'

# Chromium-binaer (findes automatisk ved installation)
CHROMIUM_BIN='$CHROMIUM_BIN'
EOF
chmod 644 "$CONF_FILE"
echo "  OK"
echo ""

# ── 3. Start-wrapper ───────────────────────────────────────
echo "[3/6] Skriver $WRAPPER..."
cat > "$WRAPPER" <<'WRAPPER_EOF'
#!/bin/bash
# Starter Chromium i fuldskaerm under cage (minimal Wayland kiosk-compositor).
# Kan koeres manuelt til fejlsoegning:
#   sudo systemctl stop badminton-kiosk && /usr/local/bin/badminton-kiosk

set -eu

# shellcheck disable=SC1091
. /etc/badminton-kiosk.conf

: "${KIOSK_URL:?KIOSK_URL mangler i /etc/badminton-kiosk.conf}"
: "${CHROMIUM_BIN:=/usr/bin/chromium}"

PROFILE="$HOME/.config/chromium/Default/Preferences"

# Efter en stroemafbrydelse mener Chromium at den crashede, og viser en
# "Gendan sider?"-boble hen over TV-billedet. Vi nulstiller flaget foer start.
if [ -f "$PROFILE" ]; then
    sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$PROFILE" || true
fi

# Cachen ligger i RAM: sparer SD-kortet og virker ogsaa med read-only overlay-FS.
CACHE_DIR="/dev/shm/chromium-kiosk-cache"
mkdir -p "$CACHE_DIR"

exec /usr/bin/cage -- "$CHROMIUM_BIN" \
    --kiosk \
    --ozone-platform=wayland \
    --use-gl=egl \
    --start-fullscreen \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=Translate,TranslateUI \
    --disable-component-update \
    --check-for-update-interval=31536000 \
    --password-store=basic \
    --hide-scrollbars \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    --autoplay-policy=no-user-gesture-required \
    --disk-cache-dir="$CACHE_DIR" \
    --disk-cache-size=104857600 \
    "$KIOSK_URL"
WRAPPER_EOF
chmod 755 "$WRAPPER"
echo "  OK"
echo ""

# ── 4. systemd-service ─────────────────────────────────────
# PAMName=login + TTYPath giver processen en rigtig logind-session paa seat0.
# Uden den kan cage ikke faa fat i skaerm og input. Det er ogsaa grunden til
# at vi ikke behoever konsol-autologin.
echo "[4/6] Skriver $SERVICE..."
cat > "$SERVICE" <<EOF
[Unit]
Description=Badminton Counter TV kiosk
After=systemd-user-sessions.service network-online.target getty@tty1.service
Wants=network-online.target
Conflicts=getty@tty1.service

[Service]
Type=simple
User=$KIOSK_USER
PAMName=login
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
StandardInput=tty
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
Environment=XDG_SESSION_TYPE=wayland
ExecStart=$WRAPPER
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable badminton-kiosk.service >/dev/null 2>&1
echo "  OK"
echo ""

# ── 5. HDMI-oploesning ─────────────────────────────────────
# Er TV'et slukket naar Pi'en booter, er der ingen EDID at laese, og Pi'en
# vaelger en tilfaeldig lille oploesning. 'D' i video=-parameteren tvinger
# udgangen taendt uanset hvad TV'et svarer.
echo "[5/6] Konfigurerer HDMI..."
CMDLINE=""
for candidate in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
    [ -f "$candidate" ] && CMDLINE="$candidate" && break
done

if [ "$FORCE_VIDEO" -eq 0 ]; then
    echo "  Sprunget over (--no-video-force)"
elif [ -z "$CMDLINE" ]; then
    echo "  WARNING: Fandt ikke cmdline.txt - springer over."
    echo "  Tilfoej selv: video=HDMI-A-1:${RESOLUTION}D"
elif grep -q "video=HDMI-A-1" "$CMDLINE"; then
    echo "  video=HDMI-A-1 er allerede sat i $CMDLINE - roerer den ikke."
else
    cp "$CMDLINE" "${CMDLINE}.bak-kiosk"
    # cmdline.txt SKAL vaere en enkelt linje - derfor sed paa linje 1.
    sed -i "1s|\$| video=HDMI-A-1:${RESOLUTION}D consoleblank=0|" "$CMDLINE"
    echo "  Tilfoejet til $CMDLINE (backup: ${CMDLINE}.bak-kiosk)"
fi
echo ""

# ── 6. Tidsstyring ─────────────────────────────────────────
echo "[6/6] Konfigurerer tidsstyring..."

# Daglig genstart af browseren. Chromium bruger langsomt mere hukommelse naar
# den koerer i ugevis, og en genstart om natten koster ingenting.
if [ "$RESTART_AT" = "none" ]; then
    rm -f /etc/cron.d/badminton-kiosk-restart
    echo "  Daglig genstart: slaaet fra"
else
    R_H="${RESTART_AT%%:*}"
    R_M="${RESTART_AT##*:}"
    cat > /etc/cron.d/badminton-kiosk-restart <<EOF
# Daglig genstart af kiosk-browseren
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
${R_M} ${R_H} * * * root systemctl restart badminton-kiosk
EOF
    chmod 644 /etc/cron.d/badminton-kiosk-restart
    echo "  Daglig genstart: $RESTART_AT"
fi

# HDMI-CEC: Pi'en kan taende og slukke selve TV'et over HDMI-kablet.
if [ "$INSTALL_CEC" -eq 1 ]; then
    {
        echo "# TV taend/sluk via HDMI-CEC"
        echo "SHELL=/bin/bash"
        echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
        if [ -n "$TV_ON" ]; then
            echo "${TV_ON##*:} ${TV_ON%%:*} * * * root echo 'on 0' | cec-client -s -d 1"
        fi
        if [ -n "$TV_OFF" ]; then
            echo "${TV_OFF##*:} ${TV_OFF%%:*} * * * root echo 'standby 0' | cec-client -s -d 1"
        fi
    } > "$CRON_CEC"
    chmod 644 "$CRON_CEC"
    echo "  HDMI-CEC: konfigureret"
else
    echo "  HDMI-CEC: ikke konfigureret (brug --tv-on / --tv-off)"
fi
echo ""

# ── Faerdig ────────────────────────────────────────────────
echo "========================================"
echo "Installation faerdig"
echo "========================================"
echo ""
echo "Genstart for at starte kiosken:"
echo "  sudo reboot"
echo ""
echo "Eller start med det samme (uden reboot faar du ikke den"
echo "tvungne HDMI-oploesning):"
echo "  sudo systemctl start badminton-kiosk"
echo ""
echo "Nyttige kommandoer:"
echo "  journalctl -u badminton-kiosk -f      # se hvad der sker"
echo "  sudo nano $CONF_FILE   # skift side/bane"
echo "  sudo systemctl restart badminton-kiosk"
echo "  sudo systemctl stop badminton-kiosk   # tilbage til konsollen"
echo ""
echo "NAAR ALT VIRKER - beskyt SD-kortet mod stroemafbrydelser:"
echo "  sudo raspi-config  ->  Performance Options  ->  Overlay File System"
echo "  (goer filsystemet read-only. Slaa det fra igen foer aendringer.)"
echo "========================================"
