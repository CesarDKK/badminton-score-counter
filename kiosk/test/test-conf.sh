#!/bin/bash
# Tester læsningen af kiosk.conf med de filer Notesblok faktisk laver:
# CRLF, BOM, ANSI (cp1252), UTF-16 og værdier med & og $.
#
#   bash kiosk/test/test-conf.sh

set -u
HER=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=../live/config/includes.chroot_after_packages/usr/lib/badminton-tv/conf.sh
. "$HER/../live/config/includes.chroot_after_packages/usr/lib/badminton-tv/conf.sh"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ok=0 fejl=0

forvent() { # navn faktisk forventet
    if [ "$2" = "$3" ]; then
        ok=$((ok + 1))
    else
        fejl=$((fejl + 1))
        printf 'FEJL  %s\n      fik:      [%s]\n      forventet:[%s]\n' "$1" "$2" "$3"
    fi
}

# 1. Notesblok med CRLF og BOM, URL med & og $
printf '\xEF\xBB\xBF# kommentar\r\nTV_URL = https://lyngby.badmintonapp.dk/tv-v3.html?id=1&qr=0&x=$HOME\r\nNAVN=TV Bane 1 Øst\r\nSLUK_KL=23.59\r\n' > "$TMP/crlf.conf"
bt_read_conf "$TMP/crlf.conf"
forvent "CRLF+BOM: URL med & og \$" "$BT_TV_URL" 'https://lyngby.badmintonapp.dk/tv-v3.html?id=1&qr=0&x=$HOME'
forvent "CRLF+BOM: navn normaliseret" "$BT_NAVN" "tv-bane-1-oest"
forvent "CRLF+BOM: 23.59 → 23:59" "$BT_SLUK_KL" "23:59"
forvent "CRLF+BOM: ingen fejl" "$BT_FEJL" ""

# 2. ANSI (cp1252) med æøå i WiFi-navnet
printf 'TV_URL=http://192.168.1.50:8080/t/abc\nWIFI_NAVN=Hal \xe6\xf8\xe5\nWIFI_KODE=hemmelig123\n' > "$TMP/ansi.conf"
bt_read_conf "$TMP/ansi.conf"
forvent "ANSI: æøå konverteres til UTF-8" "$BT_WIFI_NAVN" "Hal æøå"
forvent "ANSI: kode" "$BT_WIFI_KODE" "hemmelig123"

# 3. UTF-16 (Notesblok "Unicode")
printf 'TV_URL=https://a.dk/x\r\nWIFI_NAVN=Hallen\r\n' | iconv -f UTF-8 -t UTF-16 > "$TMP/utf16.conf"
bt_read_conf "$TMP/utf16.conf"
forvent "UTF-16: URL" "$BT_TV_URL" "https://a.dk/x"
forvent "UTF-16: WiFi" "$BT_WIFI_NAVN" "Hallen"

# 4. Anførselstegn bevarer mellemrum i koden; # midt i en værdi er ikke en kommentar
printf 'TV_URL=https://a.dk/side#bane-2\nWIFI_NAVN=Hal\nWIFI_KODE=" med mellemrum "\n' > "$TMP/quotes.conf"
bt_read_conf "$TMP/quotes.conf"
forvent "Anførselstegn: mellemrum bevares" "$BT_WIFI_KODE" " med mellemrum "
forvent "# i URL bevares" "$BT_TV_URL" "https://a.dk/side#bane-2"

# 5. Fejl: manglende URL, for kort WiFi-kode
printf 'WIFI_NAVN=Hal\nWIFI_KODE=kort\n' > "$TMP/fejl.conf"
bt_read_conf "$TMP/fejl.conf"
forvent "Fejl: to fejl rapporteres" "$(printf '%s\n' "$BT_FEJL" | wc -l | tr -d ' ')" "2"

# 6. Forkert URL
printf 'TV_URL=lyngby.badmintonapp.dk\n' > "$TMP/url.conf"
bt_read_conf "$TMP/url.conf"
forvent "Fejl: URL uden http" "${BT_FEJL:+ja}" "ja"

# 7. Standardværdier og ukendt nøgle
printf 'TV_URL=https://a.dk/\nTV-URL=stavefejl\n' > "$TMP/std.conf"
bt_read_conf "$TMP/std.conf"
forvent "Standard: navn" "$BT_NAVN" "badminton-tv"
forvent "Standard: sluk" "$BT_SLUK_KL" "23:59"
forvent "Standard: cec" "$BT_CEC" "auto"
forvent "Standard: skalering" "$BT_SKALERING" "auto"
forvent "Ukendt nøgle giver advarsel" "${BT_ADVARSLER:+ja}" "ja"

# 8. SLUK_KL varianter
for par in "aldrig aldrig" "Nej aldrig" "7.05 07:05" "0:00 00:00" "25:00 23:59"; do
    ind=${par% *}; ud=${par#* }
    printf 'TV_URL=https://a.dk/\nSLUK_KL=%s\n' "$ind" > "$TMP/sluk.conf"
    bt_read_conf "$TMP/sluk.conf"
    forvent "SLUK_KL=$ind" "$BT_SLUK_KL" "$ud"
done

# 9. Skalering med komma
printf 'TV_URL=https://a.dk/\nSKALERING=1,5\n' > "$TMP/skala.conf"
bt_read_conf "$TMP/skala.conf"
forvent "SKALERING=1,5" "$BT_SKALERING" "1.5"

# 10. Sidste linje uden linjeskift
printf 'NAVN=x\nTV_URL=https://a.dk/sidst' > "$TMP/eof.conf"
bt_read_conf "$TMP/eof.conf"
forvent "Sidste linje uden linjeskift" "$BT_TV_URL" "https://a.dk/sidst"

echo "$ok bestået, $fejl fejlet"
[ "$fejl" -eq 0 ]
