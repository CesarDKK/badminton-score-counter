#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# deploy.sh — det ENESTE du behøver køre for at deploye.
#
#   1. Sikrer at .env har alle hemmeligheder (genskaber/genererer efter behov).
#   2. Bygger og starter alle containere og skriver commit og tidspunkt i
#      deploy-info/, som super-admin viser under Serverens helbred. Backenden
#      genstartes kun, når dens image er ændret (nr. 110).
#   3. Venter på, at backenden svarer sundt (højst 120 s), og siger tydeligt
#      fra, hvis den ikke gør.
#   4. Rydder gamle, ubrugte images (kun "dangling" — aldrig volumes eller data).
#
# Ingen manuel redigering af .env. Sikker at køre igen og igen.
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"

sh scripts/ensure-env.sh

# Versionen, der deployes: commit (+ændret, hvis der er lokale ændringer i
# sporede filer) og tidspunktet. Skrives i deploy-info/version.json, som er
# monteret skrivebeskyttet i backenden (docker-compose.yml) — IKKE bygget ind
# i imaget: så skiftede imaget ved hvert deploy, og backenden blev genstartet
# (nr. 110). Backenden kalder aldrig git. safe.directory: mappen kan være ejet
# af en anden bruger end den, der kører scriptet.
g() { git -c safe.directory="$PWD" "$@"; }
GIT_SHA="$(g rev-parse --short=12 HEAD 2>/dev/null || echo ukendt)"
if [ "$GIT_SHA" != "ukendt" ] && [ -n "$(g status --porcelain --untracked-files=no 2>/dev/null || true)" ]; then
    GIT_SHA="$GIT_SHA+ændret"
fi
DEPLOYET="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Mappen findes før "up" — ellers opretter Docker den selv (ejet af root), og
# så kan versionen ikke skrives. Kan den ikke oprettes, vises bare "ukendt".
mkdir -p deploy-info 2>/dev/null || true

# Backend-containerens id og starttid før og efter — så scriptet kan sige, om
# backenden blev genstartet eller fik lov at køre videre. Kun til beskeden.
backend_id() { docker inspect -f '{{.Id}} {{.State.StartedAt}}' badminton-backend 2>/dev/null || true; }
BACKEND_FOER="$(backend_id)"

echo ""
echo "Starter containere (version $GIT_SHA) ..."
docker compose up -d --build
BACKEND_EFTER="$(backend_id)"

# Versionen til super-admin. Skrives til en ny fil, der så erstatter den gamle
# (backenden ser aldrig en halv fil). Kan den ikke skrives (fx mappen ejet af
# root), fortsætter deployet — super-admin viser så "ukendt".
skriv_version() {
    printf '{"sha":"%s","deployet":"%s"}\n' "$GIT_SHA" "$DEPLOYET" > deploy-info/version.json.ny 2>/dev/null || return 1
    mv -f deploy-info/version.json.ny deploy-info/version.json 2>/dev/null || return 1
}
if ! skriv_version; then
    rm -f deploy-info/version.json.ny 2>/dev/null || true
    echo "Advarsel: versionen kunne ikke skrives i deploy-info/ — super-admin viser \"ukendt\" (det er ikke farligt)."
fi

# Backenden er sund, når opstarten er færdig: databasen svarer, migrationerne
# er kørt, og baggrundsjobbene kører (/health i backend/server.js)
echo ""
# 120 s: efter en genstart af MySQL (fx når dens opsætning er ændret) og
# migrationstjek pr. klub kan opstarten godt tage over et minut — en falsk
# fejlmelding er værre end at vente lidt længere.
MAKS_VENT=120
echo "Venter på, at backenden svarer sundt (højst $MAKS_VENT s) ..."
VENTET=0
SUND=0
while [ "$VENTET" -lt "$MAKS_VENT" ]; do
    if docker exec badminton-backend node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" >/dev/null 2>&1; then
        SUND=1
        break
    fi
    sleep 2
    VENTET=$((VENTET + 2))
    if [ $((VENTET % 10)) -eq 0 ] && [ "$VENTET" -lt "$MAKS_VENT" ]; then
        echo "  venter stadig ... ($VENTET af højst $MAKS_VENT s)"
    fi
done

if [ "$SUND" -ne 1 ]; then
    echo ""
    echo "!!! FEJL: backenden svarer ikke sundt efter $MAKS_VENT s."
    echo "!!! Appen virker sandsynligvis IKKE lige nu. De seneste linjer fra backendens log:"
    echo ""
    docker compose logs --tail 40 backend || true
    echo ""
    echo "!!! Send loggen ovenfor videre. Mere af loggen:  docker compose logs --tail 200 backend"
    exit 1
fi
echo "Backenden er sund (efter ca. $VENTET s)."
if [ -z "$BACKEND_FOER" ]; then
    echo "Backenden blev startet (den kørte ikke før)."
elif [ "$BACKEND_FOER" = "$BACKEND_EFTER" ]; then
    echo "Backenden kørte videre uden genstart (dens image og opsætning var uændret)."
else
    echo "Backenden blev genstartet (dens image eller opsætning var ændret)."
fi

# Den offentlige helbredsadresse gennem nginx (den, overvågningen udefra kalder)
# — kun en advarsel
if docker exec badminton-frontend wget -q -O /dev/null http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "Helbredsadressen /api/health svarer gennem nginx."
else
    echo "Advarsel: /api/health svarer ikke gennem nginx. Appen kan stadig virke — tjek den i browseren."
fi

# Gamle images, som ingen container bruger mere (hvert build efterlader det
# forrige uden navn). Kun dangling images: ingen volumes, ingen data.
echo ""
echo "Rydder gamle images ..."
docker image prune -f || echo "Advarsel: gamle images kunne ikke ryddes (det er ikke farligt)."

echo ""
echo "Deploy færdig: version $GIT_SHA."
