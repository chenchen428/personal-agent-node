#!/usr/bin/env bash
#
# hermes-skills-init.sh — Hermes 技能一键初始化脚本
#
# 安装以下 3 个技能到 ~/.hermes/skills/：
#   1. a1-cli      (devops)              — 从 Contextlab 注册中心安装
#   2. skill-creator (hermes)             — 从 GitHub sparse-checkout 下载
#   3. agent-bridge-codex-run (devops)    — 从内网 GitLab sparse-checkout 下载
#
# 用法:
#   curl -fsSL <url> | bash
#   # 或
#   bash hermes-skills-init.sh
#
set -euo pipefail

# ============================================================
# 配置区
# ============================================================
HERMES_SKILLS_DIR="${HOME}/.hermes/skills"

# a1 CLI
A1_INSTALL_URL="https://git.cn-hangzhou.oss-cdn.aliyun-inc.com/aone-cli/install.sh"

# skill-creator 技能 (GitHub)
SKILL_CREATOR_REPO="anthropics/claude-plugins-official"
SKILL_CREATOR_BRANCH="main"
SKILL_CREATOR_PATH="plugins/skill-creator/skills/skill-creator"

# agent-bridge-codex-run 技能 (内网 GitLab)
AB_REPO="git@gitlab.alibaba-inc.com:onetouch-tech/onetouch-lg-billing.git"
AB_BRANCH="master"
AB_SKILL_PATH="libs/skills/agent-bridge-codex-run"
AB_CLI_PATH="libs/cli/agent-bridge"

# ============================================================
# 工具函数
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
err()   { echo -e "${RED}[✗]${NC} $*"; }
info()  { echo -e "${BLUE}[i]${NC} $*"; }
step()  { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    err "$1 未安装，请先安装 $1"
    return 1
  fi
}

# ============================================================
# 前置检查
# ============================================================
step "1/7 前置检查"

check_cmd curl
check_cmd git
check_cmd node

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  err "Node.js 版本需 >= 18，当前: $(node -v)"
  exit 1
fi
log "Node.js $(node -v)"

# 确保 hermes skills 目录存在
mkdir -p "$HERMES_SKILLS_DIR"
log "Hermes skills 目录: $HERMES_SKILLS_DIR"

# ============================================================
# 清空技能目录（用户确认）
# ============================================================
step "2/7 清空技能目录"

if [ -d "$HERMES_SKILLS_DIR" ] && [ "$(ls -A "$HERMES_SKILLS_DIR" 2>/dev/null)" ]; then
  warn "检测到 ${HERMES_SKILLS_DIR} 中已有技能"
  echo ""
  read -p "是否清空现有技能目录？(y/N): " confirm_clear
  echo ""
  
  if [[ "$confirm_clear" =~ ^[Yy]$ ]]; then
    info "清空 ${HERMES_SKILLS_DIR}..."
    rm -rf "${HERMES_SKILLS_DIR:?}/"*
    rm -rf "${HERMES_SKILLS_DIR:?}/".[!.]*
    log "技能目录已清空"
  else
    info "保留现有技能，将以追加模式安装"
  fi
else
  log "技能目录为空或不存在，直接安装"
fi

# ============================================================
# 安装 a1 CLI
# ============================================================
step "3/7 安装 a1 CLI"

if command -v a1 &>/dev/null; then
  CURRENT_A1_VER=$(a1 version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
  log "a1 CLI 已安装: v${CURRENT_A1_VER}"
  info "跳过安装（如需更新请手动运行: a1 update）"
else
  info "从 ${A1_INSTALL_URL} 安装 a1 CLI..."
  curl -fsSL "$A1_INSTALL_URL" | sh
  log "a1 CLI 安装完成: $(a1 version -q 2>/dev/null || a1 --version 2>/dev/null || echo 'ok')"
fi

# ============================================================
# 安装 a1 技能 (Contextlab 注册中心)
# ============================================================
step "4/7 安装 a1 技能 (从 Contextlab)"

A1_SKILL_DIR="${HERMES_SKILLS_DIR}/devops/a1-cli"
if [ -f "${A1_SKILL_DIR}/SKILL.md" ]; then
  log "a1-cli 技能已存在，跳过"
else
  info "通过 a1 skill install 从 Contextlab 安装..."

  # a1 skill install 不直接支持 hermes agent，用 --location 安装到 hermes skills 目录
  # 安装到临时目录，然后移动到正确的分类目录
  TMP_A1_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hermes-a1-skill.XXXXXX")

  if a1 skill install a1 --location "$TMP_A1_DIR" --skip-update 2>&1; then
    # a1 skill install 会安装到 <location>/a1/ 目录
    INSTALLED_DIR=""
    for candidate in "$TMP_A1_DIR/a1" "$TMP_A1_DIR/.agents/skills/a1"; do
      if [ -f "$candidate/SKILL.md" ]; then
        INSTALLED_DIR="$candidate"
        break
      fi
    done

    # 如果上述路径不存在，在 location 下搜索
    if [ -z "$INSTALLED_DIR" ]; then
      INSTALLED_DIR=$(find "$TMP_A1_DIR" -name "SKILL.md" -maxdepth 3 -print -quit 2>/dev/null | xargs dirname 2>/dev/null || true)
    fi

    if [ -n "$INSTALLED_DIR" ] && [ -f "$INSTALLED_DIR/SKILL.md" ]; then
      mkdir -p "$A1_SKILL_DIR"
      cp -R "$INSTALLED_DIR"/* "$A1_SKILL_DIR"/ 2>/dev/null || true
      cp -R "$INSTALLED_DIR"/.[!.]* "$A1_SKILL_DIR"/ 2>/dev/null || true
      log "a1-cli 技能安装完成 → ${A1_SKILL_DIR}"
    else
      warn "a1 skill install 未找到 SKILL.md，尝试备选方案..."
      # 备选：直接从注册中心读取
      mkdir -p "$A1_SKILL_DIR"
      a1 skill read a1 > "${A1_SKILL_DIR}/SKILL.md" 2>/dev/null || {
        err "a1 技能安装失败"
      }
      log "a1-cli 技能安装完成（via skill read）→ ${A1_SKILL_DIR}"
    fi
  else
    warn "a1 skill install 失败，跳过"
  fi

  rm -rf "$TMP_A1_DIR"
fi

# ============================================================
# 安装 skill-creator 技能 (GitHub sparse-checkout)
# ============================================================
step "5/7 安装 skill-creator 技能 (从 GitHub)"

SC_SKILL_DIR="${HERMES_SKILLS_DIR}/hermes/skill-creator"
if [ -f "${SC_SKILL_DIR}/SKILL.md" ]; then
  log "skill-creator 技能已存在，跳过"
else
  mkdir -p "$SC_SKILL_DIR"
  TMP_SC=$(mktemp -d "${TMPDIR:-/tmp}/hermes-skill-creator.XXXXXX")

  info "Git sparse-checkout ${SKILL_CREATOR_REPO}..."
  if git clone \
    --filter=blob:none \
    --sparse \
    --single-branch \
    --branch "$SKILL_CREATOR_BRANCH" \
    --depth 1 \
    "https://github.com/${SKILL_CREATOR_REPO}.git" \
    "$TMP_SC" 2>&1; then

    git -C "$TMP_SC" sparse-checkout set "$SKILL_CREATOR_PATH" 2>&1

    SRC="${TMP_SC}/${SKILL_CREATOR_PATH}"
    if [ -f "${SRC}/SKILL.md" ]; then
      cp -R "$SRC"/* "$SC_SKILL_DIR"/ 2>/dev/null || true
      cp -R "$SRC"/.[!.]* "$SC_SKILL_DIR"/ 2>/dev/null || true
      log "skill-creator 技能安装完成 → ${SC_SKILL_DIR}"
    else
      err "skill-creator SKILL.md 未找到（sparse-checkout 可能失败）"
    fi
  else
    # 备选方案：逐个 curl 下载核心文件
    warn "git clone 失败，尝试 curl 逐个下载..."
    SC_BASE_URL="https://raw.githubusercontent.com/${SKILL_CREATOR_REPO}/${SKILL_CREATOR_BRANCH}/${SKILL_CREATOR_PATH}"

    # 核心文件列表
    SC_FILES=(
      "SKILL.md"
      "agents/analyzer.md"
      "agents/comparator.md"
      "agents/grader.md"
      "assets/eval_review.html"
      "eval-viewer/generate_review.py"
      "eval-viewer/viewer.html"
      "references/schemas.md"
      "scripts/__init__.py"
      "scripts/aggregate_benchmark.py"
      "scripts/generate_report.py"
      "scripts/improve_description.py"
      "scripts/package_skill.py"
      "scripts/quick_validate.py"
      "scripts/run_eval.py"
      "scripts/run_loop.py"
      "scripts/utils.py"
    )

    for f in "${SC_FILES[@]}"; do
      dir=$(dirname "$f")
      if [ "$dir" != "." ]; then
        mkdir -p "${SC_SKILL_DIR}/${dir}"
      fi
      curl -fsSL --connect-timeout 15 --max-time 30 \
        "${SC_BASE_URL}/${f}" \
        -o "${SC_SKILL_DIR}/${f}" 2>/dev/null || warn "  下载失败: $f"
    done
    log "skill-creator 技能安装完成（via curl fallback）→ ${SC_SKILL_DIR}"
  fi

  rm -rf "$TMP_SC"
fi

# ============================================================
# 安装 agent-bridge-codex-run 技能 (内网 GitLab sparse-checkout)
# ============================================================
step "6/7 安装 agent-bridge-codex-run 技能 (从内网 GitLab)"

AB_SKILL_DIR="${HERMES_SKILLS_DIR}/devops/agent-bridge-codex-run"
if [ -f "${AB_SKILL_DIR}/SKILL.md" ]; then
  log "agent-bridge-codex-run 技能已存在，跳过"
else
  TMP_AB=$(mktemp -d "${TMPDIR:-/tmp}/hermes-agent-bridge.XXXXXX")

  info "Git sparse-checkout ${AB_REPO} (branch: ${AB_BRANCH})..."
  if git clone \
    --filter=blob:none \
    --sparse \
    --single-branch \
    --branch "$AB_BRANCH" \
    --depth 1 \
    "$AB_REPO" \
    "$TMP_AB" 2>&1; then

    # 检出技能目录和 CLI 目录
    git -C "$TMP_AB" sparse-checkout set "$AB_SKILL_PATH" "$AB_CLI_PATH" 2>&1

    # 复制技能文件
    AB_SRC="${TMP_AB}/${AB_SKILL_PATH}"
    if [ -f "${AB_SRC}/SKILL.md" ]; then
      mkdir -p "$AB_SKILL_DIR"
      cp -R "$AB_SRC"/* "$AB_SKILL_DIR"/ 2>/dev/null || true
      cp -R "$AB_SRC"/.[!.]* "$AB_SKILL_DIR"/ 2>/dev/null || true

      # 复制 CLI 到 vendor/（如果技能目录下没有 vendor/）
      AB_CLI_SRC="${TMP_AB}/${AB_CLI_PATH}"
      if [ -d "$AB_CLI_SRC" ] && [ ! -d "${AB_SKILL_DIR}/vendor/agent-bridge" ]; then
        mkdir -p "${AB_SKILL_DIR}/vendor"
        cp -R "$AB_CLI_SRC" "${AB_SKILL_DIR}/vendor/agent-bridge"
        info "CLI 已复制到 vendor/agent-bridge/"

        # 安装 node_modules（如果有 package.json 且无 node_modules）
        if [ -f "${AB_SKILL_DIR}/vendor/agent-bridge/package.json" ] && \
           [ ! -d "${AB_SKILL_DIR}/vendor/agent-bridge/node_modules" ]; then
          info "安装 vendor/agent-bridge 依赖..."
          (cd "${AB_SKILL_DIR}/vendor/agent-bridge" && npm install --production 2>&1) || warn "npm install 失败，可能需要手动安装"
        fi
      fi

      log "agent-bridge-codex-run 技能安装完成 → ${AB_SKILL_DIR}"
    else
      err "agent-bridge-codex-run SKILL.md 未找到"
      err "  预期路径: ${AB_SRC}/SKILL.md"
    fi
  else
    err "git clone ${AB_REPO} 失败（可能需要 SSH 权限或内网访问）"
    err "  请确认："
    err "    1. 已配置 GitLab SSH key"
    err "    2. 在内网环境中"
  fi

  rm -rf "$TMP_AB"
fi

# ============================================================
# 验证安装结果
# ============================================================
step "7/7 验证安装结果"

echo ""
echo "已安装的技能文件："
echo ""

SKILL_COUNT=0
for skill_dir in \
  "${HERMES_SKILLS_DIR}/devops/a1-cli" \
  "${HERMES_SKILLS_DIR}/hermes/skill-creator" \
  "${HERMES_SKILLS_DIR}/devops/agent-bridge-codex-run"; do

  name=$(basename "$skill_dir")
  category=$(basename "$(dirname "$skill_dir")")

  if [ -f "${skill_dir}/SKILL.md" ]; then
    file_count=$(find "$skill_dir" -type f | wc -l | tr -d ' ')
    log "${name} (${category}) — ${file_count} 个文件"
    SKILL_COUNT=$((SKILL_COUNT + 1))
  else
    err "${name} (${category}) — SKILL.md 缺失"
  fi
done

echo ""
if [ "$SKILL_COUNT" -eq 3 ]; then
  log "全部 3 个技能安装成功！"
elif [ "$SKILL_COUNT" -gt 0 ]; then
  warn "${SKILL_COUNT}/3 个技能安装成功，请检查失败项"
else
  err "所有技能安装失败"
fi

echo ""
if command -v hermes &>/dev/null; then
  info "运行 hermes skills list 查看完整列表："
  hermes skills list 2>&1 || true
else
  info "hermes 命令未找到，请手动验证 ~/.hermes/skills/ 目录"
fi

echo ""
log "完成！路径: ${HERMES_SKILLS_DIR}"
