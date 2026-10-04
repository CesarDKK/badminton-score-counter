#!/bin/bash
# Tester browser-vagten mod en rigtig Chromium (headless) med fejlsøgningsporten:
#   1. sund side          → ingen genstart
#   2. frossen JavaScript → genstart
#   3. stoppet hjerteslag → genstart
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

# Kører vagten et stykke tid; returnerer om den genstartede browseren
koer_vagt() { # sekunder
    rm -f "$ARB/genstartet"
    BT_VAGT_OPSTART=1 BT_VAGT_INTERVAL=2 BT_GENSTART="touch $ARB/genstartet" \
        timeout "$1" python3 "$VAGT" > "$ARB/vagt.log" 2>&1
    [ -f "$ARB/genstartet" ]
}

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

kill "$WEB" 2>/dev/null
rm -rf "$ARB"
[ "$FEJL" = 0 ] && echo "Alle tjek bestået." || { echo "$FEJL tjek fejlede."; exit 1; }
