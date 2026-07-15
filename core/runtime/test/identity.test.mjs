import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareManagedWireGuardIdentity, validateManagedTunnelContract, writeWireGuardTunnelConfig } from "../src/identity.ts";

test("WireGuard tunnel writes report only material configuration changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-wireguard-"));
  const tunnelPath = path.join(root, "private-site.conf");
  const input = {
    tunnelPath,
    privateKey: "private",
    address: "10.77.0.2/32",
    edgePublicKey: "public",
    endpoint: "example.site:51820",
  };
  try {
    const first = writeWireGuardTunnelConfig(input);
    const repeated = writeWireGuardTunnelConfig(input);
    const changed = writeWireGuardTunnelConfig({ ...input, endpoint: "new.example.site:51820" });
    assert.equal(first.changed, true);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.configHash, first.configHash);
    assert.equal(changed.changed, true);
    assert.notEqual(changed.configHash, first.configHash);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("managed WireGuard identity remains local and contract rejects lateral routes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-wg-identity-"));
  try {
    const config = { dataRoot: root };
    const first = prepareManagedWireGuardIdentity(config);
    const second = prepareManagedWireGuardIdentity(config);
    assert.equal(first.publicKey, second.publicKey);
    assert.match(first.publicKey, /^[A-Za-z0-9+/]{43}=$/);
    assert.ok(fs.statSync(first.privateKeyPath).isFile());
    if (process.platform !== "win32") assert.equal(fs.statSync(first.privateKeyPath).mode & 0o777, 0o600);
    const base = { schemaVersion: 1, edgePublicKey: `${"E".repeat(43)}=`, endpoint: "edge.chenjianhui.site:51821", address: "10.77.0.2/32", allowedIPs: ["10.77.0.1/32"], dns: ["10.77.0.1"], persistentKeepalive: 25 };
    assert.doesNotThrow(() => validateManagedTunnelContract(base));
    assert.throws(() => validateManagedTunnelContract({ ...base, allowedIPs: ["10.77.0.0/24", "192.168.0.0/16"] }), /AllowedIPs/);
    assert.throws(() => validateManagedTunnelContract({ ...base, address: "10.77.0.1/32" }), /address/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
