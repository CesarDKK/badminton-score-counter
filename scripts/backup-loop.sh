#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Automatisk backup af HELE installationen. Kører i sin egen container
# (badminton-backup) og gentager i en løkke.
#
#   - Alle databaser i én dump (badminton_counter, alle klub-databaser,
#     badminton_master OG football_tournament) via --all-databases.
#   - De uploadede billeder (badminton + football) som tar-arkiv.
#   - Rydder op i backups ældre end BACKUP_RETENTION_DAYS.
#
# Adgangskoden lægges i en beskyttet ~/.my.cnf, så den aldrig står på en
# kommandolinje (synlig i procesliste/`docker inspect`).
# ---------------------------------------------------------------------------
set -u

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
DEST="/backups"

# Credentials-fil i stedet for -p på kommandolinjen
umask 077
cat > /root/.my.cnf <<EOF
[client]
host=mysql
user=root
password=${MYSQL_ROOT_PASSWORD}
EOF

log() { echo "[backup $(date -u '+%Y-%m-%d %H:%M:%SZ')] $*"; }

lav_backup() {
    mkdir -p "$DEST"
    ts="$(date -u '+%Y%m%d-%H%M%S')"
    db_fil="$DEST/db-$ts.sql.gz"
    up_fil="$DEST/uploads-$ts.tar.gz"
    tmp="$db_fil.part"

    log "Starter dump af alle databaser → $db_fil"
    if mysqldump --defaults-file=/root/.my.cnf \
            --all-databases --single-transaction --quick \
            --routines --triggers --events \
            2>/tmp/dump.err | gzip > "$tmp"; then
        mv "$tmp" "$db_fil"
        log "Database-dump færdig ($(du -h "$db_fil" | cut -f1))"
    else
        rm -f "$tmp"
        log "FEJL under database-dump: $(tr '\n' ' ' < /tmp/dump.err)"
    fi

    # Uploadede billeder — begge volumes hvis de findes
    if [ -d /data ]; then
        log "Arkiverer uploads → $up_fil"
        if tar czf "$up_fil.part" -C /data uploads football_uploads 2>/dev/null; then
            mv "$up_fil.part" "$up_fil"
            log "Uploads-arkiv færdig ($(du -h "$up_fil" | cut -f1))"
        else
            rm -f "$up_fil.part"
            log "Advarsel: kunne ikke arkivere alle uploads (fortsætter)"
        fi
    fi

    # Ryd op i gamle backups
    find "$DEST" -maxdepth 1 -type f \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) \
        -mtime +"$RETENTION_DAYS" -print -delete | while read -r f; do
        log "Slettet gammel backup: $(basename "$f")"
    done
}

log "Backup-service startet (interval ${INTERVAL_HOURS}t, opbevaring ${RETENTION_DAYS} dage)"
while true; do
    lav_backup
    sleep "$(( INTERVAL_HOURS * 3600 ))"
done
