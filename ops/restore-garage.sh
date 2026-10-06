#!/usr/bin/env bash
set -euo pipefail

GARAGE_ROOT="${GARAGE_ROOT:-/opt/bhai-garage}"
CORE_DIR="$GARAGE_ROOT/BHAI-CORE"
X_DIR="$GARAGE_ROOT/BHAI-AI"
PUBLIC_ENV="$CORE_DIR/.public.env"

ARCHIVE="${1:-}"
[[ -f "$ARCHIVE" ]] || {
  echo "Usage: $0 /path/to/backup.tar.gz" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 is required." >&2
  exit 1
}

umask 077
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"

BACKUP_DIR="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "$BACKUP_DIR" ]] || {
  echo "Backup archive layout is invalid." >&2
  exit 1
}

CORE_CONTAINER="$(cd "$CORE_DIR" && docker compose -f docker-compose.selfhost.yml ps -q bhai-core)"
X_DB_CONTAINER="$(cd "$X_DIR" && docker compose -f docker-compose.selfhost.yml ps -q bhai-x-db)"
[[ -n "$CORE_CONTAINER" && -n "$X_DB_CONTAINER" ]] || {
  echo "Core and BHAI-X database containers must exist before restore." >&2
  exit 1
}

echo "Stopping Core before restoring its persistent store..."
(
  cd "$CORE_DIR"
  docker compose -f docker-compose.selfhost.yml stop bhai-core
)

NEW_CORE_CONTAINER="$(cd "$CORE_DIR" && docker compose -f docker-compose.selfhost.yml ps -aq bhai-core)"
if [[ -n "$NEW_CORE_CONTAINER" ]]; then
  docker cp "$BACKUP_DIR/bhai-core-store.json" "$NEW_CORE_CONTAINER:/data/bhai-core-store.json"
else
  CORE_MOUNT_TARGET="$(cd "$CORE_DIR" && docker compose -f docker-compose.selfhost.yml create bhai-core >/dev/null 2>&1; docker compose -f docker-compose.selfhost.yml ps -aq bhai-core)"
  docker cp "$BACKUP_DIR/bhai-core-store.json" "$CORE_MOUNT_TARGET:/data/bhai-core-store.json"
fi

(
  cd "$CORE_DIR"
  docker compose -f docker-compose.selfhost.yml start bhai-core
)

echo "Restoring BHAI-X PostgreSQL state..."
cat "$BACKUP_DIR/bhai-x.sql" | docker exec -i "$X_DB_CONTAINER" psql -U "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$X_DB_CONTAINER" | awk -F= '$1=="POSTGRES_USER"{print $2; exit}')" -d "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$X_DB_CONTAINER" | awk -F= '$1=="POSTGRES_DB"{print $2; exit}')"

if [[ -f "$PUBLIC_ENV" && -d "$BACKUP_DIR/caddy-data" && -d "$BACKUP_DIR/caddy-config" ]]; then
  (
    cd "$CORE_DIR"
    docker compose --env-file .public.env -f docker-compose.public.yml run --rm --no-deps       -v "$BACKUP_DIR:/restore:ro"       --entrypoint sh caddy       -c 'cp -a /restore/caddy-data/. /data/ && cp -a /restore/caddy-config/. /config/'
  )
fi

echo "Restore completed. Verify container health before reopening traffic."
