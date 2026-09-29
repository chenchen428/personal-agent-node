#!/usr/bin/env bash
set -euo pipefail

tag=""
output=""
platform=""
arch=""
stage_file=""
while (($#)); do
  case "$1" in
    --stage-file) stage_file="${2:?--stage-file requires a value}"; shift 2 ;;
    --tag) tag="${2:?--tag requires a value}"; shift 2 ;;
    --output) output="${2:?--output requires a value}"; shift 2 ;;
    --platform) platform="${2:?--platform requires a value}"; shift 2 ;;
    --arch) arch="${2:?--arch requires a value}"; shift 2 ;;
    *) echo "Unsupported platform installer option: $1" >&2; exit 2 ;;
  esac
done
if [[ "$platform" != darwin || -z "$tag" || -z "$output" || -z "$stage_file" || ! "$arch" =~ ^(x64|arm64)$ ]]; then
  echo 'macOS verification requires --stage-file, --tag, --output, --platform darwin, and --arch x64|arm64' >&2
  exit 2
fi

node_bin="${PERSONAL_AGENT_BUILD_NODE:-node}"
updater="$output/personal-agent-node-$tag-macos-$arch-updater"
asset="$output/personal-agent-node-$tag-macos-$arch.pkg"
codesign --verify --strict --verbose=2 "$updater"
"$updater" inspect
"$node_bin" - "$stage_file" "$updater" "$asset" "$tag" "$arch" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const [stageFile, updater, asset, tag, arch] = process.argv.slice(2);
const staged = JSON.parse(fs.readFileSync(stageFile, 'utf8'));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (staged.ok !== false || staged.staged !== true || staged.platform !== 'darwin'
  || staged.tag !== tag || staged.architecture !== arch
  || path.resolve(staged.updater) !== path.resolve(updater) || path.resolve(staged.asset) !== path.resolve(asset)
  || digest(updater) !== staged.updaterSha256 || digest(asset) !== staged.sha256) {
  throw new Error('macOS candidate failed final signed updater or embedded release verification');
}
delete staged.staged;
staged.ok = true;
staged.inspection = { status: 'passed' };
console.log(JSON.stringify(staged, null, 2));
NODE
