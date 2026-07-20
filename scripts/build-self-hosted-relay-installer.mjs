#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const metadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tag = args.tag || `v${metadata.version}`;
if (tag !== `v${metadata.version}`) throw new Error(`Relay installer tag ${tag} does not match package version v${metadata.version}`);
const output = path.resolve(args.output || path.join(root, "dist", "relay-release"));
const { build } = createRequire(path.join(root, "package.json"))("esbuild");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const built = await build({
  entryPoints: [path.join(root, "core", "edge", "bin", "self-hosted-relay.mjs")],
  bundle: true,
  write: false,
  platform: "node",
  target: "node22",
  format: "esm",
  legalComments: "none",
  banner: { js: "import { createRequire as __personalAgentCreateRequire } from 'node:module'; const require = __personalAgentCreateRequire(import.meta.url);" },
});
const relay = built.outputFiles?.[0]?.text;
if (!relay) throw new Error("Relay bundle was not produced");
const installer = fs.readFileSync(path.join(root, "infra", "edge", "install-self-hosted-relay.sh"), "utf8");
const assetName = "personal-agent-relay-install.sh";
const target = path.join(output, assetName);
fs.writeFileSync(target, selfExtractingInstaller({ tag, installer, relay }), { mode: 0o755 });
process.stdout.write(`${JSON.stringify({ ok: true, tag, asset: assetName, output: target }, null, 2)}\n`);

function selfExtractingInstaller({ tag, installer, relay }) {
  return `#!/usr/bin/env bash
set -euo pipefail

DOMAIN="\${1:-}"
TOKEN_MODE="\${2:-}"
[[ -n "$DOMAIN" ]] || { echo "Usage: sudo bash personal-agent-relay-install.sh <domain> [--rotate-token]" >&2; exit 2; }
[[ -z "$TOKEN_MODE" || "$TOKEN_MODE" == "--rotate-token" ]] || { echo "Unknown installer option." >&2; exit 2; }

TEMP_ROOT="$(mktemp -d /tmp/personal-agent-relay.XXXXXX)"
trap 'rm -rf "$TEMP_ROOT"' EXIT
INSTALLER_PATH="$TEMP_ROOT/install-self-hosted-relay.sh"
RELAY_PATH="$TEMP_ROOT/self-hosted-relay.mjs"

base64_decode() {
  if base64 --help 2>&1 | grep -q -- '--decode'; then base64 --decode
  else base64 -D
  fi
}

base64_decode > "$INSTALLER_PATH" <<'PERSONAL_AGENT_INSTALLER'
${Buffer.from(installer).toString("base64")}
PERSONAL_AGENT_INSTALLER
base64_decode > "$RELAY_PATH" <<'PERSONAL_AGENT_RELAY'
${Buffer.from(relay).toString("base64")}
PERSONAL_AGENT_RELAY
chmod 700 "$INSTALLER_PATH"
chmod 755 "$RELAY_PATH"

echo "Installing Personal Agent Relay ${tag} for $DOMAIN"
bash "$INSTALLER_PATH" "$DOMAIN" "$RELAY_PATH" "$TOKEN_MODE"
`;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--tag") result.tag = argv[++index];
    else if (argv[index] === "--output") result.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return result;
}
