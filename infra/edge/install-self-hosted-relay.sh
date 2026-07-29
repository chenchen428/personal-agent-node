#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
SOURCE_SCRIPT="${2:-}"
TOKEN_MODE="${3:-}"
[[ "$(id -u)" == "0" ]] || { echo "Run the self-hosted Relay installer as root." >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]{2,251}[a-z0-9])$ ]] || { echo "Invalid Relay domain." >&2; exit 2; }
[[ -f "$SOURCE_SCRIPT" ]] || { echo "Self-hosted Relay executable is missing." >&2; exit 2; }
[[ -z "$TOKEN_MODE" || "$TOKEN_MODE" == "--rotate-token" ]] || { echo "Unknown installer option." >&2; exit 2; }
command -v systemctl >/dev/null 2>&1 || { echo "systemd is required to supervise the Relay." >&2; exit 3; }
command -v nginx >/dev/null 2>&1 || { echo "Nginx is required before installing the Relay." >&2; exit 3; }
command -v curl >/dev/null 2>&1 || { echo "curl is required before installing the Relay." >&2; exit 3; }
NODE_BIN="$(command -v node || true)"
[[ "$NODE_BIN" =~ ^/[A-Za-z0-9_./+-]+$ ]] || { echo "Node.js 22 or newer is required on the server." >&2; exit 3; }
NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= 22 )) || { echo "Node.js 22 or newer is required on the server." >&2; exit 3; }

RELAY_ROOT="/opt/personal-agent-self-hosted-relay"
CONFIG_ROOT="/etc/personal-agent-relay"
CONFIG_PATH="$CONFIG_ROOT/config.json"
NGINX_PATH="/etc/nginx/conf.d/06-personal-agent-self-hosted-relay.conf"
BACKUP_ROOT="/var/lib/private-site-edge/backups/self-hosted-relay-$(date -u +%Y%m%dT%H%M%SZ)"
CERT_ROOT="/etc/nginx/ssl/$DOMAIN"
if [[ ! -f "$CERT_ROOT/fullchain.cer" || ! -f "$CERT_ROOT/privkey.key" ]]; then
  CERT_ROOT="/etc/private-site-edge/certificates/$DOMAIN"
fi
[[ -f "$CERT_ROOT/fullchain.cer" && -f "$CERT_ROOT/privkey.key" ]] || { echo "A valid TLS certificate for $DOMAIN must be installed first." >&2; exit 3; }

SITE_ID=""
TOKEN_SHA256=""
RELAY_TOKEN=""
if [[ ! -f "$CONFIG_PATH" || "$TOKEN_MODE" == "--rotate-token" ]]; then
  [[ -t 1 ]] || { echo "Fresh install or key rotation requires an interactive terminal so the connection key is not written to automation logs." >&2; exit 5; }
fi
if [[ -f "$CONFIG_PATH" ]]; then
  read -r SITE_ID TOKEN_SHA256 < <("$NODE_BIN" -e '
    const fs = require("node:fs");
    const [file, domain] = process.argv.slice(1);
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.domain !== domain || !/^[A-Za-z0-9_-]{6,128}$/.test(value.siteId || "") || !/^[a-f0-9]{64}$/.test(value.tokenSha256 || "")) process.exit(2);
    process.stdout.write(`${value.siteId} ${value.tokenSha256}\n`);
  ' "$CONFIG_PATH" "$DOMAIN") || { echo "Existing Relay identity does not match this domain. Use --rotate-token only after checking the target." >&2; exit 4; }
  if [[ "$TOKEN_MODE" == "--rotate-token" ]]; then
    read -r RELAY_TOKEN TOKEN_SHA256 < <("$NODE_BIN" -e '
      const crypto = require("node:crypto");
      const token = crypto.randomBytes(32).toString("base64url");
      process.stdout.write(`${token} ${crypto.createHash("sha256").update(token).digest("hex")}\n`);
    ')
  fi
else
  read -r SITE_ID RELAY_TOKEN TOKEN_SHA256 < <("$NODE_BIN" -e '
    const crypto = require("node:crypto");
    const token = crypto.randomBytes(32).toString("base64url");
    process.stdout.write(`site_${crypto.randomBytes(12).toString("base64url")} ${token} ${crypto.createHash("sha256").update(token).digest("hex")}\n`);
  ')
fi

install -d -m 755 "$RELAY_ROOT"
install -d -m 700 "$CONFIG_ROOT"
install -d -m 700 "$BACKUP_ROOT"
install -m 755 "$SOURCE_SCRIPT" "$RELAY_ROOT/self-hosted-relay.mjs"

if [[ -f "$CONFIG_PATH" ]]; then cp -a "$CONFIG_PATH" "$BACKUP_ROOT/config.json.before"; fi
if [[ -f "$NGINX_PATH" ]]; then cp -a "$NGINX_PATH" "$BACKUP_ROOT/nginx.conf.before"; fi
for EDGE_ROUTE in "/etc/private-site-edge/nginx/$DOMAIN.conf" "/etc/private-site-edge/nginx/site-$DOMAIN.conf"; do
  if [[ -f "$EDGE_ROUTE" ]]; then
    cp -a "$EDGE_ROUTE" "$BACKUP_ROOT/$(basename "$EDGE_ROUTE").before"
    rm -f "$EDGE_ROUTE"
  fi
done

umask 077
printf '{\n  "schemaVersion": 1,\n  "domain": "%s",\n  "siteId": "%s",\n  "tokenSha256": "%s",\n  "listenHost": "127.0.0.1",\n  "listenPort": 8090,\n  "generation": 1,\n  "heartbeatSeconds": 20\n}\n' \
  "$DOMAIN" "$SITE_ID" "$TOKEN_SHA256" > "$CONFIG_PATH"
chmod 600 "$CONFIG_PATH"

cat > /etc/systemd/system/personal-agent-self-hosted-relay.service <<UNIT
[Unit]
Description=Personal Agent self-hosted reverse Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
Environment=NODE_ENV=production
Environment=PERSONAL_AGENT_RELAY_CONFIG=/etc/personal-agent-relay/config.json
ExecStart=$NODE_BIN /opt/personal-agent-self-hosted-relay/self-hosted-relay.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/private-site-edge
CapabilityBoundingSet=
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNIT

cat > "$NGINX_PATH" <<NGINX
server {
    listen 80;
    server_name $DOMAIN *.$DOMAIN;
    return 308 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name $DOMAIN *.$DOMAIN;

    ssl_certificate $CERT_ROOT/fullchain.cer;
    ssl_certificate_key $CERT_ROOT/privkey.key;

    location = /__personal_agent_relay/mail-ingest {
        return 404;
    }

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
NGINX

systemctl daemon-reload
systemctl enable personal-agent-self-hosted-relay.service
systemctl restart personal-agent-self-hosted-relay.service
nginx -t
systemctl reload nginx
for ATTEMPT in {1..20}; do
  if curl --fail --silent --max-time 1 -H "Host: $DOMAIN" http://127.0.0.1:8090/__personal_agent_relay/health >/dev/null; then break; fi
  sleep 0.25
done
curl --fail --silent --show-error --max-time 5 -H "Host: $DOMAIN" http://127.0.0.1:8090/__personal_agent_relay/health >/dev/null
printf 'Self-hosted Relay ready for %s (backup: %s)\n' "$DOMAIN" "$BACKUP_ROOT"
if [[ -n "$RELAY_TOKEN" ]]; then
  printf '\nCopy this connection key into the Personal Agent client now.\n'
  printf 'The server keeps only its SHA-256 digest; the plaintext key is not stored.\n'
  printf '%s\n' "$RELAY_TOKEN"
else
  printf 'Existing Relay connection key digest preserved; no client change is required.\n'
fi
