#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

git fetch origin
git checkout main
git pull --ff-only origin main
# shared-postgres deployments (docker-compose.nuc.yml) have no db service
if docker compose config --services | grep -qx db; then
  docker compose up -d --build db
fi
# `run` waits for db's healthcheck via depends_on before applying migrations
docker compose run --rm --build poller npm run migrate
docker compose up -d --build
