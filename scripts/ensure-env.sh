#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# ensure-env.sh — sikrer at .env (ved siden af docker-compose.yml) indeholder
# alle nødvendige hemmeligheder, HELT automatisk. Køres før "docker compose up".
#
# Princip:
#   1. Rører aldrig en værdi der allerede står i .env (idempotent).
#   2. For værdier der SKAL være stabile (MySQL-adgangskoder, badminton-JWT):
#      genskabes den nuværende værdi fra den kørende container, så en allerede
#      initialiseret database bliver ved med at forbinde. Kører containeren
#      ikke (frisk installation), genereres en stærk tilfældig værdi.
#   3. For football-hemmeligheder genereres altid en frisk tilfældig værdi hvis
#      de mangler — football-db-init retter selv DB-brugeren, og et nyt JWT
#      betyder blot at football-admins skal logge ind igen én gang.
#
# Resultat: ingen committede standardværdier, og ingen manuel redigering.
# ---------------------------------------------------------------------------
set -eu

# Stå i projektroden (mappen med docker-compose.yml), uanset hvorfra scriptet kaldes
cd "$(dirname "$0")/.."
ENV_FILE=.env
touch "$ENV_FILE"

# Sand kun hvis variablen findes MED en ikke-tom værdi (en tom "NAVN=" regenereres)
har_variabel() { grep -qE "^$1=.+" "$ENV_FILE"; }

generer() { openssl rand -hex "${1:-24}"; }

# Hent den aktuelle værdi af en env-variabel fra en kørende container.
# Tom streng hvis containeren ikke findes/kører, eller variablen ikke er sat.
fra_container() {
    docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
        | sed -n "s/^$2=//p" | head -n1
}

# tilfoej <ENV_NAVN> <container|-> <container_var|-> <laengde>
#   container = "-" betyder: forsøg ikke at genskabe, generér altid
tilfoej() {
    navn=$1; container=$2; cvar=$3; laengde=$4
    if har_variabel "$navn"; then
        echo "  = $navn findes allerede — uændret"
        return 0
    fi
    vaerdi=""
    if [ "$container" != "-" ]; then
        vaerdi=$(fra_container "$container" "$cvar" || true)
        [ -n "$vaerdi" ] && echo "  ~ $navn genskabt fra kørende container"
    fi
    if [ -z "$vaerdi" ]; then
        vaerdi=$(generer "$laengde")
        echo "  + $navn genereret (ny tilfældig værdi)"
    fi
    # Fjern en evt. eksisterende tom "NAVN="-linje, så der kun står én definition
    if grep -q "^$navn=" "$ENV_FILE"; then
        grep -v "^$navn=" "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
    fi
    printf '%s=%s\n' "$navn" "$vaerdi" >> "$ENV_FILE"
}

echo "Sikrer hemmeligheder i $(pwd)/$ENV_FILE ..."

# Stabile værdier — genskabes fra containere så intet brydes
tilfoej MYSQL_ROOT_PASSWORD  badminton-mysql   MYSQL_ROOT_PASSWORD 24
tilfoej MYSQL_PASSWORD       badminton-mysql   MYSQL_PASSWORD      24
tilfoej JWT_SECRET           badminton-backend JWT_SECRET         32

# Football — frisk tilfældig værdi hvis den mangler (self-healing)
tilfoej FOOTBALL_DB_PASSWORD  -  -  24
tilfoej FOOTBALL_JWT_SECRET   -  -  32

echo "Færdig. .env er komplet."
