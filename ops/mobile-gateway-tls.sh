#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${BHAI_MOBILE_GATEWAY_STATE_DIR:-$HOME/.config/bhai/mobile-gateway}"
TLS_DIR="${BHAI_MOBILE_GATEWAY_TLS_DIR:-$STATE_DIR/tls}"
CERT_FILE="$TLS_DIR/server.crt"
KEY_FILE="$TLS_DIR/server.key"

die() {
  echo "BHAI-MOBILE-GATEWAY TLS: $*" >&2
  exit 1
}

require_openssl() {
  command -v openssl >/dev/null 2>&1 || die "openssl is required"
}

init() {
  require_openssl
  mkdir -p "$TLS_DIR"
  chmod 700 "$STATE_DIR" "$TLS_DIR"

  if [[ -e "$CERT_FILE" || -e "$KEY_FILE" ]]; then
    die "TLS files already exist; refusing to overwrite"
  fi

  umask 077
  openssl req -x509 -new -newkey ec \
    -pkeyopt ec_paramgen_curve:P-256 \
    -nodes \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -days 3650 \
    -subj "/CN=BHAI-MOBILE-GATEWAY" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth"

  chmod 600 "$KEY_FILE" "$CERT_FILE"

  local fp
  fp="$(openssl x509 -in "$CERT_FILE" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':')"
  echo "BHAI-MOBILE-GATEWAY TLS initialized"
  echo "Fingerprint: $fp"
  echo "Cert: $CERT_FILE"
  echo "Key:  $KEY_FILE"
}

status() {
  require_openssl
  if [[ ! -r "$CERT_FILE" || ! -r "$KEY_FILE" ]]; then
    echo "BHAI-MOBILE-GATEWAY TLS: NOT INITIALIZED"
    exit 1
  fi
  local fp
  fp="$(openssl x509 -in "$CERT_FILE" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':')"
  echo "BHAI-MOBILE-GATEWAY TLS: READY"
  echo "Fingerprint: $fp"
  echo "Cert: $CERT_FILE"
}

case "${1:-status}" in
  init) init ;;
  status|fingerprint) status ;;
  *) echo "usage: $0 {init|status}" >&2; exit 2 ;;
esac
