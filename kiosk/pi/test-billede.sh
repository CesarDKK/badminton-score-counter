#!/bin/bash
# Tjekker et færdigt Raspberry Pi-billede uden en rigtig Pi: monterer det og
# kontrollerer pakker, bruger, services, opstartsindstillinger og kiosk.conf,
# og kører setup og slukke-generatoren inde i billedet (chroot).
#
# Køres som root i en privilegeret container (som build-pi.sh):
#
#   docker run --rm --privileged -v "$PWD/kiosk:/src" -v "$PWD/kiosk/ud:/ud" \
#       debian:trixie bash /src/pi/test-billede.sh /ud/badminton-tv-pi-<version>.img.xz
#
# Rører ikke selve filen — der arbejdes på en udpakket kopi.

set -uo pipefail
FIL=${1:?Angiv billedet (.img.xz)}
ARB=$(mktemp -d /var/tmp/test-billede.XXXXXX)
IMG=$ARB/test.img
R=$ARB/rod
LOOPS=()

oprydning() {
    umount -R "$R" 2>/dev/null
    for l in "${LOOPS[@]}"; do losetup -d "$l" 2>/dev/null; done
    rm -rf "$ARB"
}
trap oprydning EXIT

command -v xz >/dev/null || { apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xz-utils fdisk >/dev/null; }

xz -T0 -dc "$FIL" > "$IMG"
part() { sfdisk -d "$IMG" | awk -v p="${IMG}$1" -F'[=,]' '$1 ~ p" " { gsub(/ /, "", $2); gsub(/ /, "", $4); print $2, $4 }'; }
# Sætter variablen $1 — kaldes ikke som $(...), så LOOPS+= overlever og
# enhederne frigives igen.
loop() { local l; l=$(losetup -f --show -o $(($2 * 512)) --sizelimit $(($3 * 512)) "$IMG"); LOOPS+=("$l"); printf -v "$1" '%s' "$l"; }
read -r BS BZ < <(part 1)
read -r RS RZ < <(part 2)
mkdir -p "$R"
loop LOOP_ROD "$RS" "$RZ"
loop LOOP_BOOT "$BS" "$BZ"
mount "$LOOP_ROD" "$R"
mount "$LOOP_BOOT" "$R/boot/firmware"
for d in dev proc sys; do mount --bind "/$d" "$R/$d"; done
mount -t tmpfs tmpfs "$R/run"

ok=0 fejl=0
tjek() { # beskrivelse kommando…
    local navn=$1; shift
    if "$@" >/dev/null 2>&1; then
        ok=$((ok + 1))
    else
        fejl=$((fejl + 1))
        printf 'FEJL  %s\n' "$navn"
    fi
}
symlink_til() { [ "$(readlink "$1")" = "$2" ]; }
aktiveret() { [ -L "$R/etc/systemd/system/$1.wants/$2" ]; }
maskeret() { symlink_til "$R/etc/systemd/system/$1" /dev/null; }

# Programmer
for p in /usr/bin/chromium /usr/bin/cage /usr/bin/wlr-randr /usr/bin/wlrctl /usr/bin/jq \
         /usr/bin/cec-ctl /usr/bin/nmcli /usr/sbin/rfkill /usr/sbin/iw /usr/bin/lspci; do
    tjek "findes: $p" test -x "$R$p"
done
# Absolut symlink via /etc/alternatives — kan kun følges inde fra billedet.
tjek "wireless-regdb (regulatory.db)" chroot "$R" test -e /usr/lib/firmware/regulatory.db

# Bruger
tjek "bruger tv findes" grep -q '^tv:' "$R/etc/passwd"
for g in video render input; do
    tjek "tv er i gruppen $g" grep -qE "^$g:.*[:,]tv(,|$)" "$R/etc/group"
done

# Vores filer
for s in setup browser cec sluk netstatus diagnose; do
    tjek "kørbar: $s" test -x "$R/usr/lib/badminton-tv/$s"
done
tjek "generator kørbar" test -x "$R/usr/lib/systemd/system-generators/badminton-tv-sluk-generator"
tjek "installeren er ikke med" test ! -e "$R/usr/lib/badminton-tv/installer"
tjek "installer-service er ikke med" test ! -e "$R/usr/lib/systemd/system/badminton-tv-installer.service"
tjek "version skrevet" test -s "$R/usr/share/badminton-tv/version"
tjek "diagnose kører på Pi (drop-in)" test -f "$R/etc/systemd/system/badminton-tv-diagnose.service.d/pi.conf"

# Services
tjek "aktiv: badminton-tv-setup" aktiveret sysinit.target badminton-tv-setup.service
for s in badminton-tv badminton-tv-cec badminton-tv-netstatus badminton-tv-diagnose NetworkManager; do
    tjek "aktiv: $s" aktiveret multi-user.target "$s.service"
done
for u in userconfig.service systemd-firstboot.service sleep.target suspend.target \
         hibernate.target apt-daily.timer apt-daily-upgrade.timer; do
    tjek "maskeret: $u" maskeret "$u"
done
tjek "cloud-init slået fra" test -e "$R/etc/cloud/cloud-init.disabled"
tjek "standardmål multi-user" symlink_til "$R/etc/systemd/system/default.target" /usr/lib/systemd/system/multi-user.target
tjek "tidszone København" symlink_til "$R/etc/localtime" /usr/share/zoneinfo/Europe/Copenhagen

# Opstart
CMD=$R/boot/firmware/cmdline.txt
tjek "cmdline.txt er én linje" test "$(wc -l < "$CMD")" -le 1
for p in 'cfg80211.ieee80211_regdom=DK' 'video=HDMI-A-1:1920x1080@60' 'video=HDMI-A-2:1920x1080@60' \
         'consoleblank=0' 'resize' 'root=PARTUUID='; do
    tjek "cmdline: $p" grep -q -- "$p" "$CMD"
done
tjek "kerne til Pi 3/4 (kernel8.img)" test -f "$R/boot/firmware/kernel8.img"
tjek "kerne til Pi 5 (kernel_2712.img)" test -f "$R/boot/firmware/kernel_2712.img"
tjek "cloud-init-filer fjernet" test ! -e "$R/boot/firmware/network-config"
tjek "FAT-partition kun for root" grep -qE '/boot/firmware\s+vfat\s+\S*fmask=0077' "$R/etc/fstab"

# kiosk.conf på SD-kortet: UTF-8 med BOM og CRLF, så den kan rettes i Notesblok
KC=$R/boot/firmware/kiosk.conf
tjek "kiosk.conf på SD-kortet" test -f "$KC"
tjek "kiosk.conf har BOM" test "$(head -c 3 "$KC" | od -An -tx1 | tr -d ' \n')" = efbbbf
tjek "kiosk.conf har CRLF" grep -q $'\r$' "$KC"
tjek "VEJLEDNING.txt på SD-kortet" test -f "$R/boot/firmware/VEJLEDNING.txt"

# Funktion inde i billedet: setup og generator læser kiosk.conf fra SD-kortet
printf '\xEF\xBB\xBFTV_URL=https://a.dk/t/abc&qr=0\r\nNAVN=TV Bane Ø\r\nWIFI_NAVN=Hal æ\r\nWIFI_KODE=min kode 1\r\nSLUK_KL=22.30\r\n' > "$KC"
chroot "$R" /usr/lib/badminton-tv/setup >/dev/null 2>&1
NM=$R/etc/NetworkManager/system-connections/badminton-tv-wifi.nmconnection
tjek "setup: WiFi-fil skrevet" grep -q '^ssid=Hal æ$' "$NM"
tjek "setup: WiFi-kode med mellemrum" grep -q '^psk=min kode 1$' "$NM"
tjek "setup: værtsnavn" grep -qx 'tv-bane-oe' "$R/etc/hostname"
tjek "setup: URL med & til browseren" grep -q "abc\\\\&qr=0" "$R/run/badminton-tv/kiosk.env"
mkdir -p "$R/tmp/gen"
chroot "$R" /usr/lib/systemd/system-generators/badminton-tv-sluk-generator /tmp/gen >/dev/null 2>&1
tjek "generator: sluk-timer kl. 22:30" grep -q 'OnCalendar=\*-\*-\* 22:30:00' "$R/tmp/gen/badminton-tv-sluk.timer"

echo "$ok bestået, $fejl fejlet"
[ "$fejl" -eq 0 ]
