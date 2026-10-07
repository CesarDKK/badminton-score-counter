#!/bin/bash
# Tester browser-vagten mod en rigtig Chromium (headless) med fejlsøgningsporten:
#   1. sund side          → ingen genstart
#   2. frossen JavaScript → genstart
#   3. stoppet hjerteslag → genstart
#   4. disken svarer      → ingen kernepanik
#   5. disken er væk      → kernepanik (sysrq 'c' — skrives til en testfil her)
#   6. kernelog-filteret  → kun advarsler om disken gentages før panikken
#
# Køres i en debian:trixie-container (henter chromium + python3):
#   docker run --rm -v "$PWD/kiosk:/src" debian:trixie bash /src/test/test-browservagt.sh

set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
VAGT=$SRC/live/config/includes.chroot_after_packages/usr/lib/badminton-tv/browservagt
ARB=$(mktemp -d)
FEJL=0

if ! command -v chromium >/dev/null || ! command -v python3 >/dev/null; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq chromium python3 >/dev/null
fi

# Testsiden: sætter hjerteslaget hvert sekund, ligesom tv-script-v3.js
cat > "$ARB/tv.html" <<'EOF'
<!doctype html><title>TV</title>
<script>window.__btTimer = setInterval(() => { window.__btTik = Date.now(); }, 1000);</script>
EOF
(cd "$ARB" && python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1) &
WEB=$!

start_chromium() {
    chromium --headless=new --no-sandbox --disable-gpu --user-data-dir="$ARB/profil" \
        --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 \
        http://127.0.0.1:8765/tv.html >/dev/null 2>&1 &
    CHROME=$!
    for _ in $(seq 30); do
        python3 -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:9222/json/list", timeout=1)' 2>/dev/null && return
        sleep 1
    done
    echo "Chromium startede ikke"; exit 1
}

# Afvikler JavaScript i siden uden at vente på svar (til at fryse den)
send_js() {
    python3 - "$1" <<'EOF'
import json, sys, urllib.request
p =[x for x in json.load(urllib.request.urlopen('http://127.0.0.1:9222/json/list')) if x['type'] == 'page'][0]
import socket, base64, os, struct
rest = p['webSocketDebuggerUrl'].split('://', 1)[1]; vaert, sti = rest.split('/', 1); h, port = vaert.split(':')
s = socket.create_connection((h, int(port)))
s.sendall(f'GET /{sti} HTTP/1.1\r\nHost: {vaert}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {base64.b64encode(os.urandom(16)).decode()}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
s.recv(4096)
b = json.dumps({'id': 9, 'method': 'Runtime.evaluate', 'params': {'expression': sys.argv[1]}}).encode()
m = os.urandom(4)
hd = bytes([0x81]) + (bytes([0x80 | len(b)]) if len(b) < 126 else bytes([0xfe]) + struct.pack('>H', len(b)))
s.sendall(hd + m + bytes(c ^ m[i % 4] for i, c in enumerate(b)))
EOF
}

# Kører vagten et stykke tid; returnerer om den genstartede browseren.
# BT_DISK tomt = ingen disk-vagt (som på live-USB'en); sysrq går til en testfil.
koer_vagt() { # sekunder [disk]
    rm -f "$ARB/genstartet" "$ARB/sysrq"
    BT_VAGT_OPSTART=1 BT_VAGT_INTERVAL=2 BT_GENSTART="touch $ARB/genstartet" \
        BT_DISK="${2:-}" BT_SYSRQ="$ARB/sysrq" \
        timeout "$1" python3 "$VAGT" > "$ARB/vagt.log" 2>&1
    [ -f "$ARB/genstartet" ]
}

# Returnerer om disk-vagten udløste en kernepanik (sysrq 'c')
panik_udloest() { [ -f "$ARB/sysrq" ] && grep -q c "$ARB/sysrq"; }

tjek() { # navn forventet(ja/nej) faktisk(0=genstart)
    local faktisk=nej
    [ "$3" = 0 ] && faktisk=ja
    if [ "$2" = "$faktisk" ]; then
        printf '  OK    %s (genstart: %s)\n' "$1" "$faktisk"
    else
        printf '  FEJL  %s (genstart: %s, forventet %s)\n' "$1" "$faktisk" "$2"
        sed 's/^/        /' "$ARB/vagt.log"
        FEJL=$((FEJL + 1))
    fi
}

echo "Browser-vagten mod headless Chromium:"
start_chromium
sleep 3
koer_vagt 15; tjek "sund side" nej $?

send_js 'clearInterval(window.__btTimer)'
sleep 32
koer_vagt 15; tjek "hjerteslaget står stille" ja $?
kill "$CHROME" 2>/dev/null; wait "$CHROME" 2>/dev/null

start_chromium
sleep 3
send_js 'while (true) {}'
sleep 1
koer_vagt 60; tjek "frossen JavaScript" ja $?
kill -9 "$CHROME" 2>/dev/null

# Disk-vagten: en læsbar "disk" (en fil på 1 MB) og en, der er væk.
start_chromium
sleep 3
head -c 1048576 /dev/zero > "$ARB/disk.img"
koer_vagt 12 "$ARB/disk.img"; panik_udloest; tjek "disken svarer" nej $?
koer_vagt 12 "$ARB/findes-ikke"; panik_udloest; tjek "disken er væk → kernepanik" ja $?
grep -q "disk-vagt på $ARB/findes-ikke" "$ARB/vagt.log" || { echo "  FEJL  disk-vagten blev ikke slået til"; FEJL=$((FEJL + 1)); }
kill -9 "$CHROME" 2>/dev/null

# Kernelog-filteret: hvilke /dev/kmsg-poster gentages før panikken
python3 - "$VAGT" <<'EOF'
import importlib.machinery, importlib.util, sys
sp = importlib.util.spec_from_loader('bv', importlib.machinery.SourceFileLoader('bv', sys.argv[1]))
bv = importlib.util.module_from_spec(sp); sp.loader.exec_module(bv)
med = [b'3,1,1,-;nvme nvme0: I/O 5 QID 1 timeout, aborting\n',
       b'4,2,2,-;nvme nvme0: controller is down; will reset: CSTS=0xffffffff\n',
       b'3,3,3,-;Aborting journal on device nvme0n1p2-8.\n',
       b'4,4,4,-;EXT4-fs (nvme0n1p2): shut down requested (2)\n',
       b'3,5,5,-;blk_update_request: I/O error, dev mmcblk0, sector 2048\n']
uden = [b'6,6,6,-;nvme nvme0: pci function 0000:01:00.0\n',            # info
        b'4,7,7,-;EXT4-fs warning (device nvme0n1p2): dx_probe:823\n',  # det døde fs' støj
        b'3,8,8,-;usb 1-1: device descriptor read/64, error -71\n',    # ikke disken
        b'hvad er det her\n']                                            # ugyldig post
fejl = [p for p in med if not bv.disklinje(p)] + [p for p in uden if bv.disklinje(p)]
for p in fejl: print('   forkert:', p)
sys.exit(1 if fejl else 0)
EOF
tjek "kernelog-filteret" ja $?

kill "$WEB" 2>/dev/null
rm -rf "$ARB"
[ "$FEJL" = 0 ] && echo "Alle tjek bestået." || { echo "$FEJL tjek fejlede."; exit 1; }
