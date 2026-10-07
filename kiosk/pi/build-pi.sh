#!/bin/bash
# Bygger Badminton TV-billedet til Raspberry Pi 3, 4 og 5 (SD-kort).
#
# Tager det officielle Raspberry Pi OS Lite (64-bit) og tilpasser det: samme
# scripts, startside og indstillinger som PC-udgaven, men uden installation —
# SD-kortet ER Pi'ens disk. kiosk.conf ligger på kortets FAT-partition, så den
# kan rettes på en Windows-PC, også efter at Pi'en er taget i brug.
#
# Ét billede passer til Pi 3, 4 og 5: Raspberry Pi OS har kerner til dem alle,
# og Pi'en vælger selv den rigtige ved opstart.
#
# Køres som root i en privilegeret debian:trixie-container. Containeren selv
# behøver ikke være ARM64: kun programmerne inde i Pi-billedet (chroot) skal
# køre som ARM64, og det klarer kernens binfmt-emulering — Docker Desktop har
# den slået til, og GitHubs ARM-runner kører dem direkte. At køre HELE bygget
# emuleret (--platform linux/arm64) virker også, men udpakning og
# komprimering tager så timer i stedet for sekunder.
#
#   docker run --rm --privileged \
#       -v "$PWD/kiosk:/src" -v "$PWD/kiosk/ud:/ud" debian:trixie bash /src/pi/build-pi.sh
#
# Resultat i /ud: badminton-tv-pi-<version>.img.xz (+ SHA256SUMS-pi), som
# skrives til et SD-kort med Raspberry Pi Imager eller balenaEtcher.

set -euo pipefail

SRC=$(cd "$(dirname "$0")/.." && pwd)
UD=${UD:-/ud}
ARB=${ARB:-/var/tmp/badminton-tv-pi}
VERSION=${VERSION:-$(date -u +%Y.%m.%d)-dev}

# Raspberry Pi OS Lite (64-bit), trixie. Fastlåst med tjeksum, så et nyt
# Raspberry Pi OS ikke ændrer billedet uden at nogen har set på det.
PI_OS_URL=https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2026-09-15/2026-09-15-raspios-trixie-arm64-lite.img.xz
PI_OS_SHA256=cdf4f3bfac35ae947b46e4e767f935453810549779ac3290e05a6754aee627e5

# Raspberry Pi OS' rodpartition er næsten fuld; Chromium m.m. skal have plads.
# Ved første opstart udvides den alligevel til hele SD-kortet.
EKSTRA_MB=2048

trin() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

trin "Værktøjer"
mangler=''
for p in curl ca-certificates xz-utils fdisk e2fsprogs dosfstools zerofree; do
    dpkg -s "$p" >/dev/null 2>&1 || mangler+=" $p"
done
if [ -n "$mangler" ]; then
    apt-get update -qq
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $mangler >/dev/null
fi
mkdir -p "$UD" "$ARB/cache"

# ── 1. Raspberry Pi OS ─────────────────────────────────────
trin "Henter Raspberry Pi OS"
KILDE=$ARB/cache/$(basename "$PI_OS_URL")
if ! echo "$PI_OS_SHA256  $KILDE" | sha256sum -c --quiet 2>/dev/null; then
    curl -fsSL -o "$KILDE" "$PI_OS_URL"
    echo "$PI_OS_SHA256  $KILDE" | sha256sum -c --quiet
fi

IMG=$ARB/badminton-tv-pi.img
xz -T0 -dc "$KILDE" > "$IMG"

trin "Gør plads til Chromium (+$EKSTRA_MB MB)"
truncate -s "+${EKSTRA_MB}M" "$IMG"
echo ', +' | sfdisk -q --no-reread -N 2 "$IMG"

# Partitionernes placering (sektorer à 512 byte).
part() { sfdisk -d "$IMG" | awk -v p="${IMG}$1" -F'[=,]' '$1 ~ p" " { gsub(/ /, "", $2); gsub(/ /, "", $4); print $2, $4 }'; }
read -r BOOT_START BOOT_STR < <(part 1)
read -r ROD_START ROD_STR < <(part 2)

LOOPS=()
ROD=$ARB/rod
oprydning() {
    set +e
    umount -R "$ROD" 2>/dev/null
    for l in "${LOOPS[@]}"; do losetup -d "$l" 2>/dev/null; done
}
trap oprydning EXIT

# Sætter variablen $1 til en ny loop-enhed. Kaldes direkte og ikke som $(...):
# i en subshell ville LOOPS+= forsvinde, og enheden aldrig blive frigivet.
loop() { # variabel start størrelse (sektorer)
    local l
    l=$(losetup -f --show -o $(($2 * 512)) --sizelimit $(($3 * 512)) "$IMG")
    LOOPS+=("$l")
    printf -v "$1" '%s' "$l"
}
loop LOOP_BOOT "$BOOT_START" "$BOOT_STR"
loop LOOP_ROD "$ROD_START" "$ROD_STR"

# e2fsck: 0 = intet at rette, 1 = rettet — begge er i orden.
e2fsck -fy "$LOOP_ROD" >/dev/null || [ $? -le 1 ]
resize2fs -p "$LOOP_ROD" >/dev/null

mkdir -p "$ROD"
mount "$LOOP_ROD" "$ROD"
mount "$LOOP_BOOT" "$ROD/boot/firmware"
for d in dev dev/pts proc sys; do
    mount --bind "/$d" "$ROD/$d"
done

if ! chroot "$ROD" /usr/bin/true 2>/dev/null; then
    echo "Kan ikke køre Pi'ens ARM64-programmer på denne maskine ($(uname -m))." >&2
    echo "Slå ARM64-emulering til med:" >&2
    echo "  docker run --privileged --rm tonistiigi/binfmt --install arm64" >&2
    exit 1
fi

# ── 2. Vores filer ─────────────────────────────────────────
trin "Kopierer Badminton TV-filerne ind"
FAELLES=$SRC/live/config/includes.chroot_after_packages
cp -a "$FAELLES/." "$ROD/"
cp -a "$SRC/pi/rootfs/." "$ROD/"
# Kun til PC'en: installationen og "Hent fejllog" fra USB-nøglen, og GRUB.
rm -f "$ROD/usr/lib/badminton-tv/installer" \
      "$ROD/usr/lib/systemd/system/badminton-tv-installer.service" \
      "$ROD/usr/lib/badminton-tv/hentlog" \
      "$ROD/usr/lib/systemd/system/badminton-tv-hentlog.service" \
      "$ROD/etc/modules-load.d/badminton-tv-pstore.conf"
rm -rf "$ROD/etc/default/grub.d"
mkdir -p "$ROD/usr/share/badminton-tv"
printf '%s\n' "$VERSION" > "$ROD/usr/share/badminton-tv/version"
# Rettigheder kan ikke stoles på fra en checkout på Windows. tilpas.sh giver
# vores scripts +x igen.
for d in "$FAELLES" "$SRC/pi/rootfs"; do
    (cd "$d" && find . -type f) | while read -r f; do
        if [ -e "$ROD/$f" ]; then chmod 644 "$ROD/$f"; fi   # PC-filerne er slettet
    done
done

# ── 3. Pakker og indstillinger (inde i billedet) ───────────
trin "Installerer pakker og indstiller systemet (langsomt under emulering)"
# DNS i chroot, og ingen services må starte under installationen.
cp "$ROD/etc/resolv.conf" "$ARB/resolv.conf.orig"
cp /etc/resolv.conf "$ROD/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$ROD/usr/sbin/policy-rc.d"
chmod 755 "$ROD/usr/sbin/policy-rc.d"
cp "$SRC/pi/tilpas.sh" "$ROD/tmp/tilpas.sh"

chroot "$ROD" bash /tmp/tilpas.sh

rm -f "$ROD/usr/sbin/policy-rc.d" "$ROD/tmp/tilpas.sh"
cp "$ARB/resolv.conf.orig" "$ROD/etc/resolv.conf"

# ── 4. SD-kortets FAT-partition ────────────────────────────
trin "Indstiller opstart og lægger kiosk.conf på SD-kortet"
CMDLINE=$ROD/boot/firmware/cmdline.txt
# Danske WiFi-regler, ingen skærmslukning, ingen tekst og markør. Opløsningen
# låses til 1080p på begge HDMI-porte: TV-siden er lavet til 1920 px, og en
# Pi 3/4 har ikke kræfter til 4K. (Uden 'D' — porten tvinges ikke tændt, så
# den ubrugte port ikke bliver en usynlig skærm.)
# systemd.restore_state=0: systemd gemmer ellers WiFi-kortets "slået fra" ved
# nedlukning og genskaber det ved næste opstart — så en enkelt blokeret
# opstart ville hænge ved for altid.
for param in cfg80211.ieee80211_regdom=DK systemd.restore_state=0 \
             consoleblank=0 loglevel=3 quiet \
             vt.global_cursor_default=0 \
             video=HDMI-A-1:1920x1080@60 video=HDMI-A-2:1920x1080@60; do
    grep -qw -- "$param" "$CMDLINE" || sed -i "1s|\$| $param|" "$CMDLINE"
done
# cloud-init er slået fra; dens filer på kortet ville bare forvirre.
rm -f "$ROD/boot/firmware/user-data" "$ROD/boot/firmware/meta-data" "$ROD/boot/firmware/network-config"

# FAT-partitionen kan kun læses af root — kiosk.conf indeholder WiFi-koden.
sed -i 's|^\(\S*\s\+/boot/firmware\s\+vfat\s\+\)defaults|\1defaults,fmask=0077,dmask=0077|' "$ROD/etc/fstab"
# Dør SD-kortet, skal Pi'en genstarte frem for at stå frosset med et
# skrivebeskyttet system — samme regel som PC'ens installer giver NVMe-disken.
sed -i 's|^\(\S*\s\+/\s\+ext4\s\+defaults,noatime\)|\1,errors=panic|' "$ROD/etc/fstab"
grep -qE '\s/\s+ext4\s+\S*errors=panic' "$ROD/etc/fstab" \
    || { echo "FEJL: roden i /etc/fstab ser ikke ud som ventet" >&2; exit 1; }

til_windows() { printf '\xEF\xBB\xBF'; sed 's/$/\r/' "$1"; }
til_windows "$SRC/usb/kiosk.conf" > "$ROD/boot/firmware/kiosk.conf"
til_windows "$SRC/pi/VEJLEDNING.txt" > "$ROD/boot/firmware/VEJLEDNING.txt"
printf '%s\r\n' "$VERSION" > "$ROD/boot/firmware/badminton-tv-version.txt"

df -h "$ROD" | tail -1

# ── 5. Pak billedet ────────────────────────────────────────
trin "Pakker billedet"
sync
umount -R "$ROD"
# Nulstil ubrugte blokke (slettede pakkefiler), så billedet komprimerer godt.
zerofree "$LOOP_ROD"
for l in "${LOOPS[@]}"; do losetup -d "$l"; done
LOOPS=()

NAVN=badminton-tv-pi-$VERSION.img.xz
rm -f "$UD/$NAVN"
xz -T0 -6 -c "$IMG" > "$UD/$NAVN"
rm -f "$IMG"
(cd "$UD" && sha256sum "$NAVN" > SHA256SUMS-pi)

trin "Færdig"
ls -lh "$UD/$NAVN"
