# shellcheck shell=bash
# Samler en Badminton TV-PC's fejllog i en mappe (sources, køres ikke selv).
#
# Bruges to steder, så loggen ser ens ud:
#   hentlog   USB-nøglen ("Hent fejllog"): PC'ens disk er monteret på FL_ROD
#   fejllog   PC'en selv, når admin trykker "Hent fejllog" (FL_ROD tom)
#
# I mappen:
#   OVERSIGT.txt              PC, version, alle opstarter — uren afslutning markeret
#   opstart-NNN-<dato>.txt    kernebeskeder + advarsler + slutningen af hver opstart
#   kernenedbrud/             pstore-dumps (kerne-panik), hvis der er nogen
#   kiosk.conf.txt            uden WiFi-kode
#
# Variabler (sættes før fejllog_saml):
#   FL_ROD            roden af systemet, der læses ('' = det kørende system)
#   FL_ANTAL          antal opstarter (standard 15)
#   FL_BTENV          indholdet af badminton-tv.env (A/B-opdateringen), valgfri
#   FL_EKSTRA         ekstra linjer øverst i oversigten, valgfri

FL_ROD=${FL_ROD:-}
FL_ANTAL=${FL_ANTAL:-15}
FL_BTENV=${FL_BTENV:-}
FL_EKSTRA=${FL_EKSTRA:-}

# Journalen: på disken (/var/log/journal). På det kørende system uden fast
# journal (Raspberry Pi: kun i RAM) læses den, journald har.
fl_journal_dir() {
    if [ -d "$FL_ROD/var/log/journal" ]; then
        printf '%s\n' "$FL_ROD/var/log/journal"
    fi
}

jc() {
    local dir
    dir=$(fl_journal_dir)
    if [ -n "$dir" ]; then
        journalctl --directory="$dir" --no-pager "$@" 2>/dev/null
    elif [ -z "$FL_ROD" ]; then
        journalctl --no-pager "$@" 2>/dev/null
    fi
}

fl_har_journal() {
    [ -n "$(fl_journal_dir)" ] || [ -z "$FL_ROD" ]
}

# Endte en opstart med en ordentlig nedlukning? Ellers frøs PC'en, eller
# strømmen blev afbrudt (fx tænd/sluk-knappen holdt inde).
afslutning() {
    if [ -z "$FL_ROD" ] && [ "$1" = 0 ]; then
        echo 'kører nu (loggen er hentet herfra)'
        return
    fi
    # Nyere systemd: "Reached target poweroff.target - System Power Off.";
    # journald slutter altid en ordentlig nedlukning med "Journal stopped"
    if jc -b "$1" -o cat -n 400 | grep -qE 'Journal stopped|System Power Off|System Reboot|System Halt|systemd-shutdown|Powering off|Rebooting'; then
        echo 'lukket ned normalt'
    else
        echo '*** IKKE LUKKET NED — frøs eller mistede strømmen ***'
    fi
}

# fejllog_saml UD BESKRIVELSE NAVN — ét systems oversigt, log og konfiguration.
fejllog_saml() {
    local ud=$1 beskrivelse=$2 navn=$3 pstore=$FL_ROD/var/lib/systemd/pstore
    mkdir -p "$ud"

    # ── Oversigt ──
    {
        printf 'Badminton TV — fejllog hentet %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
        printf 'PC-navn: %s\n' "$navn"
        printf 'System: %s\n' "$beskrivelse"
        printf 'PC: %s %s (%s), BIOS %s %s\n' \
            "$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null)" "$(cat /sys/class/dmi/id/product_version 2>/dev/null)" \
            "$(cat /sys/class/dmi/id/product_name 2>/dev/null || { tr -d '\0' < /proc/device-tree/model; } 2>/dev/null)" \
            "$(cat /sys/class/dmi/id/bios_version 2>/dev/null)" "$(cat /sys/class/dmi/id/bios_date 2>/dev/null)"
        printf 'RAM: %s MB\n' "$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
        printf 'Installeret version: %s\n' "$(cat "$FL_ROD/usr/share/badminton-tv/version" 2>/dev/null || echo ukendt)"
        [ -n "$FL_EKSTRA" ] && printf '%s\n' "$FL_EKSTRA"
        [ -f "$FL_ROD/etc/badminton-tv/installeret" ] && { printf '\n-- Installation og opdateringer --\n'; cat "$FL_ROD/etc/badminton-tv/installeret"; }
        if [ -n "$FL_BTENV" ]; then
            printf '\n-- Automatisk opdatering (badminton-tv.env) --\n%s\n' "$FL_BTENV"
        fi

        if [ -z "$FL_ROD" ]; then
            fl_lige_nu
        fi

        printf '\n== Opstarter (nyeste nederst) ==\n'
        printf 'Hver linje: nr., start og slut. En opstart der IKKE er lukket ned normalt,\n'
        printf "er den interessante: PC'ens log stopper der, hvor den frøs.\n\n"
        if fl_har_journal; then
            jc --list-boots | tail -n "$FL_ANTAL" | while read -r nr _id rest; do
                [[ "$nr" =~ ^-?[0-9]+$ ]] || { printf '%s\n' "$nr $_id $rest"; continue; }
                printf '%5s  %s  →  %s\n' "$nr" "$rest" "$(afslutning "$nr")"
            done
            printf '\n== Automatisk opdatering ==\n'
            # (spoerg kører hvert 2. minut — systemd's egne start/stop-linjer for den udelades)
            jc -u badminton-tv-opdatering.service -u badminton-tv-opdatering-bekraeft.service \
                -u badminton-tv-opdatering-spoerg.service -o short-iso -n 2000 \
                | grep -v -e '^-- ' -e 'spørg serveren, om' -e 'opdatering-spoerg.service: ' \
                | tail -n 60 | grep . || printf 'ingen\n'
        else
            printf "Ingen log fundet på PC'ens disk (/var/log/journal mangler).\n"
        fi

        printf '\n== Disk ==\n'
        df -h "${FL_ROD:-/}" 2>/dev/null
        printf '\n== Kernenedbrud (pstore) ==\n'
        ls -la "$pstore" 2>/dev/null || printf 'ingen\n'
        # Årsagen står inde i dumpet: panik-linjen og browser-vagtens egne linjer
        # (diskfejlene, den gentog lige før panikken). Hele dumpet ligger i kernenedbrud/.
        # Dumpet ligger i flere dele, så sortér på kernens tidsstempel "[  287.37]".
        grep -rhsE 'Kernel panic - not syncing|browservagt:' "$pstore" 2>/dev/null \
            | sort -t '[' -k2,2n | awk '!set[$0]++' | head -60 | sed 's/^/  /'
        printf '\n== Hardware ==\n'
        lspci -nn 2>/dev/null | grep -iE 'vga|display|network|ethernet|wireless'

        fl_kameraer
    } > "$ud/OVERSIGT.txt"

    # ── Hver opstart ──
    if fl_har_journal; then
        # --list-boots: "IDX BOOT-ID UGEDAG DATO TID ZONE …" (evt. med overskrift)
        jc --list-boots | tail -n "$FL_ANTAL" | awk '$1 ~ /^-?[0-9]+$/ { print $1, $4 }' | while read -r nr start; do
            fil=$(printf '%s/opstart-%03d-%s.txt' "$ud" "$(( -nr ))" "${start:-ukendt}")
            {
                printf 'Opstart %s: %s\n\n' "$nr" "$(afslutning "$nr")"
                printf '== Advarsler og fejl (alle) ==\n'
                jc -b "$nr" -p warning -o short-iso
                printf '\n== Kernen (alle beskeder) ==\n'
                jc -b "$nr" -k -o short-iso
                printf '\n== De sidste 600 linjer før opstarten sluttede ==\n'
                printf "(frøs PC'en, er det her, sporet er)\n"
                jc -b "$nr" -o short-iso -n 600
            } > "$fil"
        done
    fi

    # ── Kernenedbrud og konfiguration ──
    if [ -d "$pstore" ] && [ -n "$(ls -A "$pstore" 2>/dev/null)" ]; then
        cp -r "$pstore" "$ud/kernenedbrud" 2>/dev/null
    fi
    if [ -f "$FL_ROD/etc/badminton-tv/kiosk.conf" ]; then
        grep -v '^[[:space:]]*WIFI_KODE' "$FL_ROD/etc/badminton-tv/kiosk.conf" > "$ud/kiosk.conf.txt"
        printf '# WIFI_KODE er fjernet\n' >> "$ud/kiosk.conf.txt"
    fi
    fejllog_rens "$ud"
}

# Livestreamens kamera: hvad streamen valgte (journalen) — og på det kørende
# system alle videonoder, deres links og hvad kernen siger, de kan. Kameraer med
# to UVC-interfaces (billede + Windows Hello-IR) kan dele et by-id-link, så det
# afgørende er nodernes interface og "Device Caps" (Video vs. Metadata Capture).
fl_kameraer() {
    printf '\n== Kameraer ==\n'
    if fl_har_journal; then
        printf 'Livestreamens kameravalg (seneste):\n'
        jc -u badminton-tv-stream.service -o short-iso -n 5000 \
            | grep -E 'videonoder:|kamera:|kameraet |intet USB-kamera|springes over|prøvebillede|valgt i admin|kameravalget|kan: ' \
            | tail -n 30 | sed 's/^/  /' | grep . || printf '  intet\n'
    fi
    [ -z "$FL_ROD" ] || return 0
    local d n v
    for d in /dev/v4l/by-id /dev/v4l/by-path; do
        printf '\n%s:\n' "$d"
        find "$d" -mindepth 1 -maxdepth 1 -printf '  %f -> %l\n' 2>/dev/null | sort | grep . || printf '  (ingen)\n'
    done
    printf '\nv4l2-ctl --list-devices:\n'
    timeout 5 v4l2-ctl --list-devices 2>&1 | head -n 40 | sed 's/^/  /'
    for n in /dev/video*; do
        if [ ! -e "$n" ]; then printf '\ningen /dev/video*\n'; break; fi
        v=/sys/class/video4linux/${n##*/}
        printf '\n%s: %s | interface: %s | bInterfaceNumber: %s | index: %s\n' "$n" \
            "$(cat "$v/name" 2>/dev/null)" "$(cat "$v/device/interface" 2>/dev/null)" \
            "$(cat "$v/device/bInterfaceNumber" 2>/dev/null)" "$(cat "$v/index" 2>/dev/null)"
        timeout 5 v4l2-ctl -d "$n" --info 2>&1 \
            | awk '/Bus info|Device Caps/ { p = 1; print; next } p && /^\t\t/ { print; next } { p = 0 }' | sed 's/^\s*/  /'
        timeout 5 v4l2-ctl -d "$n" --list-formats-ext 2>&1 | grep -E "\[[0-9]+\]: |Size: " | head -n 12 | sed 's/^\s*/  /'
    done
    return 0
}

# Kun på det kørende system: tilstanden lige nu (frøs skærmen, men PC'en kører,
# står det her — og varme og drosling, hvis den er for varm)
fl_lige_nu() {
    printf '\n== Lige nu ==\n'
    printf 'Oppe: %s\n' "$(uptime -p 2>/dev/null)"
    printf 'Belastning: %s\n' "$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
    free -m 2>/dev/null
    printf '\nTjenester:\n'
    local s
    for s in badminton-tv badminton-tv-browservagt badminton-tv-stream; do
        printf '  %-28s %s\n' "$s" "$(systemctl is-active "$s.service" 2>/dev/null)"
    done
    printf '\nFejlede tjenester:\n'
    systemctl --failed --no-legend --no-pager 2>/dev/null | sed 's/^/  /' | grep . || printf '  ingen\n'
    printf '\nTemperaturer:\n'
    local z
    for z in /sys/class/thermal/thermal_zone*; do
        [ -r "$z/temp" ] || continue
        printf '  %-20s %s °C\n' "$(cat "$z/type" 2>/dev/null)" "$(awk '{ printf "%.0f", $1 / 1000 }' "$z/temp" 2>/dev/null)"
    done
    command -v vcgencmd >/dev/null 2>&1 && printf '  Pi-drosling: %s\n' "$(vcgencmd get_throttled 2>/dev/null)"
    return 0
}

# Adgangslinkets kode må ikke stå i loggen (TV_URL står i browserens
# kommandolinje og i fejlbeskeder): .../t/<kode> → .../t/<adgangslink>
fejllog_rens() {
    find "$1" -type f -name '*.txt' -exec sed -i -E \
        -e 's#/t/[A-Za-z0-9_-]{8,128}#/t/<adgangslink>#g' \
        -e 's#(X-Adgangslink:)[[:space:]]*[A-Za-z0-9_-]+#\1 <adgangslink>#g' \
        -e 's#(WIFI_KODE=).*#\1<fjernet>#' {} +
}
