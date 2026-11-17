#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# ensure-env.sh — sikrer at .env (ved siden af docker-compose.yml) indeholder
# alle nødvendige hemmeligheder, HELT automatisk. Køres før "docker compose up".
#
# Princip:
#   1. Rører aldrig en værdi der allerede står i .env (idempotent). Har .env
#      alle værdierne, ændres filen slet ikke — det er det almindelige deploy.
#   2. For værdier der SKAL være stabile (MySQL-adgangskoder, badminton-JWT):
#      genskabes den nuværende værdi fra containeren, så en allerede
#      initialiseret database bliver ved med at forbinde. Findes containeren
#      ikke, og der heller ikke er en database (frisk installation), genereres
#      en stærk tilfældig værdi.
#   3. Kan en stabil værdi hverken findes i .env eller genskabes, men der
#      findes en database, STOPPER scriptet, før noget er ændret: .env skrives
#      først, når alle værdier er på plads.
#   4. For football-hemmeligheder genereres altid en frisk tilfældig værdi hvis
#      de mangler — football-db-init retter selv DB-brugeren, og et nyt JWT
#      betyder blot at football-admins skal logge ind igen én gang.
#
# JWT_SECRET (nr. 21c) er ikke kun login-nøglen: de gemte hemmeligheder
# (klubbernes YouTube-forbindelse, Googles Client secret, Hetzner-nøglen) er
# krypteret med en nøgle afledt af den (backend/config/hemmelig.js). Før fik en
# eksisterende installation stille en ny, når den ikke kunne genskabes — og så
# kunne ingen af dem læses længere. Nu er den "kritisk" som MySQL-koderne.
#
# Resultat: ingen committede standardværdier, og ingen manuel redigering.
# ---------------------------------------------------------------------------
set -eu

# Stå i projektroden (mappen med docker-compose.yml), uanset hvorfra scriptet kaldes
cd "$(dirname "$0")/.."
ENV_FILE=.env

# Ændringerne samles i en arbejdskopi; .env selv skrives kun til sidst, og kun
# hvis noget faktisk mangler. Et STOP undervejs efterlader .env, som den var
# (eller fraværende, som den var).
ARBEJD=".env.ensure.$$"
trap 'rm -f "$ARBEJD" "$ARBEJD.tmp"' EXIT
trap 'exit 1' INT TERM
# Kun læsbar for ejeren — den indeholder hemmelighederne
(umask 077; if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$ARBEJD"; else : > "$ARBEJD"; fi)

# Sand kun hvis variablen findes MED en ikke-tom værdi (en tom "NAVN=" regenereres)
har_variabel() { grep -qE "^$1=.+" "$ARBEJD"; }

generer() { openssl rand -hex "${1:-24}"; }

# Hent den aktuelle værdi af en env-variabel fra containeren (kørende eller
# stoppet). Tom streng hvis containeren ikke findes, eller variablen ikke er sat.
fra_container() {
    docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
        | sed -n "s/^$2=//p" | head -n1
}

# Findes der allerede en initialiseret database? (data-volume til stede)
# Bruges som sikkerhedsspærre: er databasen der, må vi ALDRIG finde på en ny
# adgangskode — den ville ikke matche den, databasen blev oprettet med.
eksisterende_db() {
    docker volume ls --format '{{.Name}}' 2>/dev/null | grep -q 'mysql_data$'
}

stop_mysql() {
    echo "" >&2
    echo "STOP: Kunne ikke hente $1 fra containeren, men der findes" >&2
    echo "      en eksisterende database. En ny værdi ville låse databasen ude." >&2
    echo "      Sæt $1 manuelt i .env (den nuværende værdi), og kør igen." >&2
    echo "      Intet er ændret." >&2
    exit 1
}

stop_jwt() {
    echo "" >&2
    echo "STOP: JWT_SECRET mangler i .env og kunne ikke hentes fra containeren" >&2
    echo "      badminton-backend, men der findes en eksisterende database." >&2
    echo "" >&2
    echo "      JWT_SECRET er også nøglen til de gemte hemmeligheder (klubbernes" >&2
    echo "      YouTube-forbindelse, Googles Client secret, Hetzner-nøglen). En ny" >&2
    echo "      værdi ville gøre dem ulæselige og logge alle ud." >&2
    echo "" >&2
    echo "      Intet er ændret. Find den gamle .env (fx i en backup af serveren)," >&2
    echo "      læg den på plads, og kør deploy igen." >&2
    echo "" >&2
    echo "      Er den gamle nøgle tabt for altid, kan du bevidst tage en ny:" >&2
    echo "          NY_JWT_SECRET=ja ./deploy.sh" >&2
    echo "      Så skal alle logge ind igen, og klubberne skal forbinde YouTube" >&2
    echo "      igen; super-admin skal indtaste Client secret og Hetzner-nøglen igen." >&2
    exit 1
}

# tilfoej <ENV_NAVN> <container|-> <container_var|-> <laengde> <kritisk>
#   Rækkefølge: 1) findes den allerede i .env → rør den ikke.
#              2) genskab den nuværende værdi fra containeren (intet ændres).
#              3) kun hvis den ikke kunne genskabes: generér en ny.
#   kritisk=mysql (MySQL-adgangskoder) / kritisk=jwt (JWT_SECRET): en forkert
#     værdi ville låse databasen ude / gøre de krypterede værdier ulæselige, så
#     hvis den ikke kan genskabes OG der findes en database, STOPPER vi hellere
#     end at gætte. kritisk=0: en ny værdi er ufarlig (self-healing / re-login).
tilfoej() {
    navn=$1; container=$2; cvar=$3; laengde=$4; kritisk=${5:-0}
    if har_variabel "$navn"; then
        echo "  = $navn findes allerede — uændret"
        return 0
    fi
    vaerdi=""
    if [ "$container" != "-" ]; then
        vaerdi=$(fra_container "$container" "$cvar" || true)
        [ -n "$vaerdi" ] && echo "  ~ $navn genskabt fra containeren (uændret)"
    fi
    if [ -z "$vaerdi" ]; then
        if [ "$kritisk" != "0" ] && eksisterende_db; then
            if [ "$kritisk" = "jwt" ]; then
                if [ "${NY_JWT_SECRET:-}" = "ja" ]; then
                    echo "  ! JWT_SECRET: ny nøgle efter ønske (NY_JWT_SECRET=ja) — gemte hemmeligheder skal indtastes igen"
                else
                    stop_jwt
                fi
            else
                stop_mysql "$navn"
            fi
        fi
        vaerdi=$(generer "$laengde")
        echo "  + $navn genereret (ny tilfældig værdi)"
    fi
    # Fjern en evt. eksisterende tom "NAVN="-linje, så der kun står én definition
    if grep -q "^$navn=" "$ARBEJD"; then
        grep -v "^$navn=" "$ARBEJD" > "$ARBEJD.tmp" && mv "$ARBEJD.tmp" "$ARBEJD"
    fi
    printf '%s=%s\n' "$navn" "$vaerdi" >> "$ARBEJD"
}

echo "Sikrer hemmeligheder i $(pwd)/$ENV_FILE ..."

# Alle fem genskabes fra containerne, så INTET password ændres på en
# eksisterende installation — vi skriver bare de nuværende værdier ned i .env.
# På en frisk installation (ingen containere, ingen database) genereres de.
# NB: inde i football-containeren hedder variablerne DB_PASSWORD / JWT_SECRET.
tilfoej MYSQL_ROOT_PASSWORD  badminton-mysql   MYSQL_ROOT_PASSWORD 24 mysql
tilfoej MYSQL_PASSWORD       badminton-mysql   MYSQL_PASSWORD      24 mysql
tilfoej JWT_SECRET           badminton-backend JWT_SECRET         32 jwt
tilfoej FOOTBALL_DB_PASSWORD football-backend  DB_PASSWORD        24 0
tilfoej FOOTBALL_JWT_SECRET  football-backend  JWT_SECRET         32 0

# Alt er på plads: skriv kun .env, hvis noget er ændret. "cat >" bevarer den
# eksisterende fils ejer og rettigheder.
if [ -f "$ENV_FILE" ] && cmp -s "$ARBEJD" "$ENV_FILE"; then
    echo "Færdig. .env var allerede komplet — uændret."
else
    cat "$ARBEJD" > "$ENV_FILE"
    echo "Færdig. .env er komplet."
fi
