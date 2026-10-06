#!/usr/bin/env bash
set -euo pipefail

GARAGE_ROOT="${GARAGE_ROOT:-/opt/bhai-garage}"
CORE_DIR="$GARAGE_ROOT/BHAI-CORE"
X_DIR="$GARAGE_ROOT/BHAI-AI"
CORE_REPO="https://github.com/aitoolproject690-netizen/BHAI-CORE.git"
X_REPO="https://github.com/aitoolproject690-netizen/BHAI-AI.git"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

need docker
need git
need openssl

docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 is required." >&2
  exit 1
}

BHAI_DOMAIN="${BHAI_DOMAIN:-}"
if [[ -z "$BHAI_DOMAIN" ]]; then
  read -r -p "Public domain (DNS A/AAAA must point here): " BHAI_DOMAIN
fi

[[ "$BHAI_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || {
  echo "Invalid BHAI_DOMAIN." >&2
  exit 1
}

BHAI_MOBILE_NODE_TOKEN="${BHAI_MOBILE_NODE_TOKEN:-}"
if [[ -z "$BHAI_MOBILE_NODE_TOKEN" ]]; then
  read -r -r -s -p "BHAI Mobile Node token: " BHAI_MOBILE_NODE_TOKEN
  echo
fi

[[ -n "$BHAI_MOBILE_NODE_TOKEN" ]] || {
  echo "A Mobile Node token is required." >&2
  exit 1
}

if [[ -e "$CORE_DIR" || -e "$X_DIR" ]]; then
  echo "Refusing to overwrite an existing Garage checkout at $GARAGE_ROOT." >&2
  echo "Use a new GARAGE_ROOT or remove only after taking a backup." >&2
  exit 1
fi

umask 077
mkdir -p "$GARAGE_ROOT"

git clone --depth=1 "$CORE_REPO" "$CORE_DIR"
git clone --depth=1 "$X_REPO" "$X_DIR"

BOOTSTRAP_KEY="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -hex 24)"
DB_PASSWORD="$(openssl rand -hex 32)"

cat > "$CORE_DIR/.env" <<EOF
BHAI_ENGINE_URL=mobile://local
BHAI_ENGINE_MODEL=smollm2.gguf
BHAI_MOBILE_NODE_TOKEN=$BHAI_MOBILE_NODE_TOKEN
BHAI_CORE_BOOTSTRAP_API_KEY=$BOOTSTRAP_KEY
BHAI_CORE_USERNAME=admin
BHAI_CORE_PASSWORD=$ADMIN_PASSWORD
EOF

cat > "$X_DIR/.env" <<EOF
BHAI_CORE_URL=http://bhai-core:10000
BHAI_CORE_API_KEY=$BOOTSTRAP_KEY
BHAI_X_DB_PASSWORD=$DB_PASSWORD
EOF

cat > "$CORE_DIR/.public.env" <<EOF
BHAI_DOMAIN=$BHAI_DOMAIN
EOF

cat > "$GARAGE_ROOT/credentials.txt" <<EOF
BHAI Garage credentials
=======================
Login: https://$BHAI_DOMAIN/login
Username: admin
Password: $ADMIN_PASSWORD

BHAI-CORE bootstrap API key:
$BOOTSTRAP_KEY
EOF
chmod 600 "$GARAGE_ROOT/credentials.txt"

(
  cd "$CORE_DIR"
  docker compose -f docker-compose.selfhost.yml up -d --build
)

(
  cd "$X_DIR"
  docker compose -f docker-compose.selfhost.yml up -d --build
)

(
  cd "$CORE_DIR"
  docker compose --env-file .public.env -f docker-compose.public.yml up -d
)

echo
echo "BHAI Garage containers started."
echo "Credentials saved at: $GARAGE_ROOT/credentials.txt"
echo "Point DNS for $BHAI_DOMAIN to this host before expecting public HTTPS."
echo
docker compose -f "$CORE_DIR/docker-compose.selfhost.yml" ps
docker compose -f "$X_DIR/docker-compose.selfhost.yml" ps
docker compose --env-file "$CORE_DIR/.public.env" -f "$CORE_DIR/docker-compose.public.yml" ps
