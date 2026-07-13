#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${ACME_DOMAIN:-personal-agent.local}"
REMOTE_ROOT="${PERSONAL_AGENT_REMOTE_ROOT:-/opt/private-site-edge}"
CURRENT_ROOT="${PERSONAL_AGENT_CURRENT_ROOT:-$REMOTE_ROOT/current}"
SERVICE_ENV_DIR="${PERSONAL_AGENT_SERVICE_ENV_DIR:-/etc/private-site-edge}"
ACME_CREDENTIALS_FILE="${ACME_CREDENTIALS_FILE:-$SERVICE_ENV_DIR/acme.env}"
ACME_HOME="${ACME_HOME:-/root/.acme.sh}"
ACME_BIN="${ACME_BIN:-$ACME_HOME/acme.sh}"
CRON_FILE="${ACME_CRON_FILE:-/etc/cron.d/personal-agent-acme-renew}"
CRON_SCHEDULE="${ACME_CRON_SCHEDULE:-17 3 1 * *}"

log() {
  printf '[acme-cron] %s\n' "$*"
}

[[ "$(id -u)" == "0" ]] || { echo "Install the ACME cron as root." >&2; exit 1; }
[[ "$CRON_SCHEDULE" =~ ^[0-9*,-]+\ [0-9*,-]+\ [0-9*,-]+\ [0-9*,-]+\ [0-9*,-]+$ ]] || { echo "Invalid five-field ACME cron schedule." >&2; exit 1; }
[[ -f "$ACME_CREDENTIALS_FILE" ]] || { echo "Missing Aliyun ACME credential file: $ACME_CREDENTIALS_FILE" >&2; exit 1; }
[[ "$(stat -c '%a' "$ACME_CREDENTIALS_FILE")" == "600" ]] || { echo "Aliyun ACME credential file must use mode 600." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ACME_CREDENTIALS_FILE"
set +a
if [[ -z "${Ali_Key:-}" || -z "${Ali_Secret:-}" ]]; then
  echo "Aliyun ACME credentials are incomplete." >&2
  exit 1
fi
export Ali_Key Ali_Secret

if [[ ! -x "$ACME_BIN" ]]; then
  ACME_HOME="$ACME_HOME" ACME_BIN="$ACME_BIN" ACME_CREDENTIALS_FILE="$ACME_CREDENTIALS_FILE" \
    bash "$CURRENT_ROOT/infra/acme/install-acme.sh"
fi
"$ACME_BIN" --uninstall-cronjob >/dev/null 2>&1 || true

domain_config="$ACME_HOME/${DOMAIN}_ecc/${DOMAIN}.conf"
if [[ ! -f "$domain_config" ]]; then
  log "No issued wildcard certificate state found; issuing it with Aliyun DNS."
  ACME_BIN="$ACME_BIN" ACME_CREDENTIALS_FILE="$ACME_CREDENTIALS_FILE" \
    bash "$CURRENT_ROOT/infra/acme/issue-letsencrypt-wildcard.sh"
fi

ACME_BIN="$ACME_BIN" ACME_INSTALL_DIR="/etc/nginx/ssl/$DOMAIN" \
  ACME_RELOAD_CMD="nginx -t && systemctl restart nginx" \
  bash "$CURRENT_ROOT/infra/acme/install-cert.sh" >/dev/null

cron_tmp="$(mktemp)"
trap 'rm -f "$cron_tmp"' EXIT
{
  printf 'SHELL=/bin/bash\n'
  printf 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n'
  printf '%s root %s/infra/acme/renew-letsencrypt-wildcard.sh\n' "$CRON_SCHEDULE" "$CURRENT_ROOT"
} > "$cron_tmp"
install -d -m 755 "$(dirname "$CRON_FILE")"
install -m 644 "$cron_tmp" "$CRON_FILE"

if systemctl cat cron.service >/dev/null 2>&1; then
  systemctl enable --now cron.service >/dev/null
elif systemctl cat crond.service >/dev/null 2>&1; then
  systemctl enable --now crond.service >/dev/null
else
  echo "No cron or crond systemd service is available." >&2
  exit 1
fi

log "Installed monthly renewal at $CRON_SCHEDULE; successful certificate updates restart Nginx."
