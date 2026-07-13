#!/usr/bin/env bash
set -euo pipefail

PKI_DIR="${PRIVATE_SITE_EDGE_PKI_DIR:-/etc/private-site-edge/pki}"
CA_KEY="$PKI_DIR/origin-ca.key"
CA_CERT="$PKI_DIR/origin-ca.crt"
EDGE_KEY="$PKI_DIR/edge-client.key"
EDGE_CSR="$PKI_DIR/edge-client.csr"
EDGE_CERT="$PKI_DIR/edge-client.crt"

[[ "$(id -u)" == "0" ]] || { echo "Run origin PKI initialization as root." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required." >&2; exit 1; }
install -d -m 700 "$PKI_DIR"

if [[ ! -f "$CA_KEY" || ! -f "$CA_CERT" ]]; then
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$CA_KEY"
  openssl req -x509 -new -sha256 -key "$CA_KEY" -days 3650 \
    -subj "/CN=Private Site Origin CA" -out "$CA_CERT"
fi
chmod 600 "$CA_KEY"
chmod 644 "$CA_CERT"

if [[ ! -f "$EDGE_KEY" || ! -f "$EDGE_CERT" ]] || ! openssl x509 -checkend 1209600 -noout -in "$EDGE_CERT"; then
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$EDGE_KEY"
  openssl req -new -sha256 -key "$EDGE_KEY" -subj "/CN=private-site-edge" -out "$EDGE_CSR"
  extensions="$(mktemp)"
  trap 'rm -f "$extensions"' EXIT
  {
    printf 'basicConstraints=critical,CA:FALSE\n'
    printf 'keyUsage=critical,digitalSignature\n'
    printf 'extendedKeyUsage=clientAuth\n'
    printf 'subjectAltName=DNS:private-site-edge.origin.private-site\n'
  } > "$extensions"
  openssl x509 -req -sha256 -in "$EDGE_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
    -days 90 -extfile "$extensions" -out "$EDGE_CERT"
  rm -f "$EDGE_CSR"
fi
chmod 600 "$EDGE_KEY"
chmod 644 "$EDGE_CERT"
openssl verify -CAfile "$CA_CERT" "$EDGE_CERT" >/dev/null
printf '[private-site-edge] Origin CA and Edge client identity are ready.\n'
