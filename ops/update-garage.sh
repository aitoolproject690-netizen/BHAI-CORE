#!/usr/bin/env bash
set -euo pipefail

GARAGE_ROOT="${GARAGE_ROOT:-/opt/bhai-garage}"
CORE_DIR="$GARAGE_ROOT/BHAI-CORE"
X_DIR="$GARAGE_ROOT/BHAI-AI"

for dir in "$CORE_DIR" "$X_DIR"; do
  [[ -d "$dir/.git" ]] || {
    echo "Missing git checkout: $dir" >&2
    exit 1
  }
done

git -C "$CORE_DIR" checkout --quiet main
git -C "$X_DIR" checkout --quiet main
git -C "$CORE_DIR" pull --ff-only origin main
git -C "$X_DIR" pull --ff-only origin main

(
  cd "$CORE_DIR"
  docker compose -f docker-compose.selfhost.yml up -d --build
)

(
  cd "$X_DIR"
  docker compose -f docker-compose.selfhost.yml up -d --build
)

if [[ -f "$CORE_DIR/.public.env" ]]; then
  (
    cd "$CORE_DIR"
    docker compose --env-file .public.env -f docker-compose.public.yml up -d
  )
fi

echo "BHAI Garage updated."
docker compose -f "$CORE_DIR/docker-compose.selfhost.yml" ps
docker compose -f "$X_DIR/docker-compose.selfhost.yml" ps
