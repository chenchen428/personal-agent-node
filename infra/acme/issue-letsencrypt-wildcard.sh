#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${ACME_DOMAIN:-personal-agent.local}"
DNS_PROVIDER="${ACME_DNS_PROVIDER:-dns_ali}"
ACME_BIN="${ACME_BIN:-$HOME/.acme.sh/acme.sh}"
ACME_CREDENTIALS_FILE="${ACME_CREDENTIALS_FILE:-/etc/private-site-edge/acme.env}"

if [[ ! -x "$ACME_BIN" ]]; then
  echo "Missing acme.sh executable: $ACME_BIN" >&2
  echo "Install acme.sh first, then export DNS provider credentials for $DNS_PROVIDER." >&2
  exit 1
fi

if [[ -z "${Ali_Key:-}" || -z "${Ali_Secret:-}" ]]; then
  if [[ ! -f "$ACME_CREDENTIALS_FILE" ]]; then
    echo "Missing Aliyun ACME credential file: $ACME_CREDENTIALS_FILE" >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ACME_CREDENTIALS_FILE"
  set +a
fi
if [[ -z "${Ali_Key:-}" || -z "${Ali_Secret:-}" ]]; then
  echo "Aliyun ACME credentials are incomplete." >&2
  exit 1
fi
export Ali_Key Ali_Secret

"$ACME_BIN" --issue \
  --server letsencrypt \
  --dns "$DNS_PROVIDER" \
  -d "$DOMAIN" \
  -d "*.$DOMAIN" \
  --keylength ec-256
