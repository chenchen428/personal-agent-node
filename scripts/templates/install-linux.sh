#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_TAG="__PERSONAL_AGENT_TAG__"
readonly REPOSITORY="chenchen428/personal-agent-node"
readonly RELEASE_BASE="https://github.com/${REPOSITORY}/releases/download/${RELEASE_TAG}"

fail() {
  printf 'Personal Agent Linux install failed: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

[[ "$(uname -s)" == "Linux" ]] || fail "this installer supports Linux only"
[[ "$(id -u)" -ne 0 ]] || fail "run this installer as the non-root user who will own Personal Agent"

case "$(uname -m)" in
  x86_64|amd64) architecture="x64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *) fail "unsupported Linux architecture: $(uname -m)" ;;
esac

for command_name in curl tar sha256sum systemctl loginctl; do
  require_command "$command_name"
done

owner="$(id -un)"
linger="$(loginctl show-user "$owner" -p Linger --value 2>/dev/null || true)"
if [[ "$linger" != "yes" ]]; then
  if ! loginctl enable-linger "$owner" >/dev/null 2>&1; then
    require_command sudo
    sudo loginctl enable-linger "$owner"
  fi
fi

systemctl --user show-environment >/dev/null 2>&1 || fail "systemd user services are unavailable in this login session"

asset="personal-agent-node-${RELEASE_TAG}-linux-${architecture}.tar.gz"
temporary="$(mktemp -d)"
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  --output "$temporary/$asset" "$RELEASE_BASE/$asset"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  --output "$temporary/SHA256SUMS" "$RELEASE_BASE/SHA256SUMS"

expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "$temporary/SHA256SUMS")"
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail "release checksum is missing or invalid for $asset"
actual="$(sha256sum "$temporary/$asset" | awk '{ print $1 }')"
[[ "$actual" == "$expected" ]] || fail "release checksum verification failed for $asset"

tar -xzf "$temporary/$asset" -C "$temporary"
setup="$temporary/personal-agent-node-${RELEASE_TAG}-linux-${architecture}/personal-agent-setup"
[[ -x "$setup" ]] || fail "the verified release does not contain personal-agent-setup"

"$setup" install --no-open

printf '\nPersonal Agent %s is running as a headless systemd user service.\n' "$RELEASE_TAG"
printf 'From your own computer, open an SSH tunnel:\n'
printf '  ssh -N -L 8843:127.0.0.1:8843 %s@<server>\n' "$owner"
printf 'Then open http://127.0.0.1:8843/app/setup in your browser.\n'
printf 'CLI: %s/.personal-agent/core/bin/personal-agent status --json\n' "$HOME"
