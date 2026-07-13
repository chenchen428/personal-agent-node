#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---check}"
[[ "$MODE" == "--check" || "$MODE" == "--force" ]] || { echo "Usage: scripts/setup-agent-bridge.sh [--check|--force]" >&2; exit 2; }
ensure_link() {
  local link_path="$1" target="$2" full="$ROOT_DIR/$1"
  if [[ "$MODE" == "--check" ]]; then
    [[ -L "$full" && "$(readlink "$full")" == "$target" ]] && { echo "[OK] $link_path -> $target"; return; }
    echo "[MISSING] $link_path -> $target"; return 1
  fi
  mkdir -p "$(dirname "$full")"; rm -rf "$full"; ln -s "$target" "$full"; echo "[OK] $link_path -> $target"
}
status=0
ensure_link CLAUDE.md AGENTS.md || status=1
for client in .agents .claude .cursor .codex; do ensure_link "$client/skills" ../skills || status=1; done
exit "$status"
