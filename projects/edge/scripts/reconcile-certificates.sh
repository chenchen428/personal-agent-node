#!/usr/bin/env bash
set -euo pipefail

EDGE_ROOT="${PRIVATE_SITE_EDGE_ROOT:-/opt/private-site-edge/current/projects/edge}"
EDGE_CLI="${PRIVATE_SITE_EDGE_CLI:-$EDGE_ROOT/bin/private-site-edge.mjs}"
EDGE_CONFIG_DIR="${PRIVATE_SITE_EDGE_CONFIG_DIR:-/etc/private-site-edge}"
EDGE_ACME_ENV="${PRIVATE_SITE_EDGE_ACME_ENV:-$EDGE_CONFIG_DIR/acme.env}"
ALIYUN_ACME_ENV="${ALIYUN_ACME_ENV:-$EDGE_ACME_ENV}"
ACME_HOME="${ACME_HOME:-/root/.acme.sh}"
ACME_BIN="${ACME_BIN:-$ACME_HOME/acme.sh}"
ACME_WEBROOT="${PRIVATE_SITE_EDGE_ACME_WEBROOT:-/var/www/acme}"
CERT_ROOT="${PRIVATE_SITE_EDGE_CERT_DIR:-$EDGE_CONFIG_DIR/certs}"
LOCK_DIR="${PRIVATE_SITE_EDGE_ACME_LOCK:-/run/lock/private-site-edge-acme.lock}"

log() {
  printf '[private-site-edge-acme] %s\n' "$*"
}

clear_install_hooks() {
  local config="$1"
  [[ -f "$config" ]] || return 0
  sed -i '/^Le_RealCertPath=/d; /^Le_RealCACertPath=/d; /^Le_RealKeyPath=/d; /^Le_ReloadCmd=/d; /^Le_RealFullChainPath=/d' "$config"
}

[[ "$(id -u)" == "0" ]] || { echo "Run certificate reconciliation as root." >&2; exit 1; }
[[ -f "$EDGE_CLI" ]] || { echo "Missing Edge CLI: $EDGE_CLI" >&2; exit 1; }
[[ -f "$EDGE_ACME_ENV" ]] || { echo "Missing Edge ACME environment: $EDGE_ACME_ENV" >&2; exit 1; }
[[ "$(stat -Lc '%a' "$EDGE_ACME_ENV")" == "600" ]] || { echo "Edge ACME environment must use mode 600." >&2; exit 1; }

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Another certificate reconciliation is already running; skipping."
  exit 0
fi
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"; rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

set -a
# shellcheck disable=SC1090
source "$EDGE_ACME_ENV"
set +a
[[ -n "${ACME_EMAIL:-}" ]] || { echo "ACME_EMAIL is required." >&2; exit 1; }

install -d -m 755 "$ACME_WEBROOT" "$CERT_ROOT"
if [[ ! -x "$ACME_BIN" ]]; then
  ACME_HOME="$ACME_HOME" ACME_BIN="$ACME_BIN" ACME_CREDENTIALS_FILE="$EDGE_ACME_ENV" \
    bash "${PERSONAL_AGENT_CURRENT_ROOT:-/opt/private-site-edge/current}/infra/acme/install-acme.sh"
fi
"$ACME_BIN" --set-default-ca --server letsencrypt >/dev/null

# Missing certificates intentionally render HTTP-only sites so HTTP-01 can
# complete without Nginx referencing certificate files that do not exist yet.
node "$EDGE_CLI" render >/dev/null
nginx -t
systemctl reload nginx

while IFS=$'\t' read -r domain mode hosts_csv; do
  [[ -n "$domain" ]] || continue
  domain_config="$ACME_HOME/${domain}_ecc/${domain}.conf"
  if [[ ! -f "$domain_config" ]]; then
    if [[ "$mode" == "http-san" ]]; then
      IFS=',' read -r -a hosts <<< "$hosts_csv"
      issue_args=(--issue --server letsencrypt --webroot "$ACME_WEBROOT" --keylength ec-256)
      for host in "${hosts[@]}"; do
        issue_args+=(-d "$host")
      done
      log "Issuing HTTP-01 SAN certificate for $domain."
      "$ACME_BIN" "${issue_args[@]}"
    elif [[ "$mode" == "dns-wildcard" ]]; then
      [[ -f "$ALIYUN_ACME_ENV" ]] || { echo "Missing Aliyun ACME environment for $domain." >&2; exit 1; }
      [[ "$(stat -Lc '%a' "$ALIYUN_ACME_ENV")" == "600" ]] || { echo "Aliyun ACME environment must use mode 600." >&2; exit 1; }
      set -a
      # shellcheck disable=SC1090
      source "$ALIYUN_ACME_ENV"
      set +a
      [[ -n "${Ali_Key:-}" && -n "${Ali_Secret:-}" ]] || { echo "Aliyun ACME credentials are incomplete." >&2; exit 1; }
      log "Issuing DNS-01 wildcard certificate for $domain."
      "$ACME_BIN" --issue --server letsencrypt --dns dns_ali -d "$domain" -d "*.$domain" --keylength ec-256
    else
      echo "Unsupported certificate mode for $domain: $mode" >&2
      exit 1
    fi
  fi
done < <(node "$EDGE_CLI" certificates)

# The Edge manager owns validation and activation. acme.sh must only renew its
# ACME-home copy and must never write directly into an active certificate path.
while IFS=$'\t' read -r domain mode hosts_csv; do
  [[ -n "$domain" ]] || continue
  clear_install_hooks "$ACME_HOME/${domain}_ecc/${domain}.conf"
done < <(node "$EDGE_CLI" certificates)

# acme.sh renews only certificates that are inside their renewal window.
"$ACME_BIN" --cron --home "$ACME_HOME"

changed_domains=()
while IFS=$'\t' read -r domain mode hosts_csv; do
  [[ -n "$domain" ]] || continue
  candidate_dir="$work_dir/candidate-$domain"
  target_dir="$CERT_ROOT/$domain"
  previous_dir="$target_dir/previous"
  acme_dir="$ACME_HOME/${domain}_ecc"
  install -d -m 700 "$candidate_dir"
  install -m 644 "$acme_dir/fullchain.cer" "$candidate_dir/fullchain.cer"
  install -m 600 "$acme_dir/${domain}.key" "$candidate_dir/privkey.key"
  validation_args=("$domain" "$candidate_dir/fullchain.cer" "$candidate_dir/privkey.key")
  [[ -f "$target_dir/fullchain.cer" ]] && validation_args+=("$target_dir/fullchain.cer")
  node "$EDGE_CLI" validate-certificate "${validation_args[@]}" >/dev/null

  if [[ -f "$target_dir/fullchain.cer" ]] && cmp -s "$candidate_dir/fullchain.cer" "$target_dir/fullchain.cer" \
    && cmp -s "$candidate_dir/privkey.key" "$target_dir/privkey.key"; then
    continue
  fi

  install -d -m 750 "$target_dir"
  if [[ -f "$target_dir/fullchain.cer" ]]; then
    install -d -m 700 "$previous_dir"
    install -m 644 "$target_dir/fullchain.cer" "$previous_dir/fullchain.cer"
    install -m 600 "$target_dir/privkey.key" "$previous_dir/privkey.key"
  fi
  install -m 644 "$candidate_dir/fullchain.cer" "$target_dir/fullchain.cer.new"
  install -m 600 "$candidate_dir/privkey.key" "$target_dir/privkey.key.new"
  mv -f "$target_dir/fullchain.cer.new" "$target_dir/fullchain.cer"
  mv -f "$target_dir/privkey.key.new" "$target_dir/privkey.key"
  changed_domains+=("$domain")
done < <(node "$EDGE_CLI" certificates)

if (( ${#changed_domains[@]} == 0 )); then
  log "All public certificates are current."
  exit 0
fi

node "$EDGE_CLI" render >/dev/null
if ! nginx -t; then
  log "Nginx validation failed; restoring previous certificates."
  for domain in "${changed_domains[@]}"; do
    target_dir="$CERT_ROOT/$domain"
    previous_dir="$target_dir/previous"
    if [[ -f "$previous_dir/fullchain.cer" ]]; then
      install -m 644 "$previous_dir/fullchain.cer" "$target_dir/fullchain.cer"
      install -m 600 "$previous_dir/privkey.key" "$target_dir/privkey.key"
    else
      rm -f "$target_dir/fullchain.cer" "$target_dir/privkey.key"
    fi
  done
  node "$EDGE_CLI" render >/dev/null
  nginx -t
  exit 1
fi
systemctl reload nginx
for domain in "${changed_domains[@]}"; do
  if ! curl --silent --show-error --head --max-time 20 --resolve "$domain:443:127.0.0.1" "https://$domain/" >/dev/null; then
    log "Public TLS verification failed for $domain; restoring previous certificate."
    target_dir="$CERT_ROOT/$domain"
    previous_dir="$target_dir/previous"
    if [[ -f "$previous_dir/fullchain.cer" ]]; then
      install -m 644 "$previous_dir/fullchain.cer" "$target_dir/fullchain.cer"
      install -m 600 "$previous_dir/privkey.key" "$target_dir/privkey.key"
    else
      rm -f "$target_dir/fullchain.cer" "$target_dir/privkey.key"
    fi
    node "$EDGE_CLI" render >/dev/null
    nginx -t
    systemctl reload nginx
    exit 1
  fi
done
log "Installed and activated certificates for: ${changed_domains[*]}"
