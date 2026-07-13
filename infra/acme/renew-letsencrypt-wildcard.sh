#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${ACME_DOMAIN:-personal-agent.local}"
ACME_HOME="${ACME_HOME:-/root/.acme.sh}"
ACME_BIN="${ACME_BIN:-$ACME_HOME/acme.sh}"
ACME_CREDENTIALS_FILE="${ACME_CREDENTIALS_FILE:-/etc/private-site-edge/acme.env}"
LOCK_DIR="${ACME_RENEW_LOCK_DIR:-/run/lock/personal-agent-acme-renew.lock}"

log() {
  if command -v logger >/dev/null 2>&1; then logger -t personal-agent-acme-renew -- "$*"; fi
  printf '[acme-renew] %s\n' "$*"
}

[[ "$(id -u)" == "0" ]] || { echo "Run ACME renewal as root." >&2; exit 1; }
[[ -x "$ACME_BIN" ]] || { echo "Missing acme.sh executable: $ACME_BIN" >&2; exit 1; }
[[ -f "$ACME_CREDENTIALS_FILE" ]] || { echo "Missing Aliyun ACME credential file." >&2; exit 1; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Another renewal is already running; skipping this trigger."
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

set -a
# shellcheck disable=SC1090
source "$ACME_CREDENTIALS_FILE"
set +a
if [[ -z "${Ali_Key:-}" || -z "${Ali_Secret:-}" ]]; then
  echo "Aliyun ACME credentials are incomplete." >&2
  exit 1
fi
export Ali_Key Ali_Secret

if "$ACME_BIN" --cron --home "$ACME_HOME" >/dev/null 2>&1; then
  log "Monthly certificate renewal check completed for $DOMAIN."
else
  log "Monthly certificate renewal check failed for $DOMAIN."
  exit 1
fi
