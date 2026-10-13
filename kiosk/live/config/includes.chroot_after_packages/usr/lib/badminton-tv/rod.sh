# shellcheck shell=bash
# Fælles for installeren, Pi-bygget og den automatiske opdatering: gør en kopi
# af systemet (squashfs) til et system, der starter fra PC'ens disk eller
# Pi'ens SD-kort. Kalderen sender selv uddata til sin log.
#
# PC'ens disk:
#   1  EFI             GRUB og vælgeren (\EFI\debian\grub.cfg + badminton-tv.env)
#   2  badminton-tv-a  system A
#   3  badminton-tv-b  system B
#
# Raspberry Pi'ens SD-kort (bt_pi_*):
#   1  FAT  (/boot/kort)  firmware, config.txt, kiosk.conf, og a\ og b\ med hvert
#                         systems kerne, initramfs, device trees og cmdline.txt
#   2  ext4               system A (6 GB)
#   3  ext4               system B — oprettes af den første opdatering
# config.txt vælger mappen med os_prefix; ved en tryboot-genstart (én gang,
# glemmes ved næste opstart) den anden mappe. Det kørende systems mappe er
# bundet til /boot/firmware, så Raspberry Pi OS' kerneopdateringer havner i
# den rigtige mappe.
#
# Det ene system kører, det andet er ledigt til næste version (se opdatering).

# bt_rod_fstab MÅL ROD-UUID ESP-UUID
#
# errors=panic: dør disken (set 2026-10-06: NVMe holdt op med at svare), skal
# PC'en genstarte med det samme i stedet for at stå frosset med et skrivebeskyttet
# system. Panikken gemmes i pstore, så "Hent fejllog" viser diskfejlene.
bt_rod_fstab() {
    mkdir -p "$1/boot/efi"
    cat > "$1/etc/fstab" <<EOF
# Oprettet af Badminton TV
UUID=$2  /          ext4  defaults,noatime,errors=panic       0  1
UUID=$3  /boot/efi  vfat  umask=0077                          0  1
tmpfs           /tmp       tmpfs defaults,nosuid,nodev               0  0
EOF
}

# bt_rod_monter MÅL — /dev, /proc og /sys til chroot.
#
# rslave: ellers forplanter umount -R sig tilbage og afmonterer det kørende
# systems egne /sys- og /dev-undermonteringer. (/sys/firmware/efi/efivars, som
# grub-install skal bruge, kommer med i rbind af /sys.) /run får sin egen tomme
# tmpfs — det kørende systems /run (fx USB-nøglen) skal ikke med.
bt_rod_monter() {
    local d
    for d in dev proc sys; do
        mount --rbind "/$d" "$1/$d"
        mount --make-rslave "$1/$d"
    done
    mount -t tmpfs tmpfs "$1/run"
}

bt_rod_afmonter() {
    local d
    for d in run sys proc dev; do
        umount -R "$1/$d" 2>/dev/null || umount -Rl "$1/$d"
    done
}

# bt_rod_chroot MÅL KOMMANDO… (kræver bt_rod_monter)
bt_rod_chroot() {
    local maal=$1; shift
    chroot "$maal" env LC_ALL=C.UTF-8 DEBIAN_FRONTEND=noninteractive "$@"
}

# Live-pakkerne hører kun til USB-nøglen. Når de fjernes, bygger dpkg selv en
# almindelig initramfs uden live-boot. (kræver bt_rod_monter)
bt_rod_fjern_live() {
    local pakker
    pakker=$(chroot "$1" dpkg-query -W -f='${Package} ${Status}\n' 'live-*' 2>/dev/null \
        | awk '$NF == "installed" { print $1 }' | tr '\n' ' ')
    if [ -n "$pakker" ]; then
        # shellcheck disable=SC2086
        bt_rod_chroot "$1" dpkg --purge $pakker
    fi
}

# GRUB på EFI-partitionen skrives én gang af installeren og ændres aldrig
# bagefter: den vælger mellem system A og B (grub-esp.cfg). En opgradering af
# GRUB-pakkerne kører grub-install, som ville erstatte vælgeren med en, der kun
# kender det ene system — så de opgraderes ikke af sikkerhedsopdateringerne,
# men kommer med nye udgivelser af Badminton TV. (Kan ikke gøres, når billedet
# bygges: live-build installerer og fjerner selv GRUB-pakker bagefter.)
# GRUB-pakkens postinst kører kun grub-install, når core.efi findes.
# (kræver bt_rod_monter)
bt_rod_laas_grub() {
    local pakker
    pakker=$(chroot "$1" dpkg-query -W -f='${Package} ${Status}\n' 'grub*' 'shim*' 2>/dev/null \
        | awk '$NF == "installed" { print $1 }' | tr '\n' ' ')
    if [ -n "$pakker" ]; then
        # shellcheck disable=SC2086
        bt_rod_chroot "$1" apt-mark hold $pakker
    fi
    rm -f "$1/boot/grub/x86_64-efi/core.efi"
}

# bt_rod_kan_starte MÅL VERSION — fejl, hvis systemet mangler noget for at
# kunne starte fra vælgeren (kerne, initramfs, opstartslinje) eller har en
# anden version end ventet.
bt_rod_kan_starte() {
    local f
    for f in vmlinuz initrd.img usr/share/badminton-tv/grub-slot.cfg; do
        if [ ! -s "$1/$f" ]; then
            echo "Systemet mangler /$f" >&2
            return 1
        fi
    done
    if [ "$(cat "$1/usr/share/badminton-tv/version" 2>/dev/null)" != "$2" ]; then
        echo "Systemet har version $(cat "$1/usr/share/badminton-tv/version" 2>/dev/null), ventede $2" >&2
        return 1
    fi
}

# ── Raspberry Pi ───────────────────────────────────────────

# Partitionsnummer (02/03) for system a/b i PARTUUID=<disk-id>-NN
bt_pi_nr() { if [ "$1" = b ]; then echo 03; else echo 02; fi; }

# bt_pi_fstab MÅL DISK-ID SLOT
bt_pi_fstab() {
    mkdir -p "$1/boot/kort" "$1/boot/firmware"
    cat > "$1/etc/fstab" <<FSTAB
# Oprettet af Badminton TV (system $3) — se /usr/lib/badminton-tv/rod.sh
proc                   /proc           proc  defaults                         0  0
PARTUUID=$2-01  /boot/kort      vfat  defaults,fmask=0077,dmask=0077     0  2
PARTUUID=$2-$(bt_pi_nr "$3")  /               ext4  defaults,noatime,errors=panic      0  1
/boot/kort/$3          /boot/firmware  none  bind,x-systemd.requires-mounts-for=/boot/kort  0  0
FSTAB
}

# bt_pi_config CONFIG.TXT AKTIV — sætter Badminton TV's blok sidst i
# config.txt: os_prefix peger på det aktive system, og ved en tryboot-genstart
# på det andet. Skrives til en ny fil, der omdøbes, så en strømafbrydelse ikke
# efterlader en halv config.txt.
bt_pi_config() {
    local cfg=$1 aktiv=$2 andet=a
    [ "$aktiv" = a ] && andet=b
    {
        awk '/^# >>> Badminton TV/ { skip = 1 } !skip { print } /^# <<< Badminton TV/ { skip = 0 }' "$cfg"
        printf '# >>> Badminton TV: system A/B (styres af /usr/lib/badminton-tv/opdatering)\n'
        printf '# Fryser Pi'"'"'en, før Linux kører, genstarter vagthunden den.\n'
        printf '[all]\ndtparam=watchdog=on\nos_prefix=%s/\n[tryboot]\nos_prefix=%s/\n[all]\n' "$aktiv" "$andet"
        printf '# <<< Badminton TV\n'
    } > "$cfg.ny"
    sync
    mv "$cfg.ny" "$cfg"
    sync
}

# bt_pi_kan_starte KORT SLOT DISK-ID VERSION ROD — fejl, hvis systemets mappe
# på FAT-partitionen mangler noget for at starte, eller roden har en anden
# version end ventet.
bt_pi_kan_starte() {
    local dir=$1/$2 f
    for f in kernel8.img kernel_2712.img initramfs8 initramfs_2712 cmdline.txt overlays/README; do
        if [ ! -s "$dir/$f" ]; then
            echo "Systemet mangler $dir/$f" >&2
            return 1
        fi
    done
    if ! grep -q "root=PARTUUID=$3-$(bt_pi_nr "$2") " "$dir/cmdline.txt" \
       || ! grep -q "badminton.slot=$2" "$dir/cmdline.txt"; then
        echo "cmdline.txt peger ikke på system $2: $(cat "$dir/cmdline.txt")" >&2
        return 1
    fi
    if [ "$(cat "$5/usr/share/badminton-tv/version" 2>/dev/null)" != "$4" ]; then
        echo "Systemet har version $(cat "$5/usr/share/badminton-tv/version" 2>/dev/null), ventede $4" >&2
        return 1
    fi
}
