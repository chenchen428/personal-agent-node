#!/usr/bin/env bash
set -euo pipefail

CREDENTIALS_FILE="${ALIYUN_ACME_ENV:-/etc/private-site-edge/acme.env}"
PORT="${PRIVATE_SITE_EDGE_WG_PORT:-51820}"
METADATA="http://100.100.100.200/latest/meta-data"

[[ "$(id -u)" == "0" ]] || { echo "Run Aliyun security group authorization as root." >&2; exit 1; }
[[ -f "$CREDENTIALS_FILE" ]] || { echo "Missing Aliyun credential file." >&2; exit 1; }
[[ "$(stat -c '%a' "$CREDENTIALS_FILE")" == "600" ]] || { echo "Aliyun credential file must use mode 600." >&2; exit 1; }
command -v aliyun >/dev/null 2>&1 || { echo "Aliyun CLI is required." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$CREDENTIALS_FILE"
set +a
[[ -n "${Ali_Key:-}" && -n "${Ali_Secret:-}" ]] || { echo "Aliyun credentials are incomplete." >&2; exit 1; }
export ALIBABA_CLOUD_ACCESS_KEY_ID="$Ali_Key"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="$Ali_Secret"

region="$(curl -fsS "$METADATA/region-id")"
instance_id="$(curl -fsS "$METADATA/instance-id")"
instance_json="$(aliyun --region "$region" ecs DescribeInstances --RegionId "$region" --InstanceIds "[\"$instance_id\"]")"
security_group_id="$(printf '%s' "$instance_json" | node -e '
let value = ""; process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => {
  const data = JSON.parse(value);
  const id = data?.Instances?.Instance?.[0]?.SecurityGroupIds?.SecurityGroupId?.[0];
  if (!id) process.exit(2);
  process.stdout.write(id);
});')"
[[ -n "$security_group_id" ]] || { echo "No security group found for the current ECS instance." >&2; exit 1; }

permissions="$(aliyun --region "$region" ecs DescribeSecurityGroupAttribute --RegionId "$region" --SecurityGroupId "$security_group_id" --Direction ingress)"
if printf '%s' "$permissions" | PORT="$PORT" node -e '
let value = ""; process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => {
  const rules = JSON.parse(value)?.Permissions?.Permission || [];
  const port = process.env.PORT + "/" + process.env.PORT;
  process.exit(rules.some(rule => String(rule.IpProtocol).toLowerCase() === "udp"
    && rule.PortRange === port && rule.Policy === "Accept") ? 0 : 1);
});'; then
  printf '[private-site-edge] Aliyun UDP %s security-group rule already exists.\n' "$PORT"
  exit 0
fi

aliyun --region "$region" ecs AuthorizeSecurityGroup \
  --RegionId "$region" \
  --SecurityGroupId "$security_group_id" \
  --IpProtocol UDP \
  --PortRange "$PORT/$PORT" \
  --SourceCidrIp "0.0.0.0/0" \
  --Policy accept \
  --Priority 10 >/dev/null
printf '[private-site-edge] Authorized Aliyun UDP %s for the WireGuard hub.\n' "$PORT"
