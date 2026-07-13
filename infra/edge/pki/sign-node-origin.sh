#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" && "${2:-}" && "${3:-}" && "${4:-}" ]] || {
  echo "Usage: sign-node-origin.sh <node-id> <tunnel-ip> <csr-path> <certificate-output>" >&2
  exit 2
}
NODE_ID="$1"
TUNNEL_IP="$2"
CSR_PATH="$3"
OUTPUT="$4"
PKI_DIR="${PRIVATE_SITE_EDGE_PKI_DIR:-/etc/private-site-edge/pki}"
CA_KEY="$PKI_DIR/origin-ca.key"
CA_CERT="$PKI_DIR/origin-ca.crt"
SERVER_NAME="$(printf '%s' "$NODE_ID" | tr '[:upper:]_' '[:lower:]-' | sed 's/[^a-z0-9-]/-/g;s/^-*//;s/-*$//').origin.private-site"

[[ "$(id -u)" == "0" ]] || { echo "Run node certificate signing as root." >&2; exit 1; }
[[ "$NODE_ID" =~ ^[A-Za-z0-9_-]{6,80}$ ]] || { echo "Invalid node ID." >&2; exit 1; }
[[ "$TUNNEL_IP" =~ ^10\.77\.0\.[0-9]{1,3}$ ]] || { echo "Invalid Site tunnel address." >&2; exit 1; }
[[ -f "$CSR_PATH" && -f "$CA_KEY" && -f "$CA_CERT" ]] || { echo "Missing CSR or origin CA." >&2; exit 1; }
openssl req -verify -noout -in "$CSR_PATH" >/dev/null

extensions="$(mktemp)"
trap 'rm -f "$extensions"' EXIT
{
  printf 'basicConstraints=critical,CA:FALSE\n'
  printf 'keyUsage=critical,digitalSignature,keyEncipherment\n'
  printf 'extendedKeyUsage=serverAuth\n'
  printf 'subjectAltName=DNS:%s,IP:%s\n' "$SERVER_NAME" "$TUNNEL_IP"
} > "$extensions"
install -d -m 700 "$(dirname "$OUTPUT")"
openssl x509 -req -sha256 -in "$CSR_PATH" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
  -days 90 -extfile "$extensions" -out "$OUTPUT"
chmod 644 "$OUTPUT"
openssl verify -CAfile "$CA_CERT" "$OUTPUT" >/dev/null
printf '%s\n' "$SERVER_NAME"
