#!/bin/bash
# Bygger Badminton TV USB-nøglen.
#
# Køres som root i en privilegeret debian:trixie-container — live-build skal
# kunne lave chroot og mounte:
#
#   docker run --rm --privileged -v "$PWD/kiosk:/src" -v "$PWD/kiosk/ud:/ud" \
#       debian:trixie bash /src/build.sh
#
# Resultat i /ud:
#   badminton-tv-usb-<version>.zip   pakkes ud på en FAT32-formateret USB-nøgle
#   badminton-tv-usb-<version>.img   skrives med balenaEtcher/Rufus (alle størrelser)
#   SHA256SUMS
#
# Miljøvariabler:
#   VERSION=2026.10.01   versionsnummer (standard: dagens dato + "-dev")
#   GENBRUG_ISO=1        spring live-build over, hvis ISO'en allerede er bygget
#                        (hurtig iteration på USB-filerne under udvikling)

set -euo pipefail

SRC=$(cd "$(dirname "$0")" && pwd)
UD=${UD:-/ud}
ARB=${ARB:-/var/tmp/badminton-tv}
VERSION=${VERSION:-$(date -u +%Y.%m.%d)-dev}
GENBRUG_ISO=${GENBRUG_ISO:-0}
LABEL=BADMINTONTV   # FAT-labels må højst være 11 tegn

trin() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

trin "Værktøjer"
mangler=''
for p in live-build xorriso mtools dosfstools zip fdisk; do
    dpkg -s "$p" >/dev/null 2>&1 || mangler+=" $p"
done
if [ -n "$mangler" ]; then
    apt-get update -qq
    # shellcheck disable=SC2086
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $mangler >/dev/null
fi
mkdir -p "$UD"

# ── 1. Live-systemet ───────────────────────────────────────
ISO=$ARB/lb/live-image-amd64.hybrid.iso
if [ "$GENBRUG_ISO" = 1 ] && [ -f "$ISO" ]; then
    trin "Genbruger $ISO"
else
    trin "Bygger live-systemet med live-build (tager 10-30 minutter)"
    # live-builds cache (debootstrap + hentede pakker) gemmes mellem byg i samme
    # container, så et genbyg ikke skal hente det hele igen.
    if [ -d "$ARB/lb/cache" ]; then
        rm -rf "$ARB/cache"
        mv "$ARB/lb/cache" "$ARB/cache"
    fi
    if [ -d "$ARB/lb" ]; then
        (cd "$ARB/lb" && lb clean --purge >/dev/null 2>&1) || true
    fi
    rm -rf "$ARB/lb"
    mkdir -p "$ARB/lb"
    cp -a "$SRC/live/." "$ARB/lb/"
    [ -d "$ARB/cache" ] && mv "$ARB/cache" "$ARB/lb/cache"
    # Rettigheder kan ikke stoles på fra en checkout på Windows (alt bliver
    # enten 644 eller 755). Alt bliver 644 her; hooket giver vores scripts +x.
    find "$ARB/lb/config/includes.chroot_after_packages" -type d -exec chmod 755 {} +
    find "$ARB/lb/config/includes.chroot_after_packages" -type f -exec chmod 644 {} +
    chmod +x "$ARB/lb/auto/config" "$ARB"/lb/config/hooks/normal/*.hook.chroot
    mkdir -p "$ARB/lb/config/includes.chroot_after_packages/usr/share/badminton-tv"
    printf '%s\n' "$VERSION" > "$ARB/lb/config/includes.chroot_after_packages/usr/share/badminton-tv/version"

    cd "$ARB/lb"
    lb config
    set +e
    lb build 2>&1 | tee "$UD/live-build.log"
    status=${PIPESTATUS[0]}
    set -e
    cd - >/dev/null
    if [ "$status" -ne 0 ] || [ ! -f "$ISO" ]; then
        echo "live-build fejlede (status $status) — se $UD/live-build.log" >&2
        exit 1
    fi
fi

# ── 2. USB-nøglens indhold ─────────────────────────────────
trin "Samler USB-nøglens filer"
USB=$ARB/usb
rm -rf "$USB"
mkdir -p "$USB"
xorriso -osirrox on -indev "$ISO" -extract / "$USB" 2>/dev/null
chmod -R u+w "$USB"

# UEFI leder efter \EFI\BOOT\BOOTX64.EFI på FAT-partitionen. live-build lægger
# shim (bootx64.efi) og den signerede GRUB (grubx64.efi) dér i ISO'ens filtræ.
# GRUB finder selv nøglens rod via /.disk/info og læser /boot/grub/grub.cfg.
[ -f "$USB/EFI/boot/bootx64.efi" ] && [ -f "$USB/EFI/boot/grubx64.efi" ] \
    || { echo "Fandt ikke EFI/boot/bootx64.efi + grubx64.efi i ISO'en" >&2; exit 1; }
[ -f "$USB/.disk/info" ] || { echo "Fandt ikke .disk/info i ISO'en" >&2; exit 1; }

# Kun UEFI fra FAT: El Torito-billeder, BIOS-filer og ISO-tjeksummer skal ikke med.
rm -rf "$USB/isolinux" "$USB/boot/grub/i386-pc" "$USB/boot.catalog" \
       "$USB/efi.img" "$USB/boot/grub/efi.img" "$USB"/sha256sum.* "$USB/md5sum.txt"

# Kernen har versionsnummer i navnet; startmenuen bruger faste navne.
mapfile -t KERNER < <(find "$USB/live" -maxdepth 1 -name 'vmlinuz-*')
mapfile -t INITRD < <(find "$USB/live" -maxdepth 1 -name 'initrd.img-*')
[ "${#KERNER[@]}" -eq 1 ] && [ "${#INITRD[@]}" -eq 1 ] \
    || { echo "Forventede præcis én kerne og én initrd i /live (fandt ${#KERNER[@]} og ${#INITRD[@]})" >&2; exit 1; }
mv "${KERNER[0]}" "$USB/live/vmlinuz"
mv "${INITRD[0]}" "$USB/live/initrd.img"

# Vores startmenu i stedet for live-builds.
cp "$SRC/usb/boot/grub/grub.cfg" "$USB/boot/grub/grub.cfg"

# Tekstfilerne skal kunne åbnes i Notesblok: UTF-8 med BOM og CRLF.
til_windows() { printf '\xEF\xBB\xBF'; sed 's/$/\r/' "$1"; }
til_windows "$SRC/usb/kiosk.conf" > "$USB/kiosk.conf"
til_windows "$SRC/usb/VEJLEDNING.txt" > "$USB/VEJLEDNING.txt"
printf '%s\r\n' "$VERSION" > "$USB/version.txt"

SQ=$(stat -c %s "$USB/live/filesystem.squashfs")
if [ "$SQ" -ge $((4 * 1024 * 1024 * 1024 - 1)) ]; then
    echo "filesystem.squashfs er over 4 GB og kan ikke ligge på FAT32" >&2
    exit 1
fi
echo "filesystem.squashfs: $((SQ / 1024 / 1024)) MB"

# ── 3. Zip og diskbillede ──────────────────────────────────
NAVN=badminton-tv-usb-$VERSION
rm -f "$UD/$NAVN.zip" "$UD/$NAVN.img"

trin "Pakker $NAVN.zip"
(cd "$USB" && zip -q -r -X "$UD/$NAVN.zip" .)

trin "Laver $NAVN.img"
# MBR med én FAT32-partition (type 0x0c) — samme layout som Rufus laver. Windows
# viser den som et almindeligt drev, så kiosk.conf kan rettes efter skrivning,
# og UEFI starter fra den.
STR_MB=$(( $(du -sm "$USB" | cut -f1) + 128 ))
IMG=$UD/$NAVN.img
truncate -s "${STR_MB}M" "$IMG"
printf 'label: dos\nstart=2048, type=c, bootable\n' | sfdisk -q "$IMG"
SEKTORER=$(( STR_MB * 1024 * 1024 / 512 - 2048 ))
mkfs.vfat -F 32 -n "$LABEL" --offset 2048 "$IMG" $((SEKTORER / 2)) >/dev/null
MTOOLS_SKIP_CHECK=1 mcopy -s -i "$IMG@@1M" "$USB"/* "$USB"/.disk ::/

(cd "$UD" && sha256sum "$NAVN.zip" "$NAVN.img" > SHA256SUMS)

trin "Færdig"
ls -lh "$UD/$NAVN.zip" "$UD/$NAVN.img"
