import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bridgeCliInvocation, defaultUserBin, prepareBridgeCliShims, renderShim } from "../src/cli-shims.ts";

test("prepares Windows bridge CLI shims that follow current without embedding secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-cli-"));
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const entrypoint = path.join(installRoot, "current", "core", "agent", "bin", "pa-cli.mjs");
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.writeFileSync(entrypoint, "// fixture\n");
  const config = { dataRoot: path.join(root, "data"), mailDir: path.join(root, "data", "mail"), envPath: path.join(root, "site.env"), ports: { bridge: 9876 } };
  const result = prepareBridgeCliShims(config, { platform: "win32", installRoot, binDir, env: { PATH: binDir } });
  const content = fs.readFileSync(path.join(binDir, "pa-cli.cmd"), "utf8");
  assert.equal(result.ready, true);
  assert.equal(result.followsCurrent, true);
  assert.equal(result.pathReady, true);
  assert.equal(result.mailIngest.ready, true);
  assert.equal(result.mailIngest.command, "pa-cli mail ingest");
  assert.match(content, /OPEN_AGENT_BRIDGE_ENV_FILE=/);
  assert.match(content, /\\current\\core\\agent\\bin\\pa-cli\.mjs/);
  for (const legacy of ["open-abg.cmd", "oab.cmd", "open-agent-bridge.cmd"]) assert.equal(fs.existsSync(path.join(binDir, legacy)), false);
  assert.doesNotMatch(content, /\r\nnode /);
  assert.doesNotMatch(content, /API_TOKEN|UPLOAD_TOKEN/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("recognizes a Windows current release stored as a text pointer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-cli-pointer-"));
  try {
    const installRoot = path.join(root, "core");
    const releaseRoot = path.join(installRoot, "releases", "test-release");
    const binDir = path.join(root, "bin");
    const entrypoint = path.join(releaseRoot, "core", "agent", "bin", "pa-cli.mjs");
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.writeFileSync(entrypoint, "// fixture\n");
    fs.mkdirSync(installRoot, { recursive: true });
    fs.writeFileSync(path.join(installRoot, "current"), `${releaseRoot}\n`);
    const config = { dataRoot: path.join(root, "workspace"), envPath: path.join(root, "site.env"), ports: { bridge: 8788 } };
    const result = prepareBridgeCliShims(config, {
      platform: "win32", installRoot, binDir, env: { PATH: binDir }, nodeRuntime: process.execPath,
    });
    assert.equal(result.ready, true);
    assert.equal(result.followsCurrent, true);
    assert.match(fs.readFileSync(path.join(binDir, "pa-cli.cmd"), "utf8"), /test-release/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invokes Windows command shims through cmd call without nested quote parsing", () => {
  const invocation = bridgeCliInvocation("C:\\User Name\\pa-cli.cmd", ["wechat", "status", "--json"], { platform: "win32", env: { ComSpec: "C:\\Windows\\cmd.exe" } });
  assert.deepEqual(invocation, {
    command: "C:\\Windows\\cmd.exe",
    args: ["/d", "/c", "call", "C:\\User Name\\pa-cli.cmd", "wechat", "status", "--json"],
  });
});

test("renders a quoted executable POSIX shim and selects the user-local bin", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-cli-posix-"));
  const homeDir = path.join(root, "example user");
  const bin = path.join(homeDir, ".local", "bin");
  assert.equal(defaultUserBin({ platform: "linux", homeDir, env: { PATH: `/usr/bin${path.delimiter}${bin}` } }), path.resolve(bin));
  const content = renderShim({ platform: "linux", nodeRuntime: "/release/current/runtime/node", entrypoint: "/release/current/oab.mjs", envPath: "/data/site env" });
  assert.match(content, /^#!\/bin\/sh/);
  assert.match(content, /OPEN_AGENT_BRIDGE_ENV_FILE='\/data\/site env'/);
  assert.match(content, /exec '\/release\/current\/runtime\/node'/);
  assert.match(content, /"\$@"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("removes obsolete CLI shims and replaces a dangling pa-cli shim", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-cli-dangling-"));
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const missingTarget = path.join(root, "removed-release", "pa-cli.mjs");
  const entrypoint = path.join(installRoot, "current", "core", "agent", "bin", "pa-cli.mjs");
  try {
    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(entrypoint, "// fixture\n");
    fs.symlinkSync(missingTarget, path.join(binDir, "pa-cli"));
    for (const name of ["open-abg", "oab", "open-agent-bridge"]) fs.writeFileSync(path.join(binDir, name), "legacy\n");
    const config = { dataRoot: path.join(root, "data"), mailDir: path.join(root, "data", "mail"), envPath: path.join(root, "site.env"), ports: { bridge: 8788 } };
    const result = prepareBridgeCliShims(config, { platform: process.platform, installRoot, binDir, env: { PATH: binDir } });
    assert.equal(result.ready, true);
    assert.equal(fs.lstatSync(path.join(binDir, "pa-cli")).isSymbolicLink(), false);
    for (const name of ["open-abg", "oab", "open-agent-bridge"]) assert.equal(fs.existsSync(path.join(binDir, name)), false);
    assert.equal(fs.existsSync(missingTarget), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("canonicalizes an aliased POSIX install root while keeping shims on current", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-cli-alias-"));
  const realRoot = path.join(root, "real");
  const aliasRoot = path.join(root, "alias");
  const installRoot = path.join(realRoot, "install");
  const aliasedInstallRoot = path.join(aliasRoot, "install");
  const releaseRoot = path.join(installRoot, "releases", "fixture-release");
  const binDir = path.join(root, "bin");
  const bridgeEntrypoint = path.join(releaseRoot, "core", "agent", "bin", "pa-cli.mjs");
  try {
    fs.mkdirSync(path.dirname(bridgeEntrypoint), { recursive: true });
    fs.writeFileSync(bridgeEntrypoint, "// bridge fixture\n");
    fs.symlinkSync(realRoot, aliasRoot, "dir");
    fs.symlinkSync(path.relative(installRoot, releaseRoot), path.join(installRoot, "current"), "dir");
    const config = {
      dataRoot: path.join(root, "data"),
      mailDir: path.join(root, "data", "mail"),
      envPath: path.join(root, "data", "site.env"),
      ports: { bridge: 8788 },
    };
    const result = prepareBridgeCliShims(config, {
      platform: "linux",
      installRoot: aliasedInstallRoot,
      binDir,
      env: { PATH: binDir },
    });
    const canonicalInstallRoot = fs.realpathSync(aliasedInstallRoot);
    const content = fs.readFileSync(path.join(binDir, "pa-cli"), "utf8");
    assert.equal(result.ready, true);
    assert.equal(result.followsCurrent, true);
    assert.equal(result.mailIngest.followsCurrent, true);
    assert.match(content, new RegExp(`${escapeRegExp(canonicalInstallRoot)}/current/core/agent/bin/pa-cli\\.mjs`));
    assert.doesNotMatch(content, /fixture-release\/core\/agent\/bin\/pa-cli/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
