#!/bin/bash
# Test af "Hent fejllog" fra admin (usr/lib/badminton-tv/fejllog) og den
# fælles indsamling (fejllog.sh, som USB-nøglens hentlog også bruger).
# Kører uden systemd: journalctl og systemctl er falske, og "serveren" er en
# lille Python-server på localhost.
#
#   bash kiosk/test/test-fejllog.sh

set -u
cd "$(dirname "$0")/.." || exit 1
LIB=$PWD/live/config/includes.chroot_after_packages/usr/lib/badminton-tv
TMP=$(mktemp -d)
trap 'kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMP"' EXIT

FEJL=0
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
mangler() { # navn tekst delstreng
    if [[ "$2" != *"$3"* ]]; then
        printf '  ok    %s\n' "$1"
    else
        printf '  FEJL  %s\n        "%s" skulle ikke stå i teksten\n' "$1" "$3"
        FEJL=$((FEJL + 1))
    fi
}

# ── Falske værktøjer ───────────────────────────────────────
# To opstarter: -1 frøs (ingen "Journal stopped"), 0 kører nu.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/journalctl" <<'EOF'
#!/bin/bash
b=''
args=("$@")
for i in "${!args[@]}"; do
    [ "${args[$i]}" = -b ] && b=${args[$((i + 1))]}
done
case " $* " in
    *" --list-boots "*)
        printf 'IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY\n'
        printf ' -1 aaaa Fri 2026-11-14 08:00:01 CET Sat 2026-11-14 15:04:10 CET\n'
        printf '  0 bbbb Sat 2026-11-14 15:06:30 CET Sat 2026-11-14 16:00:00 CET\n' ;;
    *" -p warning "*)
        printf 'chromium: GPU process hung (opstart %s)\n' "$b"
        printf 'browser: --app=https://lyngby.badmintonapp.dk/t/abcdEFGH1234_x?skaerm=tv2\n'
        printf 'curl -H X-Adgangslink: abcdEFGH1234_x\n'
        [ -n "${FAKE_MEGET:-}" ] && head -c "$FAKE_MEGET" /dev/urandom | base64 ;;
    *" -k "*) printf 'i915 0000:00:02.0: [drm] GPU HANG: ecode 12:1:85dffffb (opstart %s)\n' "$b" ;;
    *" -o cat "*) [ "$b" = 0 ] && printf 'Journal stopped\n' ;;   # (bruges ikke for 0 på det kørende system)
    *) printf 'linje fra opstart %s\n' "$b" ;;
esac
exit 0
EOF
cat > "$TMP/bin/systemctl" <<'EOF'
#!/bin/bash
case "$1" in is-active) echo active ;; esac
exit 0
EOF
chmod +x "$TMP/bin/"*
printf '2026.11.5\n' > "$TMP/version"
printf "BT_TV_URL=%q\nBT_NAVN=%q\n" 'https://lyngby.badmintonapp.dk/t/abcdEFGH1234_x' 'badminton-tv2' > "$TMP/kiosk.env"

echo "Indsamlingen (fejllog.sh)"

# 1. Det kørende system (FL_ROD tom): journalctl uden --directory
UD=$TMP/saml1
PATH="$TMP/bin:$PATH" bash -c '. "$1/fejllog.sh"; fejllog_saml "$2" "testsystem" badminton-tv2' bash "$LIB" "$UD"
OV=$(cat "$UD/OVERSIGT.txt")
indeholder "oversigt: PC-navnet" "$OV" 'PC-navn: badminton-tv2'
indeholder "oversigt: opstart -1 frøs" "$OV" '*** IKKE LUKKET NED'
indeholder "oversigt: opstart 0 kører nu" "$OV" 'kører nu'
indeholder "oversigt: 'Lige nu' på det kørende system" "$OV" '== Lige nu =='
OPSTARTER=("$UD"/opstart-*)
forvent "en fil pr. opstart" "${#OPSTARTER[@]}" 2
O1=$(cat "$UD"/opstart-001-*.txt)
indeholder "opstart -1: kernebeskeder" "$O1" 'GPU HANG'
indeholder "opstart -1: advarsler" "$O1" 'GPU process hung'
mangler "adgangslinkets kode er fjernet fra URL'en" "$O1" 'abcdEFGH1234_x'
indeholder "… erstattet af <adgangslink>" "$O1" '/t/<adgangslink>?skaerm=tv2'
indeholder "… også i X-Adgangslink" "$O1" 'X-Adgangslink: <adgangslink>'

# 2. En monteret disk (USB-nøglen): FL_ROD med journal og kiosk.conf
PC=$TMP/pc
mkdir -p "$PC/var/log/journal" "$PC/etc/badminton-tv" "$PC/usr/share/badminton-tv"
printf '2026.11.4\n' > "$PC/usr/share/badminton-tv/version"
printf 'TV_URL=https://lyngby.badmintonapp.dk/t/abcdEFGH1234_x\nWIFI_NAVN=Hallen\nWIFI_KODE=hemmelig123\n' > "$PC/etc/badminton-tv/kiosk.conf"
UD=$TMP/saml2
PATH="$TMP/bin:$PATH" FL_ROD=$PC bash -c '. "$1/fejllog.sh"; fejllog_saml "$2" "system A" badminton-tv2' bash "$LIB" "$UD"
OV=$(cat "$UD/OVERSIGT.txt")
indeholder "disk: den installerede version" "$OV" 'Installeret version: 2026.11.4'
mangler "disk: ingen 'Lige nu' (PC'en kører ikke)" "$OV" '== Lige nu =='
mangler "disk: opstart 0 er ikke 'kører nu'" "$OV" 'kører nu'
K=$(cat "$UD/kiosk.conf.txt")
mangler "kiosk.conf: WiFi-koden er fjernet" "$K" 'hemmelig123'
mangler "kiosk.conf: adgangslinkets kode er fjernet" "$K" 'abcdEFGH1234_x'
indeholder "kiosk.conf: WiFi-navnet er med" "$K" 'WIFI_NAVN=Hallen'

echo "Fejllog fra admin (fejllog spoerg)"

# ── Falsk server: /spoerg svarer $TMP/hent, uploadet gemmes i $TMP/modtaget.zip ──
printf 'false' > "$TMP/hent"
cat > "$TMP/server.py" <<'EOF'
import http.server, json, os, sys
ROD = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        data = self.rfile.read(int(self.headers['Content-Length']))
        if self.path.startswith('/api/screens/pc-fejllog/spoerg'):
            with open(os.path.join(ROD, 'spoerg.log'), 'a') as f:
                f.write(json.dumps({'token': self.headers.get('X-Adgangslink'), **json.loads(data)}) + '\n')
            svar = b'{"hent": %s}' % open(os.path.join(ROD, 'hent'), 'rb').read()
        else:
            with open(os.path.join(ROD, 'modtaget.zip'), 'wb') as f:
                f.write(data)
            with open(os.path.join(ROD, 'upload.txt'), 'w') as f:
                f.write(f'{self.path} {self.headers.get("Content-Type")} {self.headers.get("X-Adgangslink")}')
            open(os.path.join(ROD, 'hent'), 'w').write('false')
            svar = b'{"ok": true}'
        self.send_response(200); self.end_headers(); self.wfile.write(svar)
    def log_message(self, *a): pass
s = http.server.HTTPServer(('127.0.0.1', 0), H)
open(os.path.join(ROD, 'port'), 'w').write(str(s.server_port))
s.serve_forever()
EOF
python3 "$TMP/server.py" "$TMP" &
SERVER_PID=$!
for _ in $(seq 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
PORT=$(cat "$TMP/port")

f() { # kommando…
    PATH="$TMP/bin:$PATH" BT_LIB="$LIB" BT_KIOSK_ENV="$TMP/kiosk.env" BT_VERSION_FIL="$TMP/version" \
        BT_FEJLLOG_ARB="$TMP/arb" BT_FEJLLOG_URL="http://127.0.0.1:$PORT/api/screens/pc-fejllog" \
        python3 "$LIB/fejllog" "$@" > "$TMP/ud.log" 2>&1
}

# 3. Intet bedt om: kun et spørgsmål, intet sendt
f spoerg
forvent "spørger med navn, version og adgangslink" \
    "$(python3 -c 'import json,sys; d=json.loads(open(sys.argv[1]).readline()); print(d["navn"], d["kioskVersion"], d["token"])' "$TMP/spoerg.log")" \
    'badminton-tv2 2026.11.5 abcdEFGH1234_x'
forvent "intet bedt om: intet sendt" "$(test -e "$TMP/modtaget.zip" && echo sendt || echo intet)" intet

# 4. Admin har bedt om den: samles, pakkes og sendes
printf 'true' > "$TMP/hent"
: > "$TMP/spoerg.log"
f spoerg
forvent "bedt om: zip sendt" "$(test -s "$TMP/modtaget.zip" && echo sendt || echo intet)" sendt
indeholder "upload: zip med navn og antal opstarter" "$(cat "$TMP/upload.txt")" '/api/screens/pc-fejllog?navn=badminton-tv2&kioskVersion=2026.11.5&opstarter=15 application/zip abcdEFGH1234_x'
indeholder "melder 'samler' undervejs" "$(cat "$TMP/spoerg.log")" '"status": "samler"'
Z=$(python3 - "$TMP/modtaget.zip" <<'EOF'
import sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
navne = sorted(z.namelist())
print(' '.join(n.split('-')[0] if n.startswith('opstart-') else n for n in navne))
ov = z.read('OVERSIGT.txt')
print('crlf' if b'\r\n' in ov and b'\n' not in ov.replace(b'\r\n', b'') else 'lf')
print('kode-fri' if all(b'abcdEFGH1234_x' not in z.read(n) for n in navne) else 'KODE')
EOF
)
indeholder "zip: oversigt og en fil pr. opstart" "$Z" 'OVERSIGT.txt opstart opstart'
indeholder "zip: .txt med CRLF (Notesblok)" "$Z" crlf
indeholder "zip: ingen adgangslink-kode" "$Z" kode-fri
forvent "arbejdsmappen er ryddet" "$(ls -A "$TMP/arb" 2>/dev/null | wc -l | tr -d ' ')" 0

# 5. For stor: færre opstarter, til sidst 'fejl' til serveren
rm -f "$TMP/modtaget.zip"
printf 'true' > "$TMP/hent"
: > "$TMP/spoerg.log"
FAKE_MEGET=200000 BT_FEJLLOG_MAKS=1000 f spoerg
forvent "for stor: intet sendt" "$(test -e "$TMP/modtaget.zip" && echo sendt || echo intet)" intet
indeholder "for stor: prøvede med færre opstarter" "$(cat "$TMP/ud.log")" 'prøver med færre'
indeholder "for stor: 'fejl' meldt til serveren" "$(cat "$TMP/spoerg.log")" '"status": "fejl"'

# 6. Uden net: intet sker, ingen fejl
kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null
f spoerg
forvent "uden net: afslutter stille" "$?" 0

echo
if [ "$FEJL" -gt 0 ]; then
    echo "$FEJL test(s) fejlede"
    exit 1
fi
echo "Alle tests bestået"
