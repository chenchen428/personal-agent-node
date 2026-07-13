#!/usr/bin/env bash
set -euo pipefail

RELEASE_DIR="${1:?release directory is required}"
EDGE_ROOT="${PRIVATE_SITE_EDGE_ROOT:-/opt/private-site-edge}"
EDGE_CONFIG_DIR="${PRIVATE_SITE_EDGE_CONFIG_DIR:-/etc/private-site-edge}"
EDGE_STATE_DIR="${PRIVATE_SITE_EDGE_STATE_DIR:-/var/lib/private-site-edge}"

[[ "$(id -u)" == "0" ]] || { echo "Install the Edge release as root." >&2; exit 1; }
command -v logrotate >/dev/null 2>&1 || { echo "Edge host prerequisite is missing: logrotate" >&2; exit 1; }
[[ -f "$RELEASE_DIR/release-manifest.json" && -f "$RELEASE_DIR/SHA256SUMS" ]] || { echo "Invalid Edge release." >&2; exit 1; }
(cd "$RELEASE_DIR" && sha256sum -c SHA256SUMS >/dev/null)
chmod 755 \
  "$RELEASE_DIR/projects/core/edge/bin/private-site-edge.mjs" \
  "$RELEASE_DIR/projects/core/edge/scripts/"*.sh \
  "$RELEASE_DIR/infra/edge/"*.sh \
  "$RELEASE_DIR/infra/edge/pki/"*.sh \
  "$RELEASE_DIR/infra/edge/wireguard/"*.sh
release_type="$(node -e 'const m=require(process.argv[1]);process.stdout.write(m.releaseType||"")' "$RELEASE_DIR/release-manifest.json")"
[[ "$release_type" == "private-site-edge" ]] || { echo "Release type is not private-site-edge." >&2; exit 1; }

install -d -m 755 "$EDGE_ROOT/releases" "$EDGE_CONFIG_DIR/nginx" "$EDGE_STATE_DIR"
install -d -m 700 "$EDGE_CONFIG_DIR/pki" "$EDGE_CONFIG_DIR/wireguard" "$EDGE_CONFIG_DIR/certs"
nginx_user="$(awk '/^[[:space:]]*user[[:space:]]+/ { gsub(/;/, "", $2); print $2; exit }' /etc/nginx/nginx.conf | tr -d '\r')"
[[ -n "$nginx_user" ]] || nginx_user="nginx"
nginx_group="$(id -gn "$nginx_user" 2>/dev/null || true)"
[[ -n "$nginx_group" ]] || { echo "Nginx user does not exist: $nginx_user" >&2; exit 1; }
install -d -m 770 -o root -g "$nginx_group" /var/log/private-site-edge
logrotate_tmp="$(mktemp)"
sed "s/@NGINX_GROUP@/$nginx_group/g" "$RELEASE_DIR/infra/edge/logrotate/private-site-edge.conf" > "$logrotate_tmp"
install -m 644 "$logrotate_tmp" /etc/logrotate.d/private-site-edge
rm -f "$logrotate_tmp"
if [[ ! -f "$EDGE_CONFIG_DIR/sites.json" ]]; then
  printf '{\n  "schemaVersion": 1,\n  "sites": []\n}\n' > "$EDGE_CONFIG_DIR/sites.json"
  chmod 640 "$EDGE_CONFIG_DIR/sites.json"
fi
previous=""
if [[ -L "$EDGE_ROOT/current" ]]; then previous="$(readlink -f "$EDGE_ROOT/current")"; fi
ln -sfn "$RELEASE_DIR" "$EDGE_ROOT/current"
if [[ -n "$previous" && "$previous" != "$RELEASE_DIR" ]]; then ln -sfn "$previous" "$EDGE_ROOT/previous"; fi

bash "$RELEASE_DIR/infra/edge/wireguard/setup-hub.sh"
bash "$RELEASE_DIR/infra/edge/pki/init-origin-pki.sh"
install -m 644 "$RELEASE_DIR/infra/nginx/conf.d/05-private-site-edge.conf" /etc/nginx/conf.d/05-private-site-edge.conf
PRIVATE_SITE_EDGE_CONFIG_DIR="$EDGE_CONFIG_DIR" PRIVATE_SITE_EDGE_STATE_DIR="$EDGE_STATE_DIR" \
  node "$RELEASE_DIR/projects/core/edge/bin/private-site-edge.mjs" render >/dev/null
nginx -t
systemctl reload nginx
PERSONAL_AGENT_CURRENT_ROOT="$RELEASE_DIR" bash "$RELEASE_DIR/projects/core/edge/scripts/install-renewal-cron.sh"

current="$(readlink -f "$EDGE_ROOT/current")"
previous="$(readlink -f "$EDGE_ROOT/previous" 2>/dev/null || true)"
for candidate in "$EDGE_ROOT"/releases/*; do
  [[ -d "$candidate" ]] || continue
  resolved="$(readlink -f "$candidate")"
  [[ "$resolved" == "$current" || "$resolved" == "$previous" ]] || rm -rf "$candidate"
done
printf '[private-site-edge] Activated Edge release %s.\n' "$(basename "$RELEASE_DIR")"
