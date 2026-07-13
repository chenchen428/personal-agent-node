#!/usr/bin/env bash
set -euo pipefail

EDGE_CONFIG_DIR="${PRIVATE_SITE_EDGE_CONFIG_DIR:-/etc/private-site-edge}"
WG_DIR="${PRIVATE_SITE_EDGE_WG_DIR:-$EDGE_CONFIG_DIR/wireguard}"
WG_CONFIG="${PRIVATE_SITE_EDGE_WG_CONFIG:-/etc/wireguard/wg0.conf}"
WG_PORT="${PRIVATE_SITE_EDGE_WG_PORT:-51820}"

[[ "$(id -u)" == "0" ]] || { echo "Run WireGuard hub setup as root." >&2; exit 1; }

if ! command -v wg >/dev/null 2>&1; then
  if ! dnf install -y wireguard-tools; then
    rpm --import https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-8
    dnf --repofrompath=private-site-epel8,https://mirrors.aliyun.com/epel/8/Everything/x86_64/ \
      --enablerepo=private-site-epel8 \
      --setopt=private-site-epel8.gpgcheck=1 \
      --setopt=private-site-epel8.gpgkey=https://dl.fedoraproject.org/pub/epel/RPM-GPG-KEY-EPEL-8 \
      install -y wireguard-tools
  fi
fi
install -d -m 700 "$WG_DIR" /etc/wireguard
if [[ ! -f "$WG_DIR/private.key" ]]; then
  umask 077
  wg genkey > "$WG_DIR/private.key"
fi
chmod 600 "$WG_DIR/private.key"
wg pubkey < "$WG_DIR/private.key" > "$WG_DIR/public.key"
chmod 644 "$WG_DIR/public.key"

if [[ ! -f "$WG_CONFIG" ]]; then
  {
    printf '[Interface]\n'
    printf 'Address = 10.77.0.1/24\n'
    printf 'ListenPort = %s\n' "$WG_PORT"
    printf 'PrivateKey = %s\n' "$(cat "$WG_DIR/private.key")"
  } > "$WG_CONFIG"
  chmod 600 "$WG_CONFIG"
fi

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-port="$WG_PORT/udp" >/dev/null
  firewall-cmd --reload >/dev/null
fi
systemctl enable --now wg-quick@wg0
iptables -C FORWARD -i wg0 -o wg0 -j DROP 2>/dev/null || iptables -I FORWARD -i wg0 -o wg0 -j DROP
iptables -N PRIVATE_SITE_WG_INPUT 2>/dev/null || true
iptables -F PRIVATE_SITE_WG_INPUT
iptables -A PRIVATE_SITE_WG_INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A PRIVATE_SITE_WG_INPUT -j DROP
iptables -C INPUT -i wg0 -j PRIVATE_SITE_WG_INPUT 2>/dev/null || iptables -I INPUT -i wg0 -j PRIVATE_SITE_WG_INPUT
printf '[private-site-edge] WireGuard hub is active on UDP %s.\n' "$WG_PORT"
