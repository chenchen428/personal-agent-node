#!/usr/bin/env bash
set -euo pipefail

ACME_HOME="${ACME_HOME:-/root/.acme.sh}"
ACME_BIN="${ACME_BIN:-$ACME_HOME/acme.sh}"
ACME_CREDENTIALS_FILE="${ACME_CREDENTIALS_FILE:-/etc/private-site-edge/acme.env}"

if [[ -x "$ACME_BIN" ]]; then
  printf '[acme-install] acme.sh already exists: %s\n' "$ACME_BIN"
  exit 0
fi
if [[ -f "$ACME_CREDENTIALS_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ACME_CREDENTIALS_FILE"
  set +a
fi
if [[ -z "${ACME_EMAIL:-}" ]]; then
  echo "ACME_EMAIL is required to install acme.sh." >&2
  exit 1
fi
command -v curl >/dev/null 2>&1 || { echo "curl is required to install acme.sh." >&2; exit 1; }

curl -fsSL https://get.acme.sh | sh -s "email=$ACME_EMAIL"
[[ -x "$ACME_BIN" ]] || { echo "acme.sh installation did not create $ACME_BIN" >&2; exit 1; }
"$ACME_BIN" --uninstall-cronjob >/dev/null 2>&1 || true
printf '[acme-install] acme.sh installed.\n'
