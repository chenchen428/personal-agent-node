#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${ACME_DOMAIN:-personal-agent.local}"
ACME_BIN="${ACME_BIN:-$HOME/.acme.sh/acme.sh}"
CERT_DIR="${ACME_INSTALL_DIR:-/etc/nginx/ssl/$DOMAIN}"
FULLCHAIN_FILE="$CERT_DIR/fullchain.cer"
KEY_FILE="$CERT_DIR/privkey.key"
RELOAD_CMD="${ACME_RELOAD_CMD:-nginx -t && systemctl restart nginx && (systemctl is-active --quiet postfix && systemctl reload postfix || true)}"

if [[ ! -x "$ACME_BIN" ]]; then
  echo "Missing acme.sh executable: $ACME_BIN" >&2
  exit 1
fi

mkdir -p "$CERT_DIR"

"$ACME_BIN" --install-cert --ecc -d "$DOMAIN" \
  --fullchain-file "$FULLCHAIN_FILE" \
  --key-file "$KEY_FILE" \
  --reloadcmd "$RELOAD_CMD"
