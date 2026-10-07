#!/bin/bash
# Kører USB-billedet i en virtuel UEFI-PC (QEMU + OVMF), så hele forløbet kan
# testes uden en rigtig PC: boot fra USB → installation → fjern nøglen → boot
# fra disk. WiFi og HDMI-CEC kan ikke testes her; netværk går via et virtuelt
# netværkskort.
#
# Køres i en debian:trixie-container, hvor byggets uddata er monteret på /ud:
#
#   docker run -d --name bt-vm -v "$PWD/kiosk:/src" -v "$PWD/kiosk/ud:/ud" debian:trixie sleep infinity
#   docker exec bt-vm bash /src/test/vm.sh start /ud/badminton-tv-usb-<version>.img
#   docker exec bt-vm bash /src/test/vm.sh skaerm /ud/skaerm.png
#
# Kommandoer:
#   start <img> [flag…]   start med en ny, tom 16 GB NVMe-disk
#       --secure-boot     Secure Boot med Microsofts nøgler, som på en rigtig PC
#       --proeve          "Test uden at installere" bliver standardvalget i menuen
#                         (et tastetryk via QEMU når ikke altid menuen i tide)
#       --uden-tastatur   hverken USB- eller PS/2-tastatur (så virker tast ikke)
#       --nvram-fuld[=N]  fyld UEFI-lageret, så kun ca. N KB er fri (standard 4),
#                         og boot-posten ikke kan gemmes (som på M70q Gen 4)
#   genstart-fra-disk     start igen uden USB-nøgle (efter installation)
#   skaerm <fil.png>      skærmbillede
#   tast <tast>…          send taster (QEMU-navne: ret, down, esc, spc …)
#   fjern-usb             træk USB-nøglen ud
#   fjern-disk            lad PC'ens disk dø (PCIe hot-unplug) → kernepanik → genstart
#   saet-disk             sæt disken i igen, så genstarten kan boote fra den
#   stop
#
# Flagene ændrer kun VM'ens kopi af billedet, aldrig selve byggeresultatet.
# Uden KVM (fx Docker Desktop på Windows) emuleres CPU'en — langsomt, men det virker.
#
# Den installerede PC's journal kan læses bagefter: stop VM'en, konvertér
# vm/disk.qcow2 til raw og montér rodpartitionen (offset 1050624*512) med
# -o ro,noload,loop — så journalctl -D <mount>/var/log/journal.

set -euo pipefail
VM=${VM_DIR:-/ud/vm}
MON=$VM/monitor.sock
# Disken sidder bag en PCIe-port, så den kan trækkes ud og sættes i igen
# (fjern-disk/saet-disk) — en NVMe direkte på rodbussen kan ikke hot-plugges.
NVME_DEV='nvme,drive=nvm,serial=BTDISK01,bootindex=2,id=nvme0,bus=rp1'
mkdir -p "$VM"

behoev() {
    command -v qemu-system-x86_64 >/dev/null && command -v socat >/dev/null \
        && command -v mcopy >/dev/null && return
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        qemu-system-x86 qemu-utils ovmf socat mtools >/dev/null
}

monitor() { printf '%s\n' "$*" | socat - "UNIX-CONNECT:$MON" | tr -d '\r' | grep -v '^(qemu)\|^QEMU' || true; }

# Retter grub.cfg i VM'ens kopi af USB-billedet.
ret_grub() { # sed-udtryk
    MTOOLS_SKIP_CHECK=1 mtype -i "$VM/usb.img@@1M" ::/boot/grub/grub.cfg | sed "$1" > "$VM/grub.cfg"
    MTOOLS_SKIP_CHECK=1 mcopy -o -i "$VM/usb.img@@1M" "$VM/grub.cfg" ::/boot/grub/grub.cfg
}

# Skriver VM'ens vars.fd = kilde + n variabler på 1 KB.
fyld_vars() { # kilde n
    python3 - "$2" > "$VM/fyld.json" <<'EOF'
import json, sys
print(json.dumps({"version": 2, "variables": [
    {"name": "BadmintonFyld%02d" % i, "guid": "b4d0f111-93ca-11d2-aa0d-00e098032b8c",
     "attr": 7, "data": "ab" * 1000} for i in range(int(sys.argv[1]))]}))
EOF
    virt-fw-vars -i "$1" -o "$VM/vars.fd" --set-json "$VM/fyld.json" >/dev/null
}

koer_qemu() { # med_usb(0/1)
    local med_usb=$1 secure code maskine accel=tcg i8042=''
    # shellcheck disable=SC2054  # kommaet er QEMU-syntaks
    local -a ekstra=() usb=() kbd=(-device usb-kbd,bus=xhci.0)
    secure=$(cat "$VM/secure" 2>/dev/null || echo 0)
    [ -e /dev/kvm ] && accel=kvm
    # q35 har altid et PS/2-tastatur; det skal også væk for at ligne en PC uden tastatur.
    if [ "$(cat "$VM/tastatur" 2>/dev/null || echo 1)" = 0 ]; then
        kbd=()
        i8042=',i8042=off'
    fi
    if [ "$secure" = 1 ]; then
        code=/usr/share/OVMF/OVMF_CODE_4M.ms.fd
        [ -f "$VM/vars.fd" ] || cp /usr/share/OVMF/OVMF_VARS_4M.ms.fd "$VM/vars.fd"
        maskine="q35,smm=on,accel=$accel$i8042"
        # shellcheck disable=SC2054  # kommaerne er QEMU-syntaks, ikke array-skilletegn
        ekstra=(-global driver=cfi.pflash01,property=secure,value=on)
    else
        code=/usr/share/OVMF/OVMF_CODE_4M.fd
        [ -f "$VM/vars.fd" ] || cp /usr/share/OVMF/OVMF_VARS_4M.fd "$VM/vars.fd"
        maskine="q35,accel=$accel$i8042"
    fi
    if [ "$med_usb" = 1 ]; then
        usb=(-drive "if=none,id=usbstick,format=raw,file=$VM/usb.img"
             -device "usb-storage,bus=xhci.0,drive=usbstick,id=usbdev,removable=on,bootindex=1")
    fi

    rm -f "$MON"
    qemu-system-x86_64 \
        -machine "$maskine" -cpu max -smp 4 -m 4096 \
        -global ICH9-LPC.noreboot=off \
        "${ekstra[@]}" \
        -drive "if=pflash,format=raw,unit=0,readonly=on,file=$code" \
        -drive "if=pflash,format=raw,unit=1,file=$VM/vars.fd" \
        -device qemu-xhci,id=xhci \
        "${kbd[@]}" \
        "${usb[@]}" \
        -device pcie-root-port,id=rp1,slot=1 \
        -drive "if=none,id=nvm,format=qcow2,file=$VM/disk.qcow2" \
        -device "$NVME_DEV" \
        -device virtio-vga,xres=1920,yres=1080 \
        -nic user,model=e1000e \
        -display none \
        -monitor "unix:$MON,server,nowait" \
        -serial "file:$VM/serial.log" \
        -daemonize
    echo "VM kører ($accel)."
}

case "${1:-}" in
    start)
        behoev
        img=${2:?Angiv USB-billedet}
        secure=0 proeve=0 fyld=0 tastatur=1
        for flag in "${@:3}"; do
            case "$flag" in
                --secure-boot) secure=1 ;;
                --proeve) proeve=1 ;;
                --uden-tastatur) tastatur=0 ;;
                --nvram-fuld) fyld=4 ;;
                --nvram-fuld=*) fyld=${flag#*=} ;;
                *) echo "Ukendt flag: $flag" >&2; exit 1 ;;
            esac
        done
        monitor quit >/dev/null 2>&1 || true
        rm -f "$VM/vars.fd" "$VM/disk.qcow2"
        echo "$secure" > "$VM/secure"
        echo "$tastatur" > "$VM/tastatur"
        qemu-img create -q -f qcow2 "$VM/disk.qcow2" 16G
        # Kopi, så installation-log.txt kan læses bagefter, og så flagene ikke
        # rører det byggede billede.
        cp "$img" "$VM/usb.img"
        if [ "$proeve" = 1 ]; then
            ret_grub 's/^set default=installer/set default=proeve/'
        fi
        if [ "$fyld" != 0 ]; then
            command -v virt-fw-vars >/dev/null || DEBIAN_FRONTEND=noninteractive \
                apt-get install -y -qq python3-virt-firmware >/dev/null
            if [ "$secure" = 1 ]; then kilde=/usr/share/OVMF/OVMF_VARS_4M.ms.fd
            else kilde=/usr/share/OVMF/OVMF_VARS_4M.fd; fi
            # Secure Boot-nøglerne fylder selv, så antallet findes ved at prøve:
            # det største N der kan være, minus de pladser der skal stå tomme.
            n=260
            until fyld_vars "$kilde" "$n" 2>/dev/null; do
                n=$((n - 1))
                [ "$n" -gt 0 ] || { echo "Kunne ikke fylde UEFI-lageret" >&2; exit 1; }
            done
            n=$((n - fyld))
            fyld_vars "$kilde" "$n"
            echo "UEFI-lageret er fyldt med $n×1 KB."
        fi
        koer_qemu 1
        ;;
    genstart-fra-disk)
        behoev
        monitor quit >/dev/null 2>&1 || true
        sleep 1
        koer_qemu 0
        ;;
    hentlog)
        # Den installerede disk beholdes; nøglen sættes i igen med "Hent
        # fejllog" som standardvalg. Resultatet læses bagefter med
        # mdir/mtype -i vm/usb.img@@1M ::/fejllog
        behoev
        monitor quit >/dev/null 2>&1 || true
        sleep 1
        ret_grub 's/^set default=.*/set default=hentlog/'
        koer_qemu 1
        ;;
    skaerm)
        fil=${2:?Angiv filnavn}
        monitor "screendump $fil -f png" >/dev/null
        echo "$fil"
        ;;
    tast)
        shift
        for t in "$@"; do monitor "sendkey $t" >/dev/null; sleep 0.2; done
        ;;
    fjern-usb)
        monitor "device_del usbdev"
        ;;
    fjern-disk)
        # Som en NVMe-disk, der dør: al I/O fejler. Med errors=panic i fstab
        # panikker kernen, gemmer dumpet i pstore og genstarter efter 10 s.
        monitor "device_del nvme0"
        ;;
    saet-disk)
        # Sæt disken i igen (inden de 10 sekunder), så PC'en kan boote fra den.
        monitor "device_add $NVME_DEV"
        ;;
    stop)
        monitor quit >/dev/null 2>&1 || true
        ;;
    *)
        sed -n '2,30p' "$0"
        exit 1
        ;;
esac
