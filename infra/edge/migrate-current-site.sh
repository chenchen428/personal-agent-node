#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
CURRENT_ROOT="${PERSONAL_AGENT_CURRENT_ROOT:-/opt/private-site-edge/current}"
EDGE_CLI="${PRIVATE_SITE_EDGE_CLI:-$CURRENT_ROOT/core/edge/bin/private-site-edge.mjs}"
EDGE_CONFIG_DIR="${PRIVATE_SITE_EDGE_CONFIG_DIR:-/etc/private-site-edge}"
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx/conf.d}"
MIGRATION_DIR="${PRIVATE_SITE_EDGE_MIGRATION_DIR:-$EDGE_CONFIG_DIR/migration/current-site}"
SITE_DOMAIN="${SITE_DOMAIN:-personal-agent.local}"
ORIGIN_NAME="${PRIVATE_SITE_ORIGIN_NAME:?PRIVATE_SITE_ORIGIN_NAME is required}"
ORIGIN_URL="${PRIVATE_SITE_ORIGIN_URL:-https://10.77.0.2:8843}"
LEGACY_FILES=(00-http-acme.conf 01-local-http.conf 10-admin-panel.conf 20-static-sites.conf 30-app-services.conf 40-resources.conf)

[[ "$(id -u)" == "0" ]] || { echo "Run the current Site migration as root." >&2; exit 1; }
[[ "$ACTION" == "activate" || "$ACTION" == "rollback" ]] || { echo "Usage: migrate-current-site.sh <activate|rollback>" >&2; exit 2; }
[[ -f "$EDGE_CLI" ]] || { echo "Missing Edge CLI: $EDGE_CLI" >&2; exit 1; }

origin_health() {
  curl -fsS --connect-timeout 5 --max-time 15 \
    --cert "$EDGE_CONFIG_DIR/pki/edge-client.crt" \
    --key "$EDGE_CONFIG_DIR/pki/edge-client.key" \
    --cacert "$EDGE_CONFIG_DIR/pki/origin-ca.crt" \
    --resolve "$ORIGIN_NAME:8843:10.77.0.2" \
    -H "Host: $SITE_DOMAIN" \
    "https://$ORIGIN_NAME:8843/__private-site/health" >/dev/null
}

restore_legacy() {
  for name in "${LEGACY_FILES[@]}"; do
    if [[ -f "$MIGRATION_DIR/$name" ]]; then
      install -m 644 "$MIGRATION_DIR/$name" "$NGINX_CONF_DIR/$name"
    fi
  done
  rm -f "$NGINX_CONF_DIR/05-private-site-edge.conf"
}

if [[ "$ACTION" == "rollback" ]]; then
  restore_legacy
  nginx -t
  systemctl reload nginx
  printf '[private-site-edge] Restored legacy ECS application routes.\n'
  exit 0
fi

origin_health || { echo "Local Site origin mTLS health check failed." >&2; exit 1; }
install -d -m 700 "$MIGRATION_DIR"
for name in "${LEGACY_FILES[@]}"; do
  if [[ -f "$NGINX_CONF_DIR/$name" && ! -f "$MIGRATION_DIR/$name" ]]; then
    cp -a "$NGINX_CONF_DIR/$name" "$MIGRATION_DIR/$name"
  fi
  rm -f "$NGINX_CONF_DIR/$name"
done
install -m 644 "$CURRENT_ROOT/infra/nginx/conf.d/05-private-site-edge.conf" "$NGINX_CONF_DIR/05-private-site-edge.conf"
node "$EDGE_CLI" render >/dev/null

if ! nginx -t; then
  restore_legacy
  nginx -t
  systemctl reload nginx
  echo "Edge Nginx configuration failed; legacy routes were restored." >&2
  exit 1
fi
systemctl reload nginx
sleep 1
if ! origin_health; then
  restore_legacy
  nginx -t
  systemctl reload nginx
  echo "Origin failed after Edge activation; legacy routes were restored." >&2
  exit 1
fi
printf '[private-site-edge] Activated %s through the local Site origin.\n' "$SITE_DOMAIN"
