#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDGE_ROOT="${PRIVATE_SITE_EDGE_ROOT:-/opt/private-site-edge}"
SSH_HOST="${PERSONAL_AGENT_SSH_HOST:-personal-agent.local}"
SSH_USER="${PERSONAL_AGENT_SSH_USER:-root}"
SSH_KEY="${PERSONAL_AGENT_SSH_KEY:-$ROOT_DIR/secrets/ssh/personal-agent.local.pem}"
revision="$(git -C "$ROOT_DIR" rev-parse HEAD)"
release_id="${PRIVATE_SITE_EDGE_RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}}"
output="$ROOT_DIR/dist/private-site-edge/$release_id"
archive="$ROOT_DIR/.local/deploy/private-site-edge/$release_id.tar.gz"

[[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || { echo "Edge deployment requires a clean worktree." >&2; exit 1; }
node "$ROOT_DIR/scripts/build-private-site-edge-dist.mjs" --release-id "$release_id" --output "$output"
node "$ROOT_DIR/scripts/verify-private-site-edge-dist.mjs" "$output"
mkdir -p "$(dirname "$archive")"
tar -C "$output" -czf "$archive" .

remote_archive="/tmp/private-site-edge-$release_id.tar.gz"
"$ROOT_DIR/scripts/ssh-server.sh" "mkdir -p '$EDGE_ROOT/releases/$release_id' && test ! -e '$EDGE_ROOT/.release-lock' && printf '%s\n' '$release_id' > '$EDGE_ROOT/.release-lock'"
cleanup() {
  rm -f -- "$archive"
  "$ROOT_DIR/scripts/ssh-server.sh" "current=\$(readlink -f '$EDGE_ROOT/current' 2>/dev/null || true); candidate=\$(readlink -f '$EDGE_ROOT/releases/$release_id' 2>/dev/null || true); rm -f '$remote_archive' '$EDGE_ROOT/.release-lock'; if [[ -n \"\$candidate\" && \"\$candidate\" != \"\$current\" ]]; then rm -rf '$EDGE_ROOT/releases/$release_id'; fi" >/dev/null 2>&1 || true
}
trap cleanup EXIT
scp -q -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes "$archive" "$SSH_USER@$SSH_HOST:$remote_archive"
"$ROOT_DIR/scripts/ssh-server.sh" "tar -xzf '$remote_archive' -C '$EDGE_ROOT/releases/$release_id' && bash '$EDGE_ROOT/releases/$release_id/scripts/install-private-site-edge-release.sh' '$EDGE_ROOT/releases/$release_id'"
"$ROOT_DIR/scripts/ssh-server.sh" "nginx -t >/dev/null && systemctl is-active --quiet wg-quick@wg0.service nginx.service && node '$EDGE_ROOT/current/projects/core/edge/bin/private-site-edge.mjs' verify >/dev/null"
node "$ROOT_DIR/scripts/prune-local-dist.mjs" "$ROOT_DIR/dist/private-site-edge" 2 >/dev/null
printf '[private-site-edge] Deployment accepted: %s; retained two local artifacts\n' "$release_id"
