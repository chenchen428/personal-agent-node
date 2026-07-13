#!/usr/bin/env bash
# 独立安装 abg（@onetouch/agent-bridge-cli），不依赖任何技能目录。
# 把 CLI 落到用户级固定目录 ~/.agent-bridge/cli，装好运行期依赖，
# 在 PATH 里写入 abg 启动器（必要时自动写入 shell profile），最后打印使用指引。
#
# 用法:
#   bash install.sh            # 默认替换安装:总是重新拷贝并覆盖 ~/.agent-bridge/cli
#   bash install.sh --force    # 兼容保留,与默认行为一致
#
# 可用环境变量覆盖:
#   AGENT_BRIDGE_HOME        安装根目录（默认 ~/.agent-bridge），CLI 落在其下 cli/
#   AGENT_BRIDGE_CLI_BIN_DIR abg 启动器目录（默认自动选择 PATH 里的可写目录）
#   AGENT_BRIDGE_CLI_REPO    git 仓库：无本地源时用于 sparse checkout（默认 gitlab onetouch-lg-billing）
#   AGENT_BRIDGE_CLI_BRANCH  分支（默认 master）
set -euo pipefail

# 兼容 curl … | sh：从 stdin 运行时没有脚本文件，BASH_SOURCE[0] 为空，回退到 $0，再取不到就用 CWD。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
HOME_DIR="${AGENT_BRIDGE_HOME:-$HOME/.agent-bridge}"
DEST_DIR="$HOME_DIR/cli"
REPO="${AGENT_BRIDGE_CLI_REPO:-git@gitlab.alibaba-inc.com:onetouch-tech/onetouch-lg-billing.git}"
BRANCH="${AGENT_BRIDGE_CLI_BRANCH:-master}"
SUBDIR="libs/cli/agent-bridge"

log() { echo "[abg-install] $*"; }
die() { echo "[abg-install] $*" >&2; exit 1; }

# —— 前置检查:node >= 20 ——
command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js >= 20"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || die "Node.js 版本过低（当前 $(node -v)），需要 >= 20"

path_contains() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

can_write_bin_dir() {
  local dir="$1" parent
  if [ -d "$dir" ] && [ -w "$dir" ]; then return 0; fi
  parent="$(dirname "$dir")"
  [ ! -e "$dir" ] && [ -d "$parent" ] && [ -w "$parent" ]
}

# —— 选择 abg 启动器目录:优先 PATH 里已存在且可写的常见目录 ——
resolve_bin_dir() {
  if [ -n "${AGENT_BRIDGE_CLI_BIN_DIR:-}" ]; then
    printf '%s\n' "$AGENT_BRIDGE_CLI_BIN_DIR"; return
  fi
  local dir
  for dir in "$HOME/.local/bin" "$HOME/bin" /usr/local/bin /opt/homebrew/bin; do
    if path_contains "$dir" && can_write_bin_dir "$dir"; then
      printf '%s\n' "$dir"; return
    fi
  done
  for dir in "$HOME/.local/bin" "$HOME/bin"; do
    if can_write_bin_dir "$dir"; then printf '%s\n' "$dir"; return; fi
  done
  printf '%s\n' "$HOME/.local/bin"
}

# —— 把目录写进对应 shell 的 profile（幂等），让新终端自动带上 PATH ——
ensure_dir_on_path() {
  local dir="$1" profile line marker
  path_contains "$dir" && return 0
  case "$(basename "${SHELL:-sh}")" in
    zsh)  profile="$HOME/.zshrc" ;;
    bash) profile="$HOME/.bashrc" ;;
    *)    profile="$HOME/.profile" ;;
  esac
  line="export PATH=\"$dir:\$PATH\""
  marker="# added by agent-bridge (abg) installer"
  if [ -f "$profile" ] && grep -Fq "$line" "$profile"; then
    PATH_PROFILE="$profile"; return 0
  fi
  printf '\n%s\n%s\n' "$marker" "$line" >> "$profile"
  PATH_PROFILE="$profile"
  log "已写入 PATH 到 $profile"
}

write_launcher() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  can_write_bin_dir "$bin_dir" || die "命令目录不可写: $bin_dir（可用 AGENT_BRIDGE_CLI_BIN_DIR 指定其他目录）"
  cat > "$bin_dir/abg" <<EOF
#!/usr/bin/env bash
exec node "$DEST_DIR/bin/agent-bridge.mjs" "\$@"
EOF
  chmod +x "$bin_dir/abg"
  log "abg -> $bin_dir/abg"
  ensure_dir_on_path "$bin_dir"
}

# —— 定位 CLI 源:优先脚本自身所在的 CLI 包，其次 git sparse checkout ——
copy_cli_source() {
  rm -rf "$DEST_DIR"
  mkdir -p "$DEST_DIR"
  if [ -f "$SCRIPT_DIR/bin/agent-bridge.mjs" ]; then
    log "从本地源拷贝: $SCRIPT_DIR"
    cp -R "$SCRIPT_DIR/bin" "$SCRIPT_DIR/lib" "$SCRIPT_DIR/package.json" "$DEST_DIR/"
  elif [ -n "$REPO" ]; then
    command -v git >/dev/null 2>&1 || die "未找到 git，请先安装 git 后重试"
    local tmp
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/agent-bridge-cli.XXXXXX")"
    trap 'rm -rf "$tmp"' RETURN
    log "sparse-checkout $SUBDIR <- $REPO @ $BRANCH"
    git clone --filter=blob:none --sparse --single-branch --branch "$BRANCH" "$REPO" "$tmp"
    git -C "$tmp" sparse-checkout set "$SUBDIR"
    cp -R "$tmp/$SUBDIR/bin" "$tmp/$SUBDIR/lib" "$tmp/$SUBDIR/package.json" "$DEST_DIR/"
  else
    die "未找到本地 CLI 源。请在 CLI 包内运行本脚本，或设置 AGENT_BRIDGE_CLI_REPO 指向 git 仓库。"
  fi
}

usage_guide() {
  cat <<EOF

──────────────────────────────────────────────
 abg 安装完成 ✅   安装目录: $DEST_DIR
──────────────────────────────────────────────
EOF
  if [ -n "${PATH_PROFILE:-}" ] && ! path_contains "$(dirname "$BIN_DIR/abg")"; then
    cat <<EOF
 当前终端还没生效，先执行一次(或新开终端):
   source $PATH_PROFILE
EOF
  fi
  cat <<'EOF'
 快速开始:
   abg start      交互式选择环境并输入工号，启动本机 worker
   abg status     查看本机 worker 是否在线
   abg stop       停止 worker
   abg help       查看全部命令

 启动成功后 CLI 会打印一条 console 链接，
 在浏览器打开即可进入 Web 控制台远程驱动本机 Codex。
──────────────────────────────────────────────
EOF
}

BIN_DIR="$(resolve_bin_dir)"

# 默认替换安装:总是重新拷贝并覆盖。
copy_cli_source

log "安装运行期依赖 ws / qrcode-terminal 到 $DEST_DIR/node_modules"
( cd "$DEST_DIR" && npm install --no-audit --no-fund --no-save ws qrcode-terminal >/dev/null 2>&1 ) \
  || die "npm 安装依赖失败，请检查网络或 npm 配置"

node "$DEST_DIR/bin/agent-bridge.mjs" help >/dev/null 2>&1 \
  || die "自检失败:CLI 无法启动（依赖未装好?）"

write_launcher "$BIN_DIR"
log "OK -> $DEST_DIR"
usage_guide
