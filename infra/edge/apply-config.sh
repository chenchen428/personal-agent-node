#!/usr/bin/env bash
set -euo pipefail

CURRENT_ROOT="${PERSONAL_AGENT_CURRENT_ROOT:-/opt/private-site-edge/current}"
EDGE_CLI="${PRIVATE_SITE_EDGE_CLI:-$CURRENT_ROOT/projects/edge/bin/private-site-edge.mjs}"
WG_CONFIG="${PRIVATE_SITE_EDGE_WG_CONFIG:-/etc/wireguard/wg0.conf}"

[[ "$(id -u)" == "0" ]] || { echo "Apply Edge configuration as root." >&2; exit 1; }
node "$EDGE_CLI" render >/dev/null
nginx -t
systemctl reload nginx

if [[ -f "$WG_CONFIG" ]]; then
  if systemctl is-active --quiet wg-quick@wg0; then
    stripped="$(mktemp)"
    trap 'rm -f "$stripped"' EXIT
    wg-quick strip wg0 > "$stripped"
    wg syncconf wg0 "$stripped"
  else
    systemctl enable --now wg-quick@wg0
  fi
fi
printf '[private-site-edge] Nginx and WireGuard configuration applied.\n'
