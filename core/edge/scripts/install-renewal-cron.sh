#!/usr/bin/env bash
set -euo pipefail

CURRENT_ROOT="${PERSONAL_AGENT_CURRENT_ROOT:-/opt/private-site-edge/current}"
CRON_FILE="${PRIVATE_SITE_EDGE_ACME_CRON_FILE:-/etc/cron.d/private-site-edge-acme}"
CRON_SCHEDULE="${PRIVATE_SITE_EDGE_ACME_SCHEDULE:-23 3 * * *}"
SCRIPT="$CURRENT_ROOT/core/edge/scripts/reconcile-certificates.sh"

[[ "$(id -u)" == "0" ]] || { echo "Install the Edge ACME cron as root." >&2; exit 1; }
[[ -f "$SCRIPT" ]] || { echo "Missing Edge ACME reconciliation script: $SCRIPT" >&2; exit 1; }
cron_pattern='^[0-9*,-]+ [0-9*,-]+ [0-9*,-]+ [0-9*,-]+ [0-9*,-]+$'
[[ "$CRON_SCHEDULE" =~ $cron_pattern ]] || { echo "Invalid five-field cron schedule." >&2; exit 1; }

temporary="$(mktemp)"
trap 'rm -f "$temporary"' EXIT
{
  printf 'SHELL=/bin/bash\n'
  printf 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n'
  printf '%s root %s\n' "$CRON_SCHEDULE" "$SCRIPT"
} > "$temporary"
install -m 644 "$temporary" "$CRON_FILE"

if systemctl cat cron.service >/dev/null 2>&1; then
  systemctl enable --now cron.service >/dev/null
elif systemctl cat crond.service >/dev/null 2>&1; then
  systemctl enable --now crond.service >/dev/null
else
  echo "No cron or crond systemd service is available." >&2
  exit 1
fi

printf '[private-site-edge-acme] Installed daily reconciliation at %s.\n' "$CRON_SCHEDULE"
