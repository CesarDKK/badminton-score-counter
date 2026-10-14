#!/bin/bash
# Testdata til den automatiske opdatering i den virtuelle PC (vm.sh): et
# USB-billede, der henter fra en lokal "GitHub" i stedet for den rigtige, og
# to nye versioner at opdatere til — én der virker, og én hvor browseren aldrig
# starter (så PC'en skal gå tilbage til den forrige version af sig selv).
#
# USB-billedets system får (kun i testen):
#   - en testnøgle i stedet for Badminton TV's nøgle (opdatering.pub)
#   - KILDE=http://10.0.2.2:8000/releases og korte tider (opdatering.env)
#   - tjek 2 minutter efter opstart og hvert 4. minut (i stedet for 10 min/2 t)
#   - journalen på den serielle port, så forløbet kan følges i vm/serial.log
#   - kiosk.conf med TV_URL=http://10.0.2.2:8000/tv.html — TV-siden viser
#     PC'ens version, og serverloggen viser den i kioskversion=
#
# Forløb (forbered og udgiv i bt-build, resten i bt-vm — begge ser samme mappe):
#
#   bash /src/test/opdatering-vm.sh forbered /ud/badminton-tv-usb-2026.10.20.img 2026.10.21 2026.10.22
#   bash /src/test/opdatering-vm.sh udgiv 2026.10.21
#   bash /src/test/opdatering-vm.sh server
#   bash /src/test/vm.sh start /ud/opd/usb-test.img --secure-boot
#     … installér, fjern-usb, vent til "klar på system b" i serial.log …
#   bash /src/test/vm.sh sluk && bash /src/test/vm.sh genstart-fra-disk
#     … B startes på prøve og godkendes efter 1 minut …
#   bash /src/test/opdatering-vm.sh udgiv 2026.10.22     (den ødelagte)
#     … A startes på prøve, TV-siden kommer aldrig, PC'en genstarter til B …
#   bash /src/test/opdatering-vm.sh log
#
# Mappen er OPD_DIR (standard: /ud/opd). Med KILDE_SRC=/src lægger forbered
# repoets nyeste scripts ind i billedet, så en rettelse kan prøves uden et nyt byg.

set -euo pipefail
OPD=${OPD_DIR:-/ud/opd}
SERVER=$OPD/server
TEST_KILDE=http://10.0.2.2:8000

behoev() {
    local mangler=()
    command -v unsquashfs >/dev/null || mangler+=(squashfs-tools)
    command -v mcopy >/dev/null || mangler+=(mtools)
    command -v jq >/dev/null || mangler+=(jq)
    command -v openssl >/dev/null || mangler+=(openssl)
    if [ "${#mangler[@]}" -gt 0 ]; then
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${mangler[@]}" >/dev/null
    fi
}

forbered() {
    local img=${1:?Angiv USB-billedet} ny=${2:?Angiv den nye version} oedelagt=${3:?Angiv den ødelagte version}
    behoev
    # Arbejdsmappen ligger i containeren: /ud er en Windows-mappe, der ikke
    # skelner mellem store og små bogstaver (firmwarefiler kolliderer).
    local arb=${ARB_DIR:-/var/tmp/opdatering-vm} rod comp
    rod=$arb/rod
    # Kun indholdet: en kørende server holder fast i selve mappen
    rm -rf "$arb" "$SERVER/releases"
    mkdir -p "$arb" "$SERVER/releases/latest/download"
    export MTOOLS_SKIP_CHECK=1

    echo "Pakker systemet ud af $img …"
    mcopy -i "$img@@1M" ::/live/filesystem.squashfs "$arb/grund.squashfs"
    comp=$(unsquashfs -s "$arb/grund.squashfs" | awk '/^Compression/ { print $2; exit }')
    unsquashfs -q -n -d "$rod" "$arb/grund.squashfs"
    rm "$arb/grund.squashfs"

    # KILDE_SRC=/src: læg repoets nyeste scripts, units og GRUB-filer ind, så
    # en rettelse kan prøves uden at bygge billedet forfra (25 minutter).
    if [ -n "${KILDE_SRC:-}" ]; then
        local f=$KILDE_SRC/live/config/includes.chroot_after_packages
        echo "Lægger scripts fra $KILDE_SRC ind …"
        cp -r "$f/usr/lib/badminton-tv/." "$rod/usr/lib/badminton-tv/"
        cp "$f"/usr/lib/systemd/system/badminton-tv* "$rod/usr/lib/systemd/system/"
        cp "$f"/usr/share/badminton-tv/{grub-esp.cfg,grub-slot.cfg,start.html} "$rod/usr/share/badminton-tv/"
        find "$rod/usr/lib/badminton-tv" -type f -exec chmod 755 {} +
        chmod 644 "$rod/usr/lib/badminton-tv/conf.sh" "$rod/usr/lib/badminton-tv/rod.sh" \
                  "$rod"/usr/lib/systemd/system/badminton-tv*
        find "$rod/usr/share/badminton-tv" -type f -exec chmod 644 {} +
    fi

    # Testnøgle i stedet for den rigtige
    [ -f "$OPD/testnoegle.pem" ] || openssl genpkey -algorithm ed25519 -out "$OPD/testnoegle.pem"
    openssl pkey -in "$OPD/testnoegle.pem" -pubout -out "$rod/usr/share/badminton-tv/opdatering.pub"
    mkdir -p "$rod/etc/badminton-tv"
    cat > "$rod/etc/badminton-tv/opdatering.env" <<EOF
KILDE=$TEST_KILDE/releases
SUND_SEK=60
FRIST_SEK=480
EOF
    mkdir -p "$rod/etc/systemd/system/badminton-tv-opdatering.timer.d"
    cat > "$rod/etc/systemd/system/badminton-tv-opdatering.timer.d/test.conf" <<'EOF'
# En tom værdi nulstiller ALLE timerens tidspunkter — derfor kun én gang
[Timer]
OnBootSec=
OnBootSec=2min
OnUnitActiveSec=4min
RandomizedDelaySec=0
EOF
    mkdir -p "$rod/etc/systemd/journald.conf.d"
    cat > "$rod/etc/systemd/journald.conf.d/test-seriel.conf" <<'EOF'
[Journal]
ForwardToConsole=yes
TTYPath=/dev/ttyS0
MaxLevelConsole=info
EOF

    lav() { # fil
        echo "Laver $(basename "$1") ($comp) …"
        mkdir -p "$(dirname "$1")"
        mksquashfs "$rod" "$1" -comp "$comp" -noappend -quiet -no-progress >/dev/null
    }

    # USB-billedet: samme version som før, med testindstillingerne
    lav "$arb/usb.squashfs"
    cp "$img" "$OPD/usb-test.img"
    mcopy -o -i "$OPD/usb-test.img@@1M" "$arb/usb.squashfs" ::/live/filesystem.squashfs
    rm "$arb/usb.squashfs"
    printf 'TV_URL=%s/tv.html\r\nNAVN=vm-test\r\nOPDATERING=foerst\r\n' "$TEST_KILDE" > "$arb/kiosk.conf"
    mcopy -o -i "$OPD/usb-test.img@@1M" "$arb/kiosk.conf" ::/kiosk.conf

    # KUN_USB=1: kun USB-billedet (fx til at prøve TV-siden uden skærm)
    if [ -z "${KUN_USB:-}" ]; then
        # Den nye version
        printf '%s\n' "$ny" > "$rod/usr/share/badminton-tv/version"
        lav "$SERVER/releases/download/tv-usb-v$ny/badminton-tv-rod-$ny.squashfs"

        # Den ødelagte: browseren stopper med det samme, TV-siden kommer aldrig
        printf '%s\n' "$oedelagt" > "$rod/usr/share/badminton-tv/version"
        printf '#!/bin/sh\necho "Testversion: browseren starter ikke" >&2\nexit 1\n' > "$rod/usr/lib/badminton-tv/browser"
        lav "$SERVER/releases/download/tv-usb-v$oedelagt/badminton-tv-rod-$oedelagt.squashfs"
    fi
    rm -rf "$rod"

    cat > "$SERVER/tv.html" <<'EOF'
<!doctype html><meta charset="utf-8"><title>TV-test</title>
<body style="background:#123;color:#fff;font:48px sans-serif;padding:60px">
<p>Testens TV-side</p><p id="v"></p>
<script>
  const p = new URLSearchParams(location.search);
  document.getElementById('v').textContent = 'Badminton TV ' + (p.get('kioskversion') || '?');
  // Vinduets størrelse og synlighed i serverloggen (GET /status?…): 1920x1080
  // = på den rigtige skærm, 1280x720 = på den virtuelle (TV'et slukket)
  const meld = () => fetch('/status?vis=' + document.visibilityState + '&w=' + innerWidth + '&h=' + innerHeight).catch(() => {});
  meld(); setInterval(meld, 5000);
</script>
EOF
    echo "Klar: $OPD/usb-test.img og $SERVER"
}

udgiv() {
    local v=${1:?Angiv versionen} fil
    behoev
    fil=$SERVER/releases/download/tv-usb-v$v/badminton-tv-rod-$v.squashfs
    [ -f "$fil" ] || { echo "$fil findes ikke — kør forbered" >&2; exit 1; }
    jq -n --arg version "$v" --arg fil "$(basename "$fil")" \
          --arg sha256 "$(sha256sum "$fil" | cut -d' ' -f1)" \
          --argjson bytes "$(stat -c %s "$fil")" --argjson udgivet "$(date +%s)" \
          '{version: $version, udgivet: $udgivet, vent_timer: 0,
            rod: {fil: $fil, sha256: $sha256, bytes: $bytes}}' \
        > "$SERVER/releases/latest/download/opdatering.json"
    openssl pkeyutl -sign -inkey "$OPD/testnoegle.pem" -rawin \
        -in "$SERVER/releases/latest/download/opdatering.json" \
        -out "$SERVER/releases/latest/download/opdatering.json.sig"
    echo "Udgivet: $v"
}

server() {
    pkill -f 'http.server 8000' 2>/dev/null || true
    (cd "$SERVER" && nohup python3 -m http.server 8000 > "$OPD/server.log" 2>&1 &)
    sleep 1
    echo "Server på port 8000 (log: $OPD/server.log)"
}

# Hvad den virtuelle PC har gjort: versionerne, der har vist TV-siden, hentninger
# og opdateringens egne linjer i journalen.
log() {
    echo "== TV-siden (serverens log) =="
    grep -o 'GET /tv.html[^ ]*\|GET /releases/[^ ]*' "$OPD/server.log" 2>/dev/null \
        | sed 's/?.*kioskversion=\([^& ]*\).*/  version \1/' | uniq -c || true
    echo "== Journalen (vm/serial.log) =="
    tr -d '\r' < "${VM_DIR:-/ud/vm}/serial.log" 2>/dev/null \
        | grep -aE 'opdatering\[|Kernel command line|Godkend|badminton-tv-opdatering' | tail -40 || true
}

case "${1:-}" in
    forbered) shift; forbered "$@" ;;
    udgiv)    udgiv "${2:-}" ;;
    server)   server ;;
    log)      log ;;
    *) sed -n '2,30p' "$0"; exit 1 ;;
esac
