#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOKS_DIR="$ROOT/.githooks"
CURRENT_PATH="$(git -C "$ROOT" config --local --get core.hooksPath 2>/dev/null || true)"
ACTION="${1:-install}"

case "$ACTION" in
  install|--install|-i|"")
    if [[ ! -d "$HOOKS_DIR" ]]; then
      echo "[install-hooks] missing $HOOKS_DIR" >&2
      exit 1
    fi
    git -C "$ROOT" config --local core.hooksPath .githooks
    chmod +x "$HOOKS_DIR"/* 2>/dev/null || true
    chmod +x "$ROOT/scripts/project-guard.mjs" "$ROOT/scripts/skill-guard.mjs" "$ROOT/scripts/skill-tree.mjs" 2>/dev/null || true
    echo "[install-hooks] installed core.hooksPath=.githooks"
    ;;
  --check|-c)
    echo "[install-hooks] project root  : $ROOT"
    echo "[install-hooks] hooks dir     : $HOOKS_DIR ($([[ -d "$HOOKS_DIR" ]] && echo OK || echo MISSING))"
    echo "[install-hooks] core.hooksPath : ${CURRENT_PATH:-<unset>}"
    echo "[install-hooks] pre-commit    : $([[ -x "$HOOKS_DIR/pre-commit" ]] && echo 'OK (executable)' || echo 'MISSING or not executable')"
    if [[ "$CURRENT_PATH" == ".githooks" && -x "$HOOKS_DIR/pre-commit" ]]; then
      echo "[install-hooks] INSTALLED"
      exit 0
    fi
    echo "[install-hooks] NOT INSTALLED"
    exit 1
    ;;
  --uninstall|-u)
    git -C "$ROOT" config --local --unset core.hooksPath 2>/dev/null || true
    echo "[install-hooks] uninstalled core.hooksPath"
    ;;
  *)
    echo "Usage: $0 [install|--check|--uninstall]" >&2
    exit 2
    ;;
esac
