#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Automatisk backup af HELE installationen. Kører i sin egen container
# (badminton-backup) og gentager i en løkke.
#
#   - Alle databaser i én dump (badminton_counter, alle klub-databaser,
#     badminton_master OG football_tournament) via --all-databases.
#   - De uploadede billeder (badminton + football) som tar-arkiv.
#   - Rydder op i backups ældre end BACKUP_RETENTION_DAYS — men kun efter en
#     dump, der er kontrolleret god.
#
# Dumpen kontrolleres, før den tæller som en backup: mysqldump skal være endt
# uden fejl (pipefail — før blev kun gzips udfald set, så en tom dump blev meldt
# som "færdig"), den pakkede fil skal kunne læses, have en rimelig størrelse og
# slutte med mysqldumps "Dump completed". Fejler den, slettes de gamle IKKE.
#
# Udfaldet skrives i status.json i backup-mappen. Backenden læser den
# (config/fuldBackup.js), og super-admin viser "Fuld backup" under Serverens
# helbred — så en backup, der er holdt op med at virke, kan ses.
#
# Adgangskoden lægges i en beskyttet ~/.my.cnf, så den aldrig står på en
# kommandolinje (synlig i procesliste/`docker inspect`).
#
# BACKUP_EEN_GANG=1: tag én backup og afslut (0 = god dump) — til afprøvning.
# ---------------------------------------------------------------------------
set -uo pipefail

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
# En dump af alle databaser fylder mange MB; under dette er den ikke rigtig
MIN_BYTES="${BACKUP_MIN_BYTES:-20000}"
DEST="${BACKUP_DEST:-/backups}"

# Credentials-fil i stedet for -p på kommandolinjen
umask 077
cat > /root/.my.cnf <<EOF
[client]
host=${BACKUP_DB_HOST:-mysql}
user=root
password=${MYSQL_ROOT_PASSWORD}
EOF

log() { echo "[backup $(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"; }
iso() { date -u "$@" '+%Y-%m-%dT%H:%M:%SZ'; }
stoerrelse() { stat -c %s "$1" 2>/dev/null || echo 0; }
# Tekst, der kan stå i JSON: uden anførselstegn, backslash og linjeskift
ren() { tr -d '"\\' | tr '\n\r\t' '   ' | cut -c1-300; }

# status.json: seneste kørsel, og den nyeste gode dump, der ligger i mappen
skriv_status() {   # ok(true|false)  fejltekst  uploads_ok(true|false|null)
    local ok="$1" fejl="$2" up_ok="$3" nyeste gode_tid="null" gode_bytes=0 antal
    nyeste="$(ls -1t "$DEST"/db-*.sql.gz 2>/dev/null | head -n 1 || true)"
    if [ -n "$nyeste" ]; then
        gode_tid="\"$(iso -r "$nyeste")\""
        gode_bytes="$(stoerrelse "$nyeste")"
    fi
    antal="$(ls -1 "$DEST"/db-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
    if [ -n "$fejl" ]; then fejl="\"$(printf '%s' "$fejl" | ren)\""; else fejl="null"; fi
    printf '{"tid":"%s","ok":%s,"fejl":%s,"uploadsOk":%s,"senesteGode":%s,"senesteGodeBytes":%s,"antal":%s,"intervalTimer":%s,"beholdDage":%s}\n' \
        "$(iso)" "$ok" "$fejl" "$up_ok" "$gode_tid" "$gode_bytes" "$antal" "$INTERVAL_HOURS" "$RETENTION_DAYS" \
        > "$DEST/status.json.part" && chmod 644 "$DEST/status.json.part" && mv "$DEST/status.json.part" "$DEST/status.json"
}

lav_backup() {
    mkdir -p "$DEST"
    chmod 755 "$DEST"                 # backenden læser status.json (kun den) fra mappen
    rm -f "$DEST"/*.sql.gz.part "$DEST"/*.tar.gz.part   # rester fra en afbrudt kørsel
    ts="$(date -u '+%Y%m%d-%H%M%S')"
    db_fil="$DEST/db-$ts.sql.gz"
    up_fil="$DEST/uploads-$ts.tar.gz"
    tmp="$db_fil.part"
    local fejl="" up_ok="null"

    log "Starter dump af alle databaser → $db_fil"
    if mysqldump --defaults-file=/root/.my.cnf \
            --all-databases --single-transaction --quick \
            --routines --triggers --events \
            2>/tmp/dump.err | gzip > "$tmp"; then
        if ! gzip -t "$tmp" 2>/dev/null; then
            fejl="den pakkede dump er beskadiget (gzip -t)"
        elif [ "$(stoerrelse "$tmp")" -lt "$MIN_BYTES" ]; then
            fejl="dumpen er kun $(stoerrelse "$tmp") bytes — for lille til at være en rigtig dump"
        elif [ "$(gzip -dc "$tmp" | tail -n 5 | grep -c 'Dump completed')" -lt 1 ]; then
            fejl="dumpen slutter ikke med 'Dump completed' — den er afbrudt"
        fi
    else
        fejl="mysqldump fejlede: $(ren < /tmp/dump.err)"
    fi

    if [ -z "$fejl" ]; then
        mv "$tmp" "$db_fil"
        log "Database-dump færdig og kontrolleret ($(du -h "$db_fil" | cut -f1))"
    else
        rm -f "$tmp"
        log "FEJL under database-dump: $fejl — de gamle backups beholdes"
    fi

    # Uploadede billeder — begge volumes hvis de findes
    if [ -d /data ]; then
        log "Arkiverer uploads → $up_fil"
        if tar czf "$up_fil.part" -C /data uploads football_uploads 2>/dev/null; then
            mv "$up_fil.part" "$up_fil"
            up_ok="true"
            log "Uploads-arkiv færdig ($(du -h "$up_fil" | cut -f1))"
        else
            rm -f "$up_fil.part"
            up_ok="false"
            log "Advarsel: kunne ikke arkivere alle uploads (fortsætter)"
        fi
    fi

    # Ryd kun op i gamle backups efter en god dump — ellers ville 14 dages
    # fejlede kørsler stille og roligt slette alle de gode
    if [ -z "$fejl" ]; then
        find "$DEST" -maxdepth 1 -type f \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) \
            -mtime +"$RETENTION_DAYS" -print -delete | while read -r f; do
            log "Slettet gammel backup: $(basename "$f")"
        done
        skriv_status true "" "$up_ok"
        return 0
    fi
    skriv_status false "$fejl" "$up_ok"
    return 1
}

if [ "${BACKUP_EEN_GANG:-}" = "1" ]; then
    lav_backup
    exit $?
fi

log "Backup-service startet (interval ${INTERVAL_HOURS}t, opbevaring ${RETENTION_DAYS} dage)"
while true; do
    lav_backup || true
    sleep "$(( INTERVAL_HOURS * 3600 ))"
done
