#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# deploy.sh — det ENESTE du behøver køre for at deploye.
#
#   1. Sikrer at .env har alle hemmeligheder (genskaber/genererer efter behov).
#   2. Bygger og starter alle containere.
#
# Ingen manuel redigering af .env. Sikker at køre igen og igen.
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"

sh scripts/ensure-env.sh

echo ""
echo "Starter containere ..."
docker compose up -d --build

echo ""
echo "Deploy færdig."
