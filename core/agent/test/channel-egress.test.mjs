import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const renderer = path.join(workspaceRoot, "core", "channels", "egress", "scripts", "render-config.mjs");

test("channel egress renderer creates a loopback-only Shadowsocks config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "channel-egress-test-"));
  try {
    const envPath = path.join(root, "shadowsocks.env");
    const outputPath = path.join(root, "sing-box.json");
    fs.writeFileSync(envPath, [
      "CHANNEL_EGRESS_SS_SERVER=ss.example.test",
      "CHANNEL_EGRESS_SS_PORT=8388",
      "CHANNEL_EGRESS_SS_METHOD=2022-blake3-aes-128-gcm",
      "CHANNEL_EGRESS_SS_PASSWORD=test-only-password",
      "",
    ].join("\n"));
    execFileSync(process.execPath, [renderer, "--env", envPath, "--output", outputPath]);
    const config = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    assert.equal(config.inbounds[0].listen, "127.0.0.1");
    assert.equal(config.inbounds[0].listen_port, 1080);
    assert.equal(config.outbounds[0].server, "ss.example.test");
    assert.equal(config.outbounds[0].server_port, 8388);
    assert.equal(config.route.final, "channel-ss-out");
    if (process.platform !== "win32") assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("channel egress renderer fails closed when secrets are incomplete", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "channel-egress-test-"));
  try {
    const envPath = path.join(root, "shadowsocks.env");
    fs.writeFileSync(envPath, "CHANNEL_EGRESS_SS_SERVER=ss.example.test\n");
    assert.throws(() => execFileSync(process.execPath, [renderer, "--env", envPath, "--output", path.join(root, "config.json")], { stdio: "pipe" }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("channel state is owned by the local Node without cloud storage", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "registry", "extensions.json"), "utf8"));
  const egress = registry.extensions.find((extension) => extension.id === "channel-egress");
  assert.equal(egress.kind, "infrastructure");
  assert.equal(egress.status, "migrating");
  assert.deepEqual(egress.permissions, ["network-proxy"]);
  assert.doesNotMatch(JSON.stringify(egress), /OSS|\/opt\/personal-agent\.site|\/var\/lib\/personal-agent\.site/i);
});

test("channel runtime installation restores every browser helper executable", () => {
  const source = fs.readFileSync(path.join(workspaceRoot, "scripts", "build-channel-runtimes.mjs"), "utf8");
  assert.match(source, /"chrome_crashpad_handler"/);
  assert.match(source, /"chromedriver"/);
  assert.match(source, /chmodSync/);
});

test("channel runtime tar extraction never passes Windows drive paths to tar", () => {
  const builder = fs.readFileSync(path.join(workspaceRoot, "scripts", "build-channel-runtimes.mjs"), "utf8");
  assert.match(builder, /cwd: archiveDir/);
  assert.match(builder, /path\.basename\(archive\)/);
  assert.match(builder, /path\.basename\(target\)/);
  assert.doesNotMatch(builder, /archive\.replaceAll\("\\\\", "\/"\)/);
});
