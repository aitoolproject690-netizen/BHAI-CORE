#!/usr/bin/env bash
set -euo pipefail

GARAGE_ROOT="${GARAGE_ROOT:-/opt/bhai-garage}"
BACKUP_ROOT="${BACKUP_ROOT:-$GARAGE_ROOT/backups}"
CORE_DIR="$GARAGE_ROOT/BHAI-CORE"
X_DIR="$GARAGE_ROOT/BHAI-AI"
PUBLIC_ENV="$CORE_DIR/.public.env"

need_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "Docker is required." >&2
    exit 1
  }
  docker compose version >/dev/null 2>&1 || {
    echo "Docker Compose v2 is required." >&2
    exit 1
  }
}

need_docker
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

CORE_CONTAINER="$(cd "$CORE_DIR" && docker compose -f docker-compose.selfhost.yml ps -q bhai-core)"
X_DB_CONTAINER="$(cd "$X_DIR" && docker compose -f docker-compose.selfhost.yml ps -q bhai-x-db)"
[[ -n "$CORE_CONTAINER" && -n "$X_DB_CONTAINER" ]] || {
  echo "Core or BHAI-X database container is not running." >&2
  exit 1
}

docker cp "$CORE_CONTAINER:/data/bhai-core-store.json" "$DEST/bhai-core-store.json"
docker exec "$X_DB_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' > "$DEST/bhai-x.sql"

if [[ -f "$PUBLIC_ENV" ]]; then
  PUBLIC_CONTAINER="$(cd "$CORE_DIR" && docker compose --env-file .public.env -f docker-compose.public.yml ps -q caddy || true)"
  if [[ -n "$PUBLIC_CONTAINER" ]]; then
    docker cp "$PUBLIC_CONTAINER:/data" "$DEST/caddy-data"
    docker cp "$PUBLIC_CONTAINER:/config" "$DEST/caddy-config"
  fi
fi

(
  cd "$GARAGE_ROOT"
  tar -czf "$DEST.tar.gz" -C "$BACKUP_ROOT" "$STAMP"
  sha256sum "$DEST.tar.gz" > "$DEST.tar.gz.sha256"
)
rm -rf "$DEST"

echo "Backup created: $DEST.tar.gz"
echo "Checksum: $DEST.tar.gz.sha256"
