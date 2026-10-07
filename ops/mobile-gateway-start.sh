#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export BHAI_MOBILE_GATEWAY_HOST="${BHAI_MOBILE_GATEWAY_HOST:-::}"
export BHAI_MOBILE_GATEWAY_PORT="${BHAI_MOBILE_GATEWAY_PORT:-19180}"
export BHAI_MOBILE_GATEWAY_TOKEN_FILE="${BHAI_MOBILE_GATEWAY_TOKEN_FILE:-$HOME/.config/bhai/mobile-gateway-key}"
export BHAI_LOCAL_ENGINE_KEY_FILE="${BHAI_LOCAL_ENGINE_KEY_FILE:-$HOME/.config/bhai/engine-key}"
export BHAI_LOCAL_ENGINE_URL="${BHAI_LOCAL_ENGINE_URL:-http://127.0.0.1:18080}"

[[ -r "$BHAI_MOBILE_GATEWAY_TOKEN_FILE" ]] || {
  echo "Missing gateway token file: $BHAI_MOBILE_GATEWAY_TOKEN_FILE" >&2
  exit 1
}
[[ -r "$BHAI_LOCAL_ENGINE_KEY_FILE" ]] || {
  echo "Missing local engine key file: $BHAI_LOCAL_ENGINE_KEY_FILE" >&2
  exit 1
}

exec node "$ROOT/mobile-gateway/server.mjs"
