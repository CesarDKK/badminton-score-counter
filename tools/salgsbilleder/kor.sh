#!/bin/bash
# Tager salgssidens skærmbilleder med eksempeldata — se README.md.
# Brug: bash tools/salgsbilleder/kor.sh tv-kamp taeller ...   (én frisk Chromium pr. billede)
set -e
DIR="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"
NET=badminton-app_badminton-network
for navn in "$@"; do
  docker rm -f shotchrome >/dev/null 2>&1 || true
  MSYS_NO_PATHCONV=1 docker run -d --rm --name shotchrome --network $NET --shm-size=1g zenika/alpine-chrome:124 \
    --no-sandbox --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222 --remote-allow-origins=* \
    --hide-scrollbars --font-render-hinting=none about:blank >/dev/null
  IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' shotchrome)
  for i in 1 2 3 4 5 6 7 8 9 10; do
    MSYS_NO_PATHCONV=1 docker run --rm --network $NET node:22-alpine wget -qO- http://$IP:9222/json/version >/dev/null 2>&1 && break
    sleep 1
  done
  MSYS_NO_PATHCONV=1 docker run --rm --network $NET -v "$DIR:/s" -w /s node:22-alpine node driver.mjs $IP $navn
  docker rm -f shotchrome >/dev/null 2>&1 || true
done
