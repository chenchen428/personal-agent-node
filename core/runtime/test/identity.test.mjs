import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeWireGuardTunnelConfig } from "../src/identity.ts";

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
