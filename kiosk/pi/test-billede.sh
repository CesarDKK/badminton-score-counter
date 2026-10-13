#!/bin/bash
# Tjekker et færdigt Raspberry Pi-billede uden en rigtig Pi: monterer det og
# kontrollerer pakker, bruger, services, opstartsindstillinger og kiosk.conf,
# og kører setup og slukke-generatoren inde i billedet (chroot). Tjekker også
# opdateringens system (badminton-tv-pi-rod-<version>.squashfs ved siden af).
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

command -v unsquashfs >/dev/null || { apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xz-utils fdisk squashfs-tools >/dev/null; }

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
# Som på Pi'en (fstab): FAT-partitionen på /boot/kort, system A's mappe på /boot/firmware
mount "$LOOP_BOOT" "$R/boot/kort"
mount --bind "$R/boot/kort/a" "$R/boot/firmware"
K=$R/boot/kort
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
for s in setup browser cec sluk netstatus diagnose browservagt; do
    tjek "kørbar: $s" test -x "$R/usr/lib/badminton-tv/$s"
done
tjek "generator kørbar" test -x "$R/usr/lib/systemd/system-generators/badminton-tv-sluk-generator"
tjek "installeren er ikke med" test ! -e "$R/usr/lib/badminton-tv/installer"
tjek "installer-service er ikke med" test ! -e "$R/usr/lib/systemd/system/badminton-tv-installer.service"
tjek "version skrevet" test -s "$R/usr/share/badminton-tv/version"
tjek "diagnose kører på Pi (drop-in)" test -f "$R/etc/systemd/system/badminton-tv-diagnose.service.d/pi.conf"

# Services
tjek "aktiv: badminton-tv-setup" aktiveret sysinit.target badminton-tv-setup.service
# En Pi har intet batteri-ur — uden timesyncd stilles uret aldrig.
tjek "aktiv: systemd-timesyncd" aktiveret sysinit.target systemd-timesyncd.service
for s in badminton-tv badminton-tv-cec badminton-tv-netstatus badminton-tv-diagnose badminton-tv-browservagt NetworkManager; do
    tjek "aktiv: $s" aktiveret multi-user.target "$s.service"
done
for u in userconfig.service systemd-firstboot.service sleep.target suspend.target \
         hibernate.target apt-daily.timer apt-daily-upgrade.timer; do
    tjek "maskeret: $u" maskeret "$u"
done
tjek "cloud-init slået fra" test -e "$R/etc/cloud/cloud-init.disabled"
tjek "standardmål multi-user" symlink_til "$R/etc/systemd/system/default.target" /usr/lib/systemd/system/multi-user.target
tjek "tidszone København" symlink_til "$R/etc/localtime" /usr/share/zoneinfo/Europe/Copenhagen
tjek "hardware-uret i dansk tid (adjtime LOCAL)" grep -qx LOCAL "$R/etc/adjtime"
tjek "aktiv: badminton-tv-ur.timer" aktiveret timers.target badminton-tv-ur.timer
tjek "aktiv: badminton-tv-ur-nedlukning" aktiveret multi-user.target badminton-tv-ur-nedlukning.service
tjek "hwclock findes (util-linux-extra)" test -x "$R/usr/sbin/hwclock"

# Opstart: to systemer, A og B (usr/lib/badminton-tv/rod.sh)
CMD=$K/a/cmdline.txt
tjek "cmdline.txt i a\ er én linje" test "$(wc -l < "$CMD")" -le 1
for p in 'cfg80211.ieee80211_regdom=DK' 'systemd.restore_state=0' \
         'video=HDMI-A-1:1920x1080@60' 'video=HDMI-A-2:1920x1080@60' \
         'consoleblank=0' 'panic=10' 'badminton.slot=a' 'root=PARTUUID=[0-9a-f]*-02 '; do
    tjek "cmdline: $p" grep -q -- "$p" "$CMD"
done
tjek "cmdline: roden udvides ikke (resize)" bash -c "! grep -qw resize '$CMD'"
for f in kernel8.img kernel_2712.img initramfs8 initramfs_2712 bcm2710-rpi-3-b-plus.dtb \
         bcm2711-rpi-4-b.dtb bcm2712-rpi-5-b.dtb overlays/README; do
    tjek "a\$f" test -s "$K/a/$f"
done
tjek "ingen kerne i FAT-roden" test ! -e "$K/kernel8.img"
tjek "firmware i FAT-roden (start.elf, bootcode.bin)" test -s "$K/start.elf" -a -s "$K/bootcode.bin"
tjek "config.txt: os_prefix=a/" grep -qx 'os_prefix=a/' "$K/config.txt"
tjek "config.txt: tryboot → b/" bash -c "sed -n '/^\[tryboot\]/,/^\[all\]/p' '$K/config.txt' | grep -qx 'os_prefix=b/'"
tjek "config.txt: vagthund fra start" grep -qx 'dtparam=watchdog=on' "$K/config.txt"
tjek "config.txt: Badminton TV-blokken står sidst" bash -c "tail -1 '$K/config.txt' | grep -q '<<< Badminton TV'"
tjek "cloud-init-filer fjernet" test ! -e "$K/network-config"
tjek "fstab: FAT på /boot/kort, kun for root" grep -qE '^PARTUUID=[0-9a-f]+-01\s+/boot/kort\s+vfat\s+\S*fmask=0077' "$R/etc/fstab"
tjek "fstab: system A er roden" grep -qE '^PARTUUID=[0-9a-f]+-02\s+/\s+ext4\s+\S*errors=panic' "$R/etc/fstab"
tjek "fstab: a\ bundet til /boot/firmware" grep -qE '^/boot/kort/a\s+/boot/firmware\s+none\s+bind' "$R/etc/fstab"
tjek "disk-id i fstab = cmdline" test "$(grep -o 'PARTUUID=[0-9a-f]*-02' "$R/etc/fstab")" = "$(grep -o 'PARTUUID=[0-9a-f]*-02' "$CMD")"
tjek "system A er 6 GB" test "$RZ" -eq $((6144 * 2048))
tjek "ingen system B i billedet (oprettes af opdateringen)" bash -c "! sfdisk -d '$IMG' | grep -q '${IMG}3 '"
tjek "hængende disk → panik (sysctl)" grep -q '^kernel.hung_task_panic = 1' "$R/etc/sysctl.d/90-badminton-tv-vagthund.conf"

# Automatisk opdatering
tjek "kørbar: opdatering" test -x "$R/usr/lib/badminton-tv/opdatering"
tjek "rod.sh findes" test -s "$R/usr/lib/badminton-tv/rod.sh"
tjek "offentlig nøgle (opdatering.pub)" grep -q 'BEGIN PUBLIC KEY' "$R/usr/share/badminton-tv/opdatering.pub"
for p in /usr/bin/curl /usr/bin/openssl /usr/bin/rsync /usr/sbin/sfdisk /usr/bin/partx; do
    tjek "findes: $p" test -x "$R$p"
done
tjek "aktiv: badminton-tv-opdatering.timer" aktiveret timers.target badminton-tv-opdatering.timer
tjek "aktiv: badminton-tv-opdatering-proev" aktiveret multi-user.target badminton-tv-opdatering-proev.service
tjek "aktiv: badminton-tv-opdatering-bekraeft" aktiveret multi-user.target badminton-tv-opdatering-bekraeft.service
tjek "opdatering status kører i billedet" chroot "$R" env BT_PLATFORM=pi /usr/lib/badminton-tv/opdatering status
SQ=$(dirname "$FIL")/$(basename "$FIL" .img.xz | sed 's/^badminton-tv-pi-/badminton-tv-pi-rod-/').squashfs
tjek "opdateringens system findes ($(basename "$SQ"))" test -s "$SQ"
if [ -s "$SQ" ]; then
    INDHOLD=$(unsquashfs -l "$SQ" 2>/dev/null)
    for f in boot/firmware/kernel8.img boot/firmware/kernel_2712.img boot/firmware/cmdline.txt \
             boot/firmware/overlays/README usr/lib/badminton-tv/opdatering usr/bin/chromium; do
        tjek "squashfs: $f" grep -q "^squashfs-root/$f\$" <<<"$INDHOLD"
    done
    tjek "squashfs: samme version" test "$(unsquashfs -cat "$SQ" usr/share/badminton-tv/version 2>/dev/null)" = "$(cat "$R/usr/share/badminton-tv/version")"
fi

# kiosk.conf på SD-kortet: UTF-8 med BOM og CRLF, så den kan rettes i Notesblok
KC=$K/kiosk.conf
tjek "kiosk.conf på SD-kortet" test -f "$KC"
tjek "kiosk.conf har BOM" test "$(head -c 3 "$KC" | od -An -tx1 | tr -d ' \n')" = efbbbf
tjek "kiosk.conf har CRLF" grep -q $'\r$' "$KC"
tjek "VEJLEDNING.txt på SD-kortet" test -f "$K/VEJLEDNING.txt"

# Funktion inde i billedet: setup og generator læser kiosk.conf fra SD-kortet
printf '\xEF\xBB\xBFTV_URL=https://a.dk/t/abc&qr=0\r\nNAVN=TV Bane Ø\r\nWIFI_NAVN=Hal æ\r\nWIFI_KODE=min kode 1\r\nSLUK_KL=22.30\r\n' > "$KC"
chroot "$R" /usr/lib/badminton-tv/setup >/dev/null 2>&1
NM=$R/etc/NetworkManager/system-connections/badminton-tv-wifi.nmconnection
tjek "setup: WiFi-fil skrevet" grep -q '^ssid=Hal æ$' "$NM"
tjek "setup: WiFi-kode med mellemrum" grep -q '^psk=min kode 1$' "$NM"
# Raspberry Pi OS leveres med WirelessEnabled=false — setup skal slå det til.
tjek "setup: WiFi slået til i NetworkManager" grep -qx 'WirelessEnabled=true' "$R/var/lib/NetworkManager/NetworkManager.state"
tjek "setup: værtsnavn" grep -qx 'tv-bane-oe' "$R/etc/hostname"
tjek "setup: URL med & til browseren" grep -q "abc\\\\&qr=0" "$R/run/badminton-tv/kiosk.env"
mkdir -p "$R/tmp/gen"
chroot "$R" /usr/lib/systemd/system-generators/badminton-tv-sluk-generator /tmp/gen >/dev/null 2>&1
tjek "generator: sluk-timer kl. 22:30" grep -q 'OnCalendar=\*-\*-\* 22:30:00' "$R/tmp/gen/badminton-tv-sluk.timer"

echo "$ok bestået, $fejl fejlet"
[ "$fejl" -eq 0 ]
