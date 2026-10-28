#!/bin/bash
# Test af livestreamen (usr/lib/badminton-tv/stream) med en rigtig ffmpeg:
# "kameraet" er et testbillede (lavfi), "YouTube" er en ffmpeg, der lytter på
# RTMP, og "serveren" er en lille Python-server, der svarer, hvad testen vil.
#   1. kamera, men ingen kamp     → intet sendes, status siger kameraets navn
#   2. kamp på banen              → sender 1280x720 H.264 + lydløs AAC, scoreboard
#   3. stillingen ændres          → scoreboardet tegnes igen uden genstart
#      (5 og 6: en ældre server uden scoreboard → to linjer tekst)
#   4. kampen er slut             → streamen stoppes pænt
#   5. YouTube afviser            → fejlen i ord til admin, nøglen aldrig i loggen
#   6. grafikkortet kan ikke kode → koder på CPU'en i stedet
#   7. serveren svarer ikke       → stopper efter UDEN_SVAR
#
# Køres i en debian:trixie-container (henter ffmpeg, python3, Pillow og skrifterne):
#   docker run --rm -v "$PWD/kiosk:/src" debian:trixie bash /src/test/test-stream.sh

set -uo pipefail
SRC=$(cd "$(dirname "$0")/.." && pwd)
STREAM=$SRC/live/config/includes.chroot_after_packages/usr/lib/badminton-tv/stream
TMP=$(mktemp -d)
FEJL=0
NOEGLE=hemmelig-noegle-1234
RTMP_PORT=19350

if ! command -v ffmpeg >/dev/null || ! python3 -c "import PIL" 2>/dev/null || [ ! -e /usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf ] || [ ! -d /usr/share/fonts/opentype/inter ]; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg python3 python3-pil fonts-dejavu-core fonts-inter fonts-bebas-neue >/dev/null
fi

forvent() { # navn faktisk forventet
    if [ "$2" = "$3" ]; then
        printf '  ok    %s\n' "$1"
    else
        printf '  FEJL  %s\n        fik:      %s\n        forventet: %s\n' "$1" "$2" "$3"
        FEJL=$((FEJL + 1))
    fi
}
indeholder() { # navn tekst delstreng
    if [[ "$2" == *"$3"* ]]; then
        printf '  ok    %s\n' "$1"
    else
        printf '  FEJL  %s\n        "%s" findes ikke i:\n%s\n' "$1" "$3" "$2"
        FEJL=$((FEJL + 1))
    fi
}
vent_paa() { # sekunder kommando… — sand, når kommandoen lykkes inden for tiden
    local slut=$((SECONDS + $1)); shift
    while [ $SECONDS -lt $slut ]; do "$@" && return 0; sleep 0.3; done
    return 1
}

# ── Falsk server: svarer indholdet af $TMP/svar.json (503 uden), gemmer status ──
cat > "$TMP/server.py" <<'EOF'
import http.server, json, os, sys
ROD = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        data['_token'] = self.headers.get('X-Adgangslink')
        with open(os.path.join(ROD, 'status.jsonl'), 'a') as f:
            f.write(json.dumps(data, ensure_ascii=False) + '\n')
        try:
            svar = open(os.path.join(ROD, 'svar.json'), 'rb').read()
        except OSError:
            self.send_response(503); self.end_headers(); return
        self.send_response(200)
        self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(svar)
    def log_message(self, *a): pass
s = http.server.HTTPServer(('127.0.0.1', 0), H)
open(os.path.join(ROD, 'port'), 'w').write(str(s.server_port))
s.serve_forever()
EOF
python3 "$TMP/server.py" "$TMP" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; pkill -x ffmpeg 2>/dev/null; rm -rf "${TMP:?}"' EXIT
vent_paa 5 test -s "$TMP/port"
PORT=$(cat "$TMP/port")
printf "BT_TV_URL=http://127.0.0.1:%s/t/TESTTOKEN12\nBT_NAVN=tv-bane3\n" "$PORT" > "$TMP/kiosk.env"

# ── "Kameraet": by-id-link til en fil; ffmpeg-falsk bytter v4l2 ud med testbillede ──
mkdir -p "$TMP/by-id" "$TMP/bin"
: > "$TMP/video0"
ln -s "$TMP/video0" "$TMP/by-id/usb-046d_HD_Pro_Webcam_C920_ABCDEF12-video-index0"
cat > "$TMP/bin/ffmpeg-falsk" <<'EOF'
#!/bin/bash
ud=()
while [ $# -gt 0 ]; do
    if [ "$1" = -f ] && [ "${2:-}" = v4l2 ]; then
        while [ "$1" != -i ]; do shift; done
        shift 2
        ud+=(-re -f lavfi -i testsrc2=size=1280x720:rate=30)
        continue
    fi
    ud+=("$1"); shift
done
echo "$$" >> "$FFMPEG_LOG"
exec ffmpeg "${ud[@]}"
EOF
chmod +x "$TMP/bin/ffmpeg-falsk"
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/v4l2-ctl"; chmod +x "$TMP/bin/v4l2-ctl"

svar() { printf '%s' "$1" > "$TMP/svar.json"; }
SEND_SVAR() { # linje1 linje2 [scoreboard-JSON — uden: en ældre server]
    svar "{\"kamera\":true,\"bane\":3,\"send\":true,\"grund\":\"kamp\",\"url\":\"rtmp://127.0.0.1:$RTMP_PORT/live2\",\"noegle\":\"$NOEGLE\",\"overlay\":true,\"linjer\":[\"$1\",\"$2\"]${3:+,\"tavle\":$3}}"
}
TAVLE_JSON() { # stilling1 stilling2
    printf '{"bane":3,"navne":["Hansen","Jensen"],"saet":[[21,15]],"nu":[%s,%s],"serve":1}' "$1" "$2"
}
# Farven midt i scoreboardets panel i et billede fra streamen: "mørk" eller "lys"
panel_farve() { # flv-fil
    ffmpeg -v error -sseof -1 -i "$1" -frames:v 1 -vf "crop=20:10:175:60,scale=1:1" -f rawvideo -pix_fmt gray - 2>/dev/null |
        od -An -tu1 | awk '{ print ($1 < 60 ? "mørk" : "lys") }'
}
INGEN_SVAR='{"kamera":true,"bane":3,"send":false,"grund":"ingen-kamp"}'

start_stream() { # [ekstra miljø…]
    : > "$TMP/ffmpeg.log"; : > "$TMP/status.jsonl"
    env FFMPEG_LOG="$TMP/ffmpeg.log" BT_KIOSK_ENV="$TMP/kiosk.env" BT_VERSION_FIL=/dev/null \
        BT_STREAM_MAPPE="$TMP/run" BT_FFMPEG="$TMP/bin/ffmpeg-falsk" BT_V4L2CTL="$TMP/bin/v4l2-ctl" \
        BT_KAMERA_GLOB="$TMP/by-id/*-video-index0" BT_RENDER="$TMP/ingen-render" \
        BT_SPOERG_SENDER=1 BT_SPOERG_KLAR=1 BT_SPOERG_FEJL=1 BT_GENFORSOEG=2 BT_STABIL=3 BT_UDEN_SVAR=4 "$@" \
        python3 "$STREAM" > "$TMP/stream.log" 2>&1 &
    STREAM_PID=$!
}
stop_stream() { kill "$STREAM_PID" 2>/dev/null; wait "$STREAM_PID" 2>/dev/null; }
modtager() { # fil — "YouTube": tager imod én stream og gemmer den
    ffmpeg -hide_banner -loglevel error -listen 1 -i "rtmp://127.0.0.1:$RTMP_PORT/live2/$NOEGLE" \
        -c copy -f flv "$1" > "$TMP/modtager.log" 2>&1 &
    MODTAGER_PID=$!
    sleep 1
}
sidste_status() { tail -n 1 "$TMP/status.jsonl"; }
felt() { python3 -c 'import json,sys; d=json.loads(sys.stdin.read() or "{}"); v=d.get(sys.argv[1]); print("" if v is None else v)' "$1"; }
antal_start() { wc -l < "$TMP/ffmpeg.log" | tr -d ' '; }

echo "1. Kamera, men ingen kamp"
svar "$INGEN_SVAR"
start_stream
vent_paa 10 test -s "$TMP/status.jsonl"
sleep 2
forvent "ingen ffmpeg startet" "$(antal_start)" 0
forvent "kameraets navn til admin" "$(sidste_status | felt kamera)" "HD Pro Webcam C920"
forvent "adgangslinkets token" "$(sidste_status | felt _token)" "TESTTOKEN12"
forvent "sender ikke" "$(sidste_status | felt sender)" "False"

echo "2. Kamp på banen"
modtager "$TMP/modtaget.flv"
SEND_SVAR "Hansen 21  5" "Jensen 15  3" "$(TAVLE_JSON 5 3)"
vent_paa 10 test -s "$TMP/ffmpeg.log" || true
forvent "ffmpeg startet én gang" "$(antal_start)" 1
forvent "scoreboardet tegnet (1280x220 PNG)" \
    "$(python3 -c 'import sys; from PIL import Image; i=Image.open(sys.argv[1]); print(i.format, i.size)' "$TMP/run/tavle.png" 2>&1)" \
    "PNG (1280, 220)"
indeholder "overlay: scoreboardet" "$(cat "$TMP/stream.log")" "overlay tavle"
vent_paa 10 sh -c "tail -n 1 '$TMP/status.jsonl' | grep -q '\"sender\": true'" || true
forvent "status: sender" "$(sidste_status | felt sender)" "True"
forvent "status: koder på CPU'en (intet grafikkort)" "$(sidste_status | felt koder)" "x264"

echo "3. Stillingen ændres"
FOER=$(md5sum < "$TMP/run/tavle.png")
SEND_SVAR "Hansen 21  6" "Jensen 15  3" "$(TAVLE_JSON 6 3)"
vent_paa 5 sh -c "[ \"\$(md5sum < '$TMP/run/tavle.png')\" != '$FOER' ]" || true
forvent "scoreboardet tegnet igen" "$([ "$(md5sum < "$TMP/run/tavle.png")" != "$FOER" ] && echo ja || echo nej)" "ja"
sleep 3
forvent "ingen genstart af ffmpeg" "$(antal_start)" 1

echo "4. Kampen er slut"
svar "$INGEN_SVAR"
vent_paa 10 sh -c "! kill -0 $MODTAGER_PID 2>/dev/null" || true
forvent "modtageren fik streamen afsluttet" "$(kill -0 "$MODTAGER_PID" 2>/dev/null && echo kører || echo slut)" "slut"
INFO=$(ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration -of compact "$TMP/modtaget.flv" 2>&1)
indeholder "H.264 1280x720" "$INFO" "codec_name=h264|width=1280|height=720"
indeholder "AAC-lydspor" "$INFO" "codec_name=aac"
VARIGHED=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/modtaget.flv" | cut -d. -f1)
forvent "mindst 5 sekunder modtaget" "$([ "${VARIGHED:-0}" -ge 5 ] && echo ja || echo "nej (${VARIGHED:-0} s)")" "ja"
forvent "scoreboardet står i billedet" "$(panel_farve "$TMP/modtaget.flv")" "mørk"
# Halter ffmpeg efter kameraet (fx når scoreboardet styrer tempoet), kommer der
# langt færre end 30 billeder i sekundet frem
BILLEDER=$(ffprobe -v error -select_streams v -count_packets -show_entries stream=nb_read_packets -of csv=p=0 "$TMP/modtaget.flv")
forvent "mindst 25 billeder i sekundet" \
    "$([ "${BILLEDER:-0}" -ge $(( ${VARIGHED:-1} * 25 )) ] && echo ja || echo "nej (${BILLEDER:-0} på ${VARIGHED:-0} s)")" "ja"
# Et billede fra streamen med overlayet, til at se på: GEM_BILLEDE=/src/billede.png
if [ -n "${GEM_BILLEDE:-}" ]; then
    ffmpeg -v error -sseof -1 -i "$TMP/modtaget.flv" -frames:v 1 -y "$GEM_BILLEDE" 2>/dev/null
fi
vent_paa 5 sh -c "tail -n 1 '$TMP/status.jsonl' | grep -q '\"sender\": false'" || true
forvent "status: sender ikke" "$(sidste_status | felt sender)" "False"
stop_stream

echo "5. YouTube afviser (ingen modtager)"
SEND_SVAR "A 1" "B 0"
start_stream
vent_paa 15 sh -c "tail -n 1 '$TMP/status.jsonl' | grep -q 'afviste'" || true
indeholder "fejlen i ord" "$(sidste_status | felt fejl)" "YouTube afviste forbindelsen"
vent_paa 10 test "$(antal_start)" -ge 2 || true
forvent "prøver igen" "$([ "$(antal_start)" -ge 2 ] && echo ja || echo nej)" "ja"
forvent "nøglen står ikke i loggen" "$(grep -c "$NOEGLE" "$TMP/stream.log")" 0
forvent "nøglen står ikke i statussen" "$(grep -c "$NOEGLE" "$TMP/status.jsonl")" 0
indeholder "fejlen står i loggen med <nøgle>" "$(cat "$TMP/stream.log")" "<nøgle>"
stop_stream

echo "6. Grafikkortet kan ikke kode"
: > "$TMP/renderD128"   # findes, men er ikke et grafikkort
modtager "$TMP/modtaget2.flv"
SEND_SVAR "A 1" "B 0"
start_stream BT_RENDER="$TMP/renderD128"
vent_paa 20 sh -c "tail -n 1 '$TMP/status.jsonl' | grep -q '\"sender\": true, \"koder\": \"x264\"'" || true
indeholder "skiftede til CPU'en" "$(cat "$TMP/stream.log")" "koder på CPU'en fremover"
forvent "sender med x264" "$(sidste_status | felt koder)/$(sidste_status | felt sender)" "x264/True"
forvent "ingen fejl til admin" "$(sidste_status | felt fejl)" ""
# Svaret har ingen scoreboard (en ældre server) → to linjer tekst
forvent "ældre server: tekst-overlayet" "$(cat "$TMP/run/overlay.txt" 2>/dev/null)" "$(printf 'A 1\nB 0')"
indeholder "overlay: tekst" "$(cat "$TMP/stream.log")" "overlay tekst"

echo "7. Serveren svarer ikke"
rm -f "$TMP/svar.json"
START=$SECONDS
vent_paa 30 grep -q "intet svar fra serveren" "$TMP/stream.log" || true
indeholder "stopper uden svar" "$(cat "$TMP/stream.log")" "intet svar fra serveren i 4"
forvent "efter ca. 4 sekunder" "$([ $((SECONDS - START)) -le 12 ] && echo ja || echo "nej ($((SECONDS - START)) s)")" "ja"
stop_stream
kill "$MODTAGER_PID" 2>/dev/null

echo
if [ "$FEJL" -eq 0 ]; then echo "Alle test bestået"; else echo "$FEJL fejl"; tail -n 30 "$TMP/stream.log"; fi
exit "$FEJL"
