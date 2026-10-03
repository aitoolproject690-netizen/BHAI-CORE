#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$HOME/bhai-mobile"
if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi
exec node "$ROOT/node/bhai-mobile-node.mjs"
