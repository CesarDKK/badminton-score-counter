#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# cloud-test-deploy.sh — starter en TEST-installation af hele docker-compose-
# opsætningen inde i en Claude Code cloud-session, så ændringer kan ses og
# klikkes igennem før de deployes i prod på badmintonapp.dk.
#
# Bruges KUN i cloud-sessionen. På en rigtig server bruges deploy.sh.
#
# Hvad scriptet klarer, som et almindeligt "docker compose up" ikke kan derinde:
#   1. Starter Docker-motoren (kører ikke af sig selv) med Googles spejl af
#      Docker Hub, fordi Docker Hub ofte svarer 429 (for mange forespørgsler).
#   2. Al trafik ud går gennem sessionens proxy, som omkrypterer TLS med sit
#      eget CA. Byggetrinnene (apk, npm, pip) får derfor proxyen som build-args
#      og bygger på lokale kopier af base-images, der stoler på proxyens CA.
#      Selve repoets Dockerfiler og docker-compose.yml røres ikke.
#   3. Kan et image ikke bygges (fx football-backend, hvis codeload.github.com
#      er blokeret), springes det over, og resten startes alligevel.
#
# Brug:  bash scripts/cloud-test-deploy.sh          # byg og start
#        bash scripts/cloud-test-deploy.sh down     # stop og slet test-data
# Åbn bagefter http://localhost:8080 (admin-adgangskode: admin123).
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

ARBEJD=${TMPDIR:-/tmp}/badminton-cloud-test
CA=/root/.ccr/ca-bundle.crt
mkdir -p "$ARBEJD"

if [ "${1:-}" = "down" ]; then
    docker compose down -v
    exit 0
fi

# --- 1. Docker-motoren ------------------------------------------------------
if [ ! -f /etc/docker/daemon.json ]; then
    mkdir -p /etc/docker
    echo '{"registry-mirrors":["https://mirror.gcr.io"]}' > /etc/docker/daemon.json
fi
if ! docker info >/dev/null 2>&1; then
    echo "Starter Docker ..."
    nohup dockerd > "$ARBEJD/dockerd.log" 2>&1 &
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info >/dev/null 2>&1 || { echo "Docker startede ikke — se $ARBEJD/dockerd.log"; exit 1; }
fi

# --- 2. Hemmeligheder (.env er i .gitignore) --------------------------------
sh scripts/ensure-env.sh

# --- 3. Base-images der stoler på proxyens CA ------------------------------
OVERRIDE=()
if [ -f "$CA" ] && [ -n "${HTTPS_PROXY:-}" ]; then
    cp "$CA" "$ARBEJD/proxy-ca.crt"
    cat > "$ARBEJD/Dockerfile.ca" <<'EOF'
ARG BASE
FROM ${BASE}
COPY proxy-ca.crt /tmp/proxy-ca.crt
RUN cat /tmp/proxy-ca.crt >> /etc/ssl/certs/ca-certificates.crt && rm /tmp/proxy-ca.crt
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt PIP_CERT=/etc/ssl/certs/ca-certificates.crt
LABEL dk.badmintonapp.cloud-ca=1
EOF
    for base in node:22-alpine python:3.12-slim; do
        if [ "$(docker image inspect -f '{{index .Config.Labels "dk.badmintonapp.cloud-ca"}}' "$base" 2>/dev/null)" != "1" ]; then
            echo "Forbereder $base med proxyens CA ..."
            docker pull -q "$base" >/dev/null
            docker build -q --build-arg BASE="$base" -t "$base" -f "$ARBEJD/Dockerfile.ca" "$ARBEJD" >/dev/null
        fi
    done

    # Byg med værtens netværk (proxyen lytter på 127.0.0.1) og proxy-variabler
    {
        echo "services:"
        for s in backend frontend football-backend football-frontend stats-backend planner-solver; do
            cat <<EOF
  $s:
    build:
      network: host
      args:
        HTTPS_PROXY: "$HTTPS_PROXY"
        https_proxy: "$HTTPS_PROXY"
        NO_PROXY: "${NO_PROXY:-}"
        no_proxy: "${NO_PROXY:-}"
EOF
        done
    } > "$ARBEJD/compose.cloud.yml"
    OVERRIDE=(-f docker-compose.yml -f "$ARBEJD/compose.cloud.yml")
fi

# --- 4. Byg hvert image for sig, så ét blokeret ikke stopper resten --------
MANGLER=()
for s in backend stats-backend planner-solver frontend football-frontend football-backend; do
    echo "Bygger $s ..."
    if ! docker compose "${OVERRIDE[@]}" build "$s" > "$ARBEJD/build-$s.log" 2>&1; then
        echo "  ! $s kunne ikke bygges — se $ARBEJD/build-$s.log"
        MANGLER+=("$s")
    fi
done

# --- 5. Start --------------------------------------------------------------
if [ ${#MANGLER[@]} -eq 0 ]; then
    docker compose up -d --no-build
else
    for m in "${MANGLER[@]}"; do
        case $m in backend|frontend|stats-backend) echo "Kerne-service $m mangler — stopper."; exit 1;; esac
    done
    # football-frontend afhænger af football-backend; start frontends uden afhængigheder
    docker compose up -d --no-build mysql backend stats-backend planner-solver
    docker compose up -d --no-build --no-deps football-frontend frontend
fi

echo "Venter på at backenden er klar ..."
for _ in $(seq 1 60); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' badminton-backend 2>/dev/null)" = healthy ] && break
    sleep 2
done
docker compose ps --format 'table {{.Service}}\t{{.Status}}'
[ ${#MANGLER[@]} -gt 0 ] && echo "Sprunget over: ${MANGLER[*]}"
echo ""
echo "Testinstallation kører på http://localhost:8080 (admin: admin123)"
