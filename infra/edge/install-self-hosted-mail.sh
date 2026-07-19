#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
RECIPIENTS_CSV="${2:-}"
RELAY_PORT="${3:-8090}"
[[ "$(id -u)" == "0" ]] || { echo "Run the self-hosted mail installer as root." >&2; exit 1; }
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]{2,251}[a-z0-9])$ ]] || { echo "Invalid mail domain." >&2; exit 2; }
[[ "$RELAY_PORT" =~ ^[0-9]+$ ]] && (( RELAY_PORT >= 1 && RELAY_PORT <= 65535 )) || { echo "Invalid Relay port." >&2; exit 2; }
[[ -n "$RECIPIENTS_CSV" ]] || { echo "At least one exact mail recipient is required." >&2; exit 2; }

CERT_ROOT="/etc/nginx/ssl/$DOMAIN"
if [[ ! -f "$CERT_ROOT/fullchain.cer" || ! -f "$CERT_ROOT/privkey.key" ]]; then
  CERT_ROOT="/etc/private-site-edge/certificates/$DOMAIN"
fi
[[ -f "$CERT_ROOT/fullchain.cer" && -f "$CERT_ROOT/privkey.key" ]] || { echo "A valid TLS certificate for $DOMAIN must be installed first." >&2; exit 3; }

command -v postfix >/dev/null 2>&1 || dnf install -y postfix postfix-lmdb
command -v postmap >/dev/null 2>&1 || { echo "Postfix map compiler is unavailable." >&2; exit 3; }
command -v curl >/dev/null 2>&1 || dnf install -y curl
postconf -m | grep -qx lmdb || { echo "Postfix LMDB map support is required." >&2; exit 3; }

BACKUP_ROOT="/var/lib/private-site-edge/backups/self-hosted-mail-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$BACKUP_ROOT"
for EXISTING in /etc/postfix/main.cf /etc/postfix/master.cf /etc/postfix/personal-agent-domains /etc/postfix/personal-agent-recipients /usr/local/libexec/personal-agent-mail-forward; do
  [[ -f "$EXISTING" ]] && cp -a "$EXISTING" "$BACKUP_ROOT/$(basename "$EXISTING").before"
done

DOMAINS_FILE="/etc/postfix/personal-agent-domains"
RECIPIENTS_FILE="/etc/postfix/personal-agent-recipients"
: > "$DOMAINS_FILE"
: > "$RECIPIENTS_FILE"
declare -A SEEN_DOMAINS=()
IFS=',' read -r -a RECIPIENTS <<< "$RECIPIENTS_CSV"
for RAW_RECIPIENT in "${RECIPIENTS[@]}"; do
  RECIPIENT="$(printf '%s' "$RAW_RECIPIENT" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ "$RECIPIENT" =~ ^[a-z0-9.!#%\&\'*+/=?^_\`\{\|\}~-]+@[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])$ ]] || { echo "Invalid recipient: $RAW_RECIPIENT" >&2; exit 2; }
  RECIPIENT_DOMAIN="${RECIPIENT##*@}"
  [[ "$RECIPIENT_DOMAIN" == "$DOMAIN" || "$RECIPIENT_DOMAIN" == *".$DOMAIN" ]] || { echo "Recipient is outside $DOMAIN: $RECIPIENT" >&2; exit 2; }
  printf '%s personal-agent\n' "$RECIPIENT" >> "$RECIPIENTS_FILE"
  if [[ -z "${SEEN_DOMAINS[$RECIPIENT_DOMAIN]:-}" ]]; then
    printf '%s OK\n' "$RECIPIENT_DOMAIN" >> "$DOMAINS_FILE"
    SEEN_DOMAINS[$RECIPIENT_DOMAIN]=1
  fi
done
chmod 600 "$DOMAINS_FILE" "$RECIPIENTS_FILE"
postmap "lmdb:$DOMAINS_FILE"
postmap "lmdb:$RECIPIENTS_FILE"

install -d -m 755 /usr/local/libexec
cat > /usr/local/libexec/personal-agent-mail-forward <<'FORWARDER'
#!/usr/bin/env bash
set -euo pipefail
SENDER="${1:-}"
RECIPIENT="${2:-}"
RELAY_PORT="${PERSONAL_AGENT_RELAY_PORT:-8090}"
ADDRESS_RE="^[a-zA-Z0-9.!#%&'*+/=?^_\`{|}~-]+@[a-zA-Z0-9.-]+$"
[[ -z "$SENDER" || "$SENDER" =~ $ADDRESS_RE ]] || exit 64
[[ "$RECIPIENT" =~ $ADDRESS_RE ]] || exit 64
exec /usr/bin/curl --fail --silent --show-error --max-time 120 \
  -H 'Host: 127.0.0.1' \
  -H 'Content-Type: message/rfc822' \
  -H "X-Personal-Agent-Envelope-Sender: $SENDER" \
  -H "X-Personal-Agent-Envelope-Recipient: $RECIPIENT" \
  --data-binary @- "http://127.0.0.1:${RELAY_PORT}/__personal_agent_relay/mail-ingest"
FORWARDER
chmod 755 /usr/local/libexec/personal-agent-mail-forward

postconf -e "myhostname = mail.$DOMAIN"
postconf -e "myorigin = \$myhostname"
postconf -e "inet_interfaces = all"
postconf -e "inet_protocols = ipv4"
postconf -e "mydestination = localhost.\$mydomain, localhost"
postconf -e "mynetworks_style = host"
postconf -e "relay_domains ="
postconf -e "virtual_mailbox_domains = lmdb:$DOMAINS_FILE"
postconf -e "virtual_mailbox_maps = lmdb:$RECIPIENTS_FILE"
postconf -e "virtual_transport = personal-agent:"
postconf -e "smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination"
postconf -e "smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination"
postconf -e "smtpd_tls_security_level = may"
postconf -e "smtpd_tls_cert_file = $CERT_ROOT/fullchain.cer"
postconf -e "smtpd_tls_key_file = $CERT_ROOT/privkey.key"
postconf -e "smtpd_tls_auth_only = yes"
postconf -e "smtpd_sasl_auth_enable = no"
postconf -e "disable_vrfy_command = yes"
postconf -e "message_size_limit = 20971520"
postconf -e "mailbox_size_limit = 0"

sed -i '/^# BEGIN PERSONAL AGENT MAIL$/,/^# END PERSONAL AGENT MAIL$/d' /etc/postfix/master.cf
cat >> /etc/postfix/master.cf <<MASTER
# BEGIN PERSONAL AGENT MAIL
personal-agent unix - n n - - pipe
  flags=Rq user=nobody null_sender= argv=/usr/bin/env PERSONAL_AGENT_RELAY_PORT=$RELAY_PORT /usr/local/libexec/personal-agent-mail-forward \${sender} \${recipient}
# END PERSONAL AGENT MAIL
MASTER

postfix check
systemctl enable --now postfix.service
systemctl restart postfix.service
ss -ltn '( sport = :25 )' | grep -q ':25' || { echo "Postfix did not open SMTP port 25." >&2; exit 4; }
printf 'Self-hosted mail ready for %s (%s; backup: %s)\n' "$DOMAIN" "$RECIPIENTS_CSV" "$BACKUP_ROOT"
