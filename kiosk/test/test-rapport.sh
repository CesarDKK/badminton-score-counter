#!/bin/bash
# Test af rapporten til serveren (usr/lib/badminton-tv/rapport): hvordan forrige
# kørsel sluttede, køen og afsendelsen. Kører uden systemd: journalctl og
# systemctl er falske, og "serveren" er en lille Python-server på localhost.
#
#   bash kiosk/test/test-rapport.sh

set -u
cd "$(dirname "$0")/.." || exit 1
RAPPORT=$PWD/live/config/includes.chroot_after_packages/usr/lib/badminton-tv/rapport
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

# ── Falske værktøjer ───────────────────────────────────────
mkdir -p "$TMP/bin" "$TMP/run" "$TMP/pstore" "$TMP/var"
cat > "$TMP/bin/journalctl" <<'EOF'
#!/bin/bash
# -g 'Power key': $FAKE_POWERKEY. -o json -n 1: forrige opstarts sidste post.
# Ellers en linje, der viser hvad der blev spurgt om.
# Som den rigtige: -b tager boot-id'et uden bindestreger (set i VM-testen)
args=("$@")
for i in "${!args[@]}"; do
    if [ "${args[$i]}" = -b ] && [[ "${args[$((i + 1))]:-}" == *-* ]] && [[ "${args[$((i + 1))]}" != -* ]]; then
        echo "Failed to add match '${args[$((i + 1))]}': Invalid argument" >&2
        exit 1
    fi
done
case " $* " in
    *" -g "*) printf '%s' "${FAKE_POWERKEY:-}" ;;
    *" -o json "*) [ -n "${FAKE_SLUT_US:-}" ] && printf '{"__REALTIME_TIMESTAMP":"%s"}\n' "$FAKE_SLUT_US" ;;
    *) [ -n "${FAKE_JOURNAL:-}" ] && printf '%s (%s)\n' "$FAKE_JOURNAL" "$*" ;;
esac
exit 0
EOF
cat > "$TMP/bin/systemctl" <<'EOF'
#!/bin/bash
printf '%s\n' "${FAKE_JOBS:-}"
EOF
chmod +x "$TMP/bin/"*
printf '2026.10.25\n' > "$TMP/version"
printf "BT_TV_URL=%q\nBT_NAVN=%q\n" 'https://lyngby.badmintonapp.dk/t/abcdEFGH1234_x' 'tv-bane-3' > "$TMP/kiosk.env"

# ── Falsk server: gemmer hvert POST i $TMP/modtaget/, svarer $TMP/svar ─────
mkdir -p "$TMP/modtaget"
echo 200 > "$TMP/svar"
cat > "$TMP/server.py" <<'EOF'
import http.server, json, os, sys, time
ROD = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        data = self.rfile.read(int(self.headers['Content-Length']))
        kode = int(open(os.path.join(ROD, 'svar')).read())
        if kode == 200:
            with open(os.path.join(ROD, 'modtaget', f'{time.time_ns()}.json'), 'w') as f:
                json.dump({'sti': self.path, 'token': self.headers.get('X-Adgangslink'),
                           'data': json.loads(data)}, f, ensure_ascii=False)
        self.send_response(kode); self.end_headers(); self.wfile.write(b'{}')
    def log_message(self, *a): pass
s = http.server.HTTPServer(('127.0.0.1', 0), H)
open(os.path.join(ROD, 'port'), 'w').write(str(s.server_port))
s.serve_forever()
EOF
python3 "$TMP/server.py" "$TMP" &
SERVER_PID=$!
for _ in $(seq 50); do [ -s "$TMP/port" ] && break; sleep 0.1; done
PORT=$(cat "$TMP/port")

BOOT=boot-1
UPTIME=60
r() { # kommando…
    printf '%s\n' "$BOOT" > "$TMP/boot_id"
    printf '%s 0\n' "$UPTIME" > "$TMP/uptime"
    PATH="$TMP/bin:$PATH" BT_RAPPORT_MAPPE="$TMP/var" BT_KIOSK_ENV="$TMP/kiosk.env" \
        BT_NEDLUKNING="$TMP/run/nedlukning" BT_PSTORE="$TMP/pstore" BT_VERSION_FIL="$TMP/version" \
        BT_BOOT_ID="$TMP/boot_id" BT_UPTIME="$TMP/uptime" \
        BT_RAPPORT_URL="http://127.0.0.1:$PORT/api/screens/pc-rapport" \
        python3 "$RAPPORT" "$@" > "$TMP/ud.log" 2>&1
}
koe() { find "$TMP/var/rapporter" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
koe_typer() { cat "$TMP/var/rapporter/"*.json 2>/dev/null | python3 -c 'import sys,json; print(" ".join(json.loads(l)["type"] for l in sys.stdin.read().replace("}{","}\n{").splitlines()))'; }
ny_opstart() { BOOT=$1; r opstart; }
modtaget() { cat "$TMP/modtaget/"*.json 2>/dev/null; }
ryd_modtaget() { rm -f "$TMP/modtaget/"*.json; }

echo "Rapport om forrige kørsel"

# 1. Første opstart med rapporteringen: kun fremtidige hændelser
mkdir -p "$TMP/pstore/gammelt-dump"; echo 'Kernel panic - not syncing: gammel' > "$TMP/pstore/gammelt-dump/dmesg.txt"
ny_opstart boot-1
forvent "første opstart: intet meldes" "$(koe)" 0
indeholder "første opstart: koersel.json skrevet" "$(cat "$TMP/var/koersel.json")" '"boot_id": "boot-1"'

# 2. Planlagt slukning kl. 23:59 → intet meldes
echo sluk > "$TMP/run/nedlukning"
r stop
indeholder "stop: hvordan = sluk" "$(cat "$TMP/var/koersel.json")" '"hvordan": "sluk"'
ny_opstart boot-2
forvent "efter slukning kl. SLUK_KL: intet meldes" "$(koe)" 0
forvent "nedlukningsfilen er ryddet" "$(test -e "$TMP/run/nedlukning" && echo findes || echo væk)" væk

# 3. Slukket på tænd/sluk-knappen → pc-knap
FAKE_POWERKEY='Power key pressed short.' r stop
ny_opstart boot-3
forvent "tænd/sluk-knappen: pc-knap" "$(koe_typer)" pc-knap
rm -rf "$TMP/var/rapporter"

# 4. Genstartet på anden vis → pc-genstart
FAKE_JOBS='12 reboot.target start waiting' r stop
ny_opstart boot-4
forvent "genstart: pc-genstart" "$(koe_typer)" pc-genstart
rm -rf "$TMP/var/rapporter"

# 5. Stoppede brat (ingen stop) → pc-brat med journalens slutning og tidspunkt
SLUT_MS=$(( $(date +%s) * 1000 + 5000 ))   # journalen slutter efter "sidst i live"
FAKE_JOURNAL='EXT4-fs warning: noget' FAKE_SLUT_US=$(( SLUT_MS * 1000 )) ny_opstart boot-5
forvent "brat stop: pc-brat" "$(koe_typer)" pc-brat
H=$(cat "$TMP/var/rapporter/"*.json)
indeholder "brat stop: journalens slutning med" "$H" 'EXT4-fs warning: noget'
indeholder "brat stop: forrige opstart spurgt (uden bindestreger)" "$H" '-b boot4'
indeholder "brat stop: tidspunkt fra journalen" "$H" "\"fra\": $SLUT_MS"
rm -rf "$TMP/var/rapporter"

# 6. Kernenedbrud med et nyt dump i pstore → pc-panik (det gamle dump fra før tæller ikke)
mkdir -p "$TMP/pstore/12345/001"   # som systemd-pstore: <tid>/001/…
printf '%s\n' '<0>[  287.3] browservagt: disken er død (kan ikke læse /usr/share/badminton-tv/version: Input/output error) — udløser kernepanik' \
              '<0>[  287.4] Kernel panic - not syncing: sysrq triggered crash' > "$TMP/pstore/12345/001/dmesg.txt"
ny_opstart boot-6
forvent "kernenedbrud: pc-panik" "$(koe_typer)" pc-panik
H=$(cat "$TMP/var/rapporter/"*.json)
indeholder "kernenedbrud: disken nævnt" "$H" 'disken holdt op med at svare'
indeholder "kernenedbrud: panik-linjen med" "$H" 'Kernel panic - not syncing: sysrq'
r stop   # (FAKE_JOBS tom, ingen knap → 'slukket')
ny_opstart boot-7
forvent "samme dump meldes ikke igen" "$(koe_typer)" "pc-panik pc-genstart"

# 7. Samme opstart igen (servicen genstartet) → intet nyt
ny_opstart boot-7
forvent "samme opstart to gange: intet nyt" "$(koe)" 2

# 8. Net-vagten: "koe" lægger en hændelse i køen med WiFi-loggen, uden at sende
FRA=$(( $(date +%s) * 1000 - 300000 ))
FAKE_JOURNAL='NetworkManager: wlp0s20f3: link disconnected' r koe net-genstart 'Ingen WiFi i 3 min' "$FRA" "$(( FRA + 200000 ))"
forvent "koe: lagt i køen (ikke sendt)" "$(koe_typer)" "pc-panik pc-genstart net-genstart"
H=$(cat "$TMP/var/rapporter/"*net-genstart.json)
indeholder "koe: WiFi-loggen med" "$H" 'link disconnected'
indeholder "koe: NetworkManager spurgt fra 2 min før" "$H" "--since @$(( FRA / 1000 - 120 ))"
indeholder "koe: tidspunktet" "$H" "\"fra\": $FRA"
# … og net-vagtens genstart meldes ikke igen ved næste opstart
echo netvagt > "$TMP/run/nedlukning"
r stop
ny_opstart boot-8
forvent "net-vagtens genstart: ikke meldt igen ved opstart" "$(koe)" 3

echo "Afsendelse"
r send
forvent "send: køen er tom" "$(koe)" 0
M=$(modtaget)
indeholder "send: adgangslinkets token" "$M" '"token": "abcdEFGH1234_x"'
indeholder "send: skærmens navn" "$M" '"navn": "tv-bane-3"'
indeholder "send: versionen" "$M" '"kioskVersion": "2026.10.25"'
indeholder "send: alle hændelser" "$M" '"type": "net-genstart"'
ryd_modtaget

echo 500 > "$TMP/svar"
r meld browser-genstart 'TV-sidens hjerteslag har stået stille i 45 s'
forvent "serveren nede (500): hændelsen bliver i køen" "$(koe)" 1
echo 200 > "$TMP/svar"
r send
forvent "serveren oppe igen: sendt" "$(koe)" 0
indeholder "meld: browser-genstart med årsag" "$(modtaget)" 'hjerteslag har stået stille i 45 s'
ryd_modtaget

echo 403 > "$TMP/svar"
r meld browser-genstart 'test'
forvent "afvist (403, fx tilbagekaldt link): smides ud" "$(koe)" 0
echo 200 > "$TMP/svar"

printf "BT_TV_URL=%q\nBT_NAVN=%q\n" 'https://lyngby.badmintonapp.dk/tv-v3.html?court=3' 'tv-bane-3' > "$TMP/kiosk.env"
r meld browser-genstart 'test'
forvent "TV_URL uden adgangslink: bliver i køen" "$(koe)" 1
indeholder "TV_URL uden adgangslink: forklaring i loggen" "$(cat "$TMP/ud.log")" 'ikke et adgangslink'

# Store logs: højst ~80 KB pr. forespørgsel (serverens loft er 100 KB)
printf "BT_TV_URL=%q\nBT_NAVN=%q\n" 'https://lyngby.badmintonapp.dk/t/abcdEFGH1234_x' 'tv-bane-3' > "$TMP/kiosk.env"
rm -rf "$TMP/var/rapporter"; mkdir -p "$TMP/var/rapporter"; ryd_modtaget
for i in 1 2 3; do
    python3 -c "import json,sys; json.dump({'type':'pc-brat','fra':$(date +%s)000,'tekst':'stor','log':'x'*30000}, open(sys.argv[1],'w'))" \
        "$TMP/var/rapporter/100$i-stor.json"
done
r send
forvent "store logs: alle sendt" "$(koe)" 0
forvent "store logs: delt i 2 forespørgsler (2 + 1)" "$(find "$TMP/modtaget" -name '*.json' | wc -l | tr -d ' ')" 2

echo
if [ "$FEJL" -eq 0 ]; then echo "Alle tests bestået."; else echo "$FEJL test(s) fejlede."; exit 1; fi
