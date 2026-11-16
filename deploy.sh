#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# deploy.sh — det ENESTE du behøver køre for at deploye.
#
#   1. Sikrer at .env har alle hemmeligheder (genskaber/genererer efter behov).
#   2. Bygger og starter alle containere — med commit og byggetidspunkt, som
#      super-admin viser under Serverens helbred.
#   3. Venter på, at backenden svarer sundt (højst 60 s), og siger tydeligt
#      fra, hvis den ikke gør.
#   4. Rydder gamle, ubrugte images (kun "dangling" — aldrig volumes eller data).
#
# Ingen manuel redigering af .env. Sikker at køre igen og igen.
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"

sh scripts/ensure-env.sh

# Versionen, der bygges: commit (+ændret, hvis der er lokale ændringer i
# sporede filer) og tidspunktet. Bygges ind i backend-imaget (Dockerfile.backend);
# backenden kalder aldrig git. safe.directory: mappen kan være ejet af en anden
# bruger end den, der kører scriptet.
g() { git -c safe.directory="$PWD" "$@"; }
GIT_SHA="$(g rev-parse --short=12 HEAD 2>/dev/null || echo ukendt)"
if [ "$GIT_SHA" != "ukendt" ] && [ -n "$(g status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
    GIT_SHA="$GIT_SHA+ændret"
fi
BUILD_TIME="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
export GIT_SHA BUILD_TIME

echo ""
echo "Starter containere (version $GIT_SHA, bygget $BUILD_TIME) ..."
docker compose up -d --build

# Backenden er sund, når opstarten er færdig: databasen svarer, migrationerne
# er kørt, og baggrundsjobbene kører (/health i backend/server.js)
echo ""
echo "Venter på, at backenden svarer sundt (højst 60 s) ..."
VENTET=0
SUND=0
while [ "$VENTET" -lt 60 ]; do
    if docker exec badminton-backend node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" >/dev/null 2>&1; then
        SUND=1
        break
    fi
    sleep 2
    VENTET=$((VENTET + 2))
done

if [ "$SUND" -ne 1 ]; then
    echo ""
    echo "!!! FEJL: backenden svarer ikke sundt efter 60 s."
    echo "!!! Appen virker sandsynligvis IKKE lige nu. De seneste linjer fra backendens log:"
    echo ""
    docker compose logs --tail 40 backend || true
    echo ""
    echo "!!! Send loggen ovenfor videre. Mere af loggen:  docker compose logs --tail 200 backend"
    exit 1
fi
echo "Backenden er sund (efter ca. $VENTET s)."

# Gamle images, som ingen container bruger mere (hvert build efterlader det
# forrige uden navn). Kun dangling images: ingen volumes, ingen data.
echo ""
echo "Rydder gamle images ..."
docker image prune -f || echo "Advarsel: gamle images kunne ikke ryddes (det er ikke farligt)."

echo ""
echo "Deploy færdig: version $GIT_SHA."
