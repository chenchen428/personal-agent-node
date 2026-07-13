#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-plan}"
[[ "$MODE" == "plan" || "$MODE" == "execute" ]] || { echo "Usage: cleanup-legacy-site.sh <plan|execute>" >&2; exit 2; }
[[ "$(id -u)" == "0" ]] || { echo "Run legacy Site cleanup as root." >&2; exit 1; }

services=(
  open-agent-bridge.service
  open-agent-bridge-worker.service
  open-agent-bridge-channel-health.service
  open-agent-bridge-channel-health.timer
  workspace-admin-panel.service
  lmt-tools.service
  xiaohongshu-channel.service
  channel-egress.service
  postfix.service
  rspamd.service
)
units=(
  /etc/systemd/system/open-agent-bridge.service
  /etc/systemd/system/open-agent-bridge-worker.service
  /etc/systemd/system/open-agent-bridge-channel-health.service
  /etc/systemd/system/open-agent-bridge-channel-health.timer
  /etc/systemd/system/workspace-admin-panel.service
  /etc/systemd/system/lmt-tools.service
  /etc/systemd/system/xiaohongshu-channel.service
  /etc/systemd/system/channel-egress.service
)
business_paths=(
  /opt/personal-agent.local
  /var/lib/personal-agent.local
  /root/.codex
)

echo "Legacy services to disable:"
printf '  %s\n' "${services[@]}"
echo "Legacy business paths to remove:"
for target in "${business_paths[@]}"; do
  if [[ -e "$target" ]]; then du -sh "$target" 2>/dev/null || printf '  %s\n' "$target"; fi
done
echo "Preserved Edge roots:"
printf '  %s\n' /opt/private-site-edge /etc/private-site-edge /var/lib/private-site-edge /etc/nginx/ssl /root/.acme.sh

[[ "$MODE" == "execute" ]] || exit 0

for service in "${services[@]}"; do systemctl disable --now "$service" >/dev/null 2>&1 || true; done
for unit in "${units[@]}"; do rm -f -- "$unit"; done
systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true

for target in "${business_paths[@]}"; do rm -rf --one-file-system -- "$target"; done
rm -rf --one-file-system -- /etc/personal-agent.local
rm -f -- /etc/cron.d/personal-agent-acme-renew
rm -rf -- /etc/private-site-edge/migration/current
id personal-agent-mail >/dev/null 2>&1 && userdel personal-agent-mail >/dev/null 2>&1 || true

find /var/log/nginx -maxdepth 1 -type f -exec truncate -s 0 -- {} + 2>/dev/null || true

test -d /opt/private-site-edge
test -d /etc/private-site-edge
test -d /var/lib/private-site-edge
test -d /etc/nginx/ssl
test -f /etc/private-site-edge/acme.env
test -d /root/.acme.sh
systemctl is-active --quiet nginx
systemctl is-active --quiet wg-quick@wg0
nginx -t
systemctl reload nginx

for target in "${business_paths[@]}"; do [[ ! -e "$target" ]] || { echo "Legacy path remains: $target" >&2; exit 1; }; done
for service in "${services[@]}"; do
  [[ "$(systemctl is-active "$service" 2>/dev/null || true)" != "active" ]] || { echo "Legacy service remains active: $service" >&2; exit 1; }
done

echo "Legacy Site cleanup completed; Edge services and certificate state are preserved."
