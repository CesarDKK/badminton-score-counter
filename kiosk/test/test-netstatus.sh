#!/bin/bash
# Tester netstatus' vurdering af netværket med falske svar fra nmcli,
# journalctl og rfkill — så "forkert kode", "netværket kan ikke ses" osv. kan
# afprøves uden et rigtigt WiFi-kort.
#
#   bash kiosk/test/test-netstatus.sh

set -u
HER=$(cd "$(dirname "$0")" && pwd)
LIB=$HER/../live/config/includes.chroot_after_packages/usr/lib/badminton-tv

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/run"

# Falske kommandoer: svarer ud fra FAKE_*-variabler.
cat > "$TMP/bin/nmcli" <<'EOF'
#!/bin/bash
case "$*" in
    "-t -f TYPE,STATE device")   printf '%s' "${FAKE_TYPE_STATE:-}" ;;
    "-t -f DEVICE,TYPE device")  printf '%s' "${FAKE_DEVICE_TYPE:-}" ;;
    "-t -e no -m multiline -f SSID,SECURITY,SIGNAL device wifi list --rescan no") printf '%s' "${FAKE_SCAN:-}" ;;
    "-t -f GENERAL.STATE device show "*) printf 'GENERAL.STATE:%s\n' "${FAKE_STATE:-30 (disconnected)}" ;;
    "-t -f IN-USE,SIGNAL device wifi list --rescan no") printf '*:72\n' ;;
esac
EOF
cat > "$TMP/bin/journalctl" <<'EOF'
#!/bin/bash
printf '%s' "${FAKE_JOURNAL:-}"
EOF
cat > "$TMP/bin/rfkill" <<'EOF'
#!/bin/bash
printf '%s' "${FAKE_RFKILL:-0: phy0: Wireless LAN
	Soft blocked: no
	Hard blocked: no
}"
EOF
chmod +x "$TMP/bin/"*

export PATH="$TMP/bin:$PATH" BT_LIB="$LIB" BT_RUN="$TMP/run"
export BT_CONF_INSTALLERET="$TMP/kiosk.conf" BT_CONF_USB="$TMP/ingen.conf" BT_CONF_PI="$TMP/ingen-pi.conf"

# Tomme værdier betyder "brug standardsvaret" i de falske kommandoer.
export FAKE_TYPE_STATE="" FAKE_DEVICE_TYPE="" FAKE_SCAN="" FAKE_STATE="" FAKE_JOURNAL="" FAKE_RFKILL=""

ok=0 fejl=0
scenarie() { # navn forventet-niveau forventet-tekst-del
    local ud
    ud=$(bash "$LIB/netstatus" tekst)
    if [[ "$ud" == *"($2)"* && "$ud" == *"$3"* ]]; then
        ok=$((ok + 1))
    else
        fejl=$((fejl + 1))
        printf 'FEJL  %s\n      forventet (%s) med "%s"\n      fik: %s\n' "$1" "$2" "$3" "$ud"
    fi
    FAKE_TYPE_STATE='' FAKE_DEVICE_TYPE='' FAKE_SCAN='' FAKE_STATE='' FAKE_JOURNAL='' FAKE_RFKILL=''
}

scan() { # "ssid|sikkerhed|signal" ...
    local s
    for s in "$@"; do
        IFS='|' read -r ssid sik sig <<<"$s"
        printf 'SSID:%s\nSECURITY:%s\nSIGNAL:%s\n' "$ssid" "$sik" "$sig"
    done
}

WIFI_CONF='TV_URL=https://a.dk/
WIFI_NAVN=Hallen
WIFI_KODE=min kode 123'

# Kabel, ingen WiFi sat op
printf 'TV_URL=https://a.dk/\n' > "$TMP/kiosk.conf"
FAKE_TYPE_STATE='ethernet:connected
loopback:connected (externally)'
scenarie "Kabel uden WiFi" ok "netværkskabel"

printf 'TV_URL=https://a.dk/\n' > "$TMP/kiosk.conf"
FAKE_TYPE_STATE='ethernet:unavailable'
scenarie "Hverken kabel eller WiFi" fejl "ikke sat op"

printf '%s\n' "$WIFI_CONF" > "$TMP/kiosk.conf"

# Intet WiFi-kort
FAKE_TYPE_STATE='ethernet:unavailable' FAKE_DEVICE_TYPE='enp0s31f6:ethernet'
scenarie "Intet WiFi-kort" fejl "intet WiFi-kort"

FAKE_TYPE_STATE='ethernet:connected' FAKE_DEVICE_TYPE='enp0s31f6:ethernet'
scenarie "Intet WiFi-kort, men kabel" advarsel "Bruger netværkskablet"

# Kortet findes, men driveren kunne ikke starte det (M920x efter Windows)
SONDE='iwlwifi 0000:02:00.0: probe with driver iwlwifi failed with error -110'
FAKE_TYPE_STATE='ethernet:unavailable' FAKE_DEVICE_TYPE='eno1:ethernet' FAKE_JOURNAL="$SONDE"
scenarie "WiFi-kort svarer ikke" fejl "træk strømstikket ud"

FAKE_TYPE_STATE='ethernet:connected' FAKE_DEVICE_TYPE='eno1:ethernet' FAKE_JOURNAL="$SONDE"
scenarie "WiFi-kort svarer ikke, men kabel" advarsel "træk strømstikket ud"

# Kort findes
KORT='enp0s31f6:ethernet
wlp0s20f3:wifi'

FAKE_DEVICE_TYPE="$KORT" FAKE_RFKILL='0: phy0: Wireless LAN
	Soft blocked: yes
	Hard blocked: no'
scenarie "WiFi slået fra i softwaren (Raspberry Pi OS)" fejl "slået fra i systemet"

FAKE_DEVICE_TYPE="$KORT" FAKE_RFKILL='0: phy0: Wireless LAN
	Soft blocked: no
	Hard blocked: yes'
scenarie "WiFi slået fra med kontakt" fejl "kontakt eller i BIOS"

FAKE_DEVICE_TYPE="$KORT" FAKE_STATE='100 (connected)' FAKE_SCAN="$(scan 'Hallen|WPA2|72')"
scenarie "Forbundet" ok "Forbundet til WiFi \"Hallen\" (signal 72 %)"

FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'Hallen|WPA2|72')" \
    FAKE_JOURNAL='wlp0s20f3: CTRL-EVENT-SSID-TEMP-DISABLED id=0 ssid="Hallen" auth_failures=1 duration=10 reason=WRONG_KEY'
scenarie "Forkert kode (wpa_supplicant)" fejl "Forkert WiFi-kode"

FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'Hallen|WPA2|72')" \
    FAKE_JOURNAL="device (wlp0s20f3): state change: need-auth -> failed (reason 'no-secrets', managed-type: 'full')"
scenarie "Forkert kode (NetworkManager)" fejl "Forkert WiFi-kode"

FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'Naboen|WPA2|80' 'Gæster|WPA2 WPA3|40')"
scenarie "Netværket kan ikke ses" fejl "Synlige netværk: Naboen (WPA2, 80 %), Gæster (WPA2 WPA3, 40 %)"

FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'HALLEN|WPA2|80')"
scenarie "Forkerte store/små bogstaver" fejl "\"HALLEN\" findes"

FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'Hallen|WPA2 802.1X|80')"
scenarie "WPA-Enterprise" fejl "WPA-Enterprise"

FAKE_DEVICE_TYPE="$KORT" FAKE_STATE='50 (connecting (configuring))' FAKE_SCAN="$(scan 'Hallen|WPA2|80')"
scenarie "Forbinder" advarsel "Forbinder til WiFi"

FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'Hallen|WPA3|80')" \
    FAKE_JOURNAL="device (wlp0s20f3): state change: config -> failed (reason 'supplicant-timeout', managed-type: 'full')"
scenarie "Ikke forbundet, årsag fra loggen" advarsel "reason 'supplicant-timeout'"

printf 'TV_URL=https://a.dk/\nWIFI_NAVN=Hallen\n' > "$TMP/kiosk.conf"
FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'Hallen|WPA2|80')"
scenarie "Kode mangler" fejl "WIFI_KODE er tom"

# status.js er gyldig JavaScript med en JSON-værdi
printf '%s\n' "$WIFI_CONF" > "$TMP/kiosk.conf"
FAKE_DEVICE_TYPE="$KORT" FAKE_SCAN="$(scan 'Ha"llen|WPA2|80')"
# netstatus kører i en løkke; vent på den første statusfil (op til 15 s — en
# travl CI-runner nåede det ikke på 2 s) og stop den så.
bash "$LIB/netstatus" >/dev/null 2>&1 &
NS=$!
for _ in $(seq 150); do [ -s "$TMP/run/status.js" ] && break; sleep 0.1; done
kill "$NS" 2>/dev/null; wait "$NS" 2>/dev/null
if sed 's/^window.BT_STATUS = //; s/;$//' "$TMP/run/status.js" | jq -e '.niveau and .tekst and (.t | type == "number")' >/dev/null; then
    ok=$((ok + 1))
else
    fejl=$((fejl + 1)); printf 'FEJL  status.js er ikke gyldig: %s\n' "$(cat "$TMP/run/status.js" 2>/dev/null)"
fi

echo "$ok bestået, $fejl fejlet"
[ "$fejl" -eq 0 ]
