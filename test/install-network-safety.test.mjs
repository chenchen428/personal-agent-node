import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("ordinary installation and Managed Cloud enrollment never mutate the customer network stack", () => {
  const installer = readTree("core/runtime/native/internal/install") + read("core/runtime/native/cmd/personal-agent-setup/main.go") + read("scripts/build-platform-installer.mjs");
  const managedEnrollment = read("core/runtime/src/cloud-enrollment.ts");
  const setupActions = read("core/runtime/src/setup-actions.ts");
  const forbidden = /\b(?:networksetup|scutil|pfctl|route\s+(?:add|delete|change)|wg-quick|wireguard(?:\.exe)?|osascript|sudo)\b/i;
  assert.doesNotMatch(installer, forbidden);
  assert.doesNotMatch(managedEnrollment, forbidden);
  assert.doesNotMatch(setupActions, forbidden);
  assert.doesNotMatch(managedEnrollment, /prepareManagedWireGuardIdentity|installManagedWireGuardTunnel|edgePublicKey|allowedIPs/);
  assert.match(managedEnrollment, /validateReverseTunnelContract/);
});

function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
function readTree(relative) {
  const directory = path.join(root, relative);
  return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => entry.isDirectory() ? readTree(path.join(relative, entry.name)) : read(path.join(relative, entry.name))).join("\n");
}
