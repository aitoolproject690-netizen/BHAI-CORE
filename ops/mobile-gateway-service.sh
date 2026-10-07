#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${BHAI_MOBILE_GATEWAY_STATE_DIR:-$HOME/.config/bhai/mobile-gateway}"
PID_FILE="$STATE_DIR/gateway.pid"
LOG_FILE="$STATE_DIR/gateway.log"

export BHAI_MOBILE_GATEWAY_HOST="${BHAI_MOBILE_GATEWAY_HOST:-::}"
export BHAI_MOBILE_GATEWAY_PORT="${BHAI_MOBILE_GATEWAY_PORT:-19180}"
export BHAI_MOBILE_GATEWAY_TOKEN_FILE="${BHAI_MOBILE_GATEWAY_TOKEN_FILE:-$HOME/.config/bhai/mobile-gateway-key}"
export BHAI_LOCAL_ENGINE_KEY_FILE="${BHAI_LOCAL_ENGINE_KEY_FILE:-$HOME/.config/bhai/engine-key}"
export BHAI_LOCAL_ENGINE_URL="${BHAI_LOCAL_ENGINE_URL:-http://127.0.0.1:18080}"

TLS_DIR="${BHAI_MOBILE_GATEWAY_TLS_DIR:-$HOME/.config/bhai/mobile-gateway/tls}"
if [[ -z "${BHAI_MOBILE_GATEWAY_TLS:-}" ]] && [[ -r "$TLS_DIR/server.crt" ]] && [[ -r "$TLS_DIR/server.key" ]]; then
  export BHAI_MOBILE_GATEWAY_TLS="true"
  export BHAI_MOBILE_GATEWAY_TLS_CERT_FILE="$TLS_DIR/server.crt"
  export BHAI_MOBILE_GATEWAY_TLS_KEY_FILE="$TLS_DIR/server.key"
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

die() {
  echo "BHAI-MOBILE-GATEWAY: $*" >&2
  exit 1
}

running_pid() {
  [[ -r "$PID_FILE" ]] || return 1
  local pid cmd
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  cmd="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$cmd" == *"mobile-gateway/server.mjs"* ]] || return 1
  printf '%s\n' "$pid"
}

start() {
  if pid="$(running_pid)"; then
    echo "BHAI-MOBILE-GATEWAY already running (pid $pid)"
    return 0
  fi

  [[ -r "$BHAI_MOBILE_GATEWAY_TOKEN_FILE" ]] || die "missing gateway token file: $BHAI_MOBILE_GATEWAY_TOKEN_FILE"
  [[ -r "$BHAI_LOCAL_ENGINE_KEY_FILE" ]] || die "missing local engine key file: $BHAI_LOCAL_ENGINE_KEY_FILE"

  rm -f "$PID_FILE"
  nohup node "$ROOT/mobile-gateway/server.mjs" >>"$LOG_FILE" 2>&1 &
  local pid=$!
  printf '%s\n' "$pid" >"$PID_FILE"
  chmod 600 "$PID_FILE" "$LOG_FILE"
  sleep 1

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    tail -n 40 "$LOG_FILE" >&2 || true
    die "gateway failed to start"
  fi
  echo "BHAI-MOBILE-GATEWAY started (pid $pid)"
}

stop() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "$PID_FILE"
    echo "BHAI-MOBILE-GATEWAY already stopped"
    return 0
  fi
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "BHAI-MOBILE-GATEWAY stopped"
}

status() {
  local pid
  if pid="$(running_pid)"; then
    echo "BHAI-MOBILE-GATEWAY RUNNING pid=$pid port=$BHAI_MOBILE_GATEWAY_PORT"
  else
    rm -f "$PID_FILE"
    echo "BHAI-MOBILE-GATEWAY STOPPED"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
