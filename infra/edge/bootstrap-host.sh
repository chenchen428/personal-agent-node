#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${PRIVATE_SITE_EDGE_NODE_VERSION:-22.17.0}"
NGINX_CONFIG="${PRIVATE_SITE_EDGE_NGINX_CONFIG:-/etc/nginx/nginx.conf}"

[[ "$(id -u)" == "0" ]] || { echo "Run Edge host bootstrap as root." >&2; exit 1; }

install_packages() {
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y bash ca-certificates coreutils curl findutils gzip iptables logrotate nginx openssl tar util-linux xz
  elif command -v yum >/dev/null 2>&1; then
    yum install -y bash ca-certificates coreutils curl findutils gzip iptables logrotate nginx openssl tar util-linux xz
  elif command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y bash ca-certificates coreutils curl findutils gzip iptables logrotate nginx openssl tar util-linux xz-utils
  else
    echo "Supported dnf, yum, or apt package manager is required." >&2
    exit 1
  fi
}

install_node() {
  if command -v node >/dev/null 2>&1 && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]]; then
    return
  fi
  case "$(uname -m)" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *) echo "Unsupported Edge CPU architecture: $(uname -m)" >&2; exit 1 ;;
  esac
  archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  base="https://nodejs.org/dist/v${NODE_VERSION}"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  curl -fsSLo "$work/$archive" "$base/$archive"
  curl -fsSLo "$work/SHASUMS256.txt" "$base/SHASUMS256.txt"
  (cd "$work" && grep "  $archive\$" SHASUMS256.txt | sha256sum -c -)
  install -d -m 755 /opt/private-site-edge/runtime
  rm -rf "/opt/private-site-edge/runtime/node-v${NODE_VERSION}"
  tar -xJf "$work/$archive" -C /opt/private-site-edge/runtime
  mv "/opt/private-site-edge/runtime/node-v${NODE_VERSION}-linux-${node_arch}" "/opt/private-site-edge/runtime/node-v${NODE_VERSION}"
  ln -sfn "/opt/private-site-edge/runtime/node-v${NODE_VERSION}/bin/node" /usr/local/bin/node
  ln -sfn "/opt/private-site-edge/runtime/node-v${NODE_VERSION}/bin/npm" /usr/local/bin/npm
  rm -rf "$work"
  trap - RETURN
}

install_nginx_config() {
  install -d -m 755 /etc/nginx/conf.d /var/www/acme
  if [[ -f "$NGINX_CONFIG" ]] && grep -q 'private-site self-hosted edge v3' "$NGINX_CONFIG"; then
    return
  fi
  if [[ -f "$NGINX_CONFIG" ]]; then
    cp -a "$NGINX_CONFIG" "$NGINX_CONFIG.pre-private-site"
  fi
  temporary="$(mktemp)"
  cat > "$temporary" <<'NGINX'
# private-site self-hosted edge v3
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events { worker_connections 1024; }

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log off;
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    server_tokens off;
    server_names_hash_bucket_size 128;
    types_hash_max_size 4096;
    types_hash_bucket_size 128;
    client_max_body_size 64m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    map $http_upgrade $connection_upgrade { default upgrade; '' close; }
    include /etc/nginx/conf.d/*.conf;
}
NGINX
  install -m 644 "$temporary" "$NGINX_CONFIG"
  rm -f "$temporary"
  if ! id nginx >/dev/null 2>&1 && id www-data >/dev/null 2>&1; then
    sed -i 's/^user nginx;/user www-data;/' "$NGINX_CONFIG"
  fi
}

disable_core_dumps() {
  install -d -m 755 /etc/security/limits.d /etc/systemd/coredump.conf.d /etc/sysctl.d
  printf '* hard core 0\nroot hard core 0\n' > /etc/security/limits.d/private-site-edge.conf
  printf '[Coredump]\nStorage=none\nProcessSizeMax=0\n' > /etc/systemd/coredump.conf.d/private-site-edge.conf
  printf 'fs.suid_dumpable = 0\n' > /etc/sysctl.d/99-private-site-edge.conf
  sysctl -p /etc/sysctl.d/99-private-site-edge.conf >/dev/null
}

verify_swap_policy() {
  if swapon --noheadings --show=NAME 2>/dev/null | grep -q .; then
    echo "Active swap is not allowed on the Edge unless an encrypted swap design is separately approved." >&2
    exit 1
  fi
}

install_packages
install_node
install_nginx_config
disable_core_dumps
verify_swap_policy
systemctl enable --now nginx
nginx -t
printf '[private-site-edge] Host prerequisites are ready.\n'
