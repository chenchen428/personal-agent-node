import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bridgeCliInvocation, defaultUserBin, prepareBridgeCliShims, renderShim } from "../src/cli-shims.mjs";

test("prepares Windows bridge CLI shims that follow current without embedding secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-cli-"));
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const entrypoint = path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const mailEntrypoint = path.join(installRoot, "current", "projects", "core", "open-agent-bridge", "bin", "oab-mail-ingest.mjs");
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.writeFileSync(entrypoint, "// fixture\n");
  fs.writeFileSync(mailEntrypoint, "// mail fixture\n");
  const config = { dataRoot: path.join(root, "data"), mailDir: path.join(root, "data", "mail"), envPath: path.join(root, "site.env"), ports: { bridge: 9876 } };
  const result = prepareBridgeCliShims(config, { platform: "win32", installRoot, binDir, env: { PATH: binDir } });
  const content = fs.readFileSync(path.join(binDir, "open-abg.cmd"), "utf8");
  const mailContent = fs.readFileSync(path.join(binDir, "open-abg-mail-ingest.cmd"), "utf8");
  assert.equal(result.ready, true);
  assert.equal(result.followsCurrent, true);
  assert.equal(result.pathReady, true);
  assert.equal(result.mailIngest.ready, true);
  assert.equal(result.mailIngest.followsCurrent, true);
  assert.match(content, /OPEN_AGENT_BRIDGE_ENV_FILE=/);
  assert.match(content, /\\current\\projects\\core\\open-agent-bridge\\bin\\oab\.mjs/);
  assert.doesNotMatch(content, /\r\nnode /);
  assert.match(mailContent, /OPEN_AGENT_BRIDGE_MAIL_DATA_DIR=.*\\data\\mail/);
  assert.match(mailContent, /set "OPEN_AGENT_BRIDGE_API_BASE=http:\/\/127\.0\.0\.1:9876"/);
  assert.match(mailContent, /\\current\\projects\\core\\open-agent-bridge\\bin\\oab-mail-ingest\.mjs/);
  assert.doesNotMatch(content, /API_TOKEN|UPLOAD_TOKEN/);
  assert.doesNotMatch(mailContent, /MAIL_INGEST_TOKEN|API_TOKEN|UPLOAD_TOKEN/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("invokes Windows command shims through cmd call without nested quote parsing", () => {
  const invocation = bridgeCliInvocation("C:\\User Name\\open-abg.cmd", ["wechat", "status", "--json"], { platform: "win32", env: { ComSpec: "C:\\Windows\\cmd.exe" } });
  assert.deepEqual(invocation, {
    command: "C:\\Windows\\cmd.exe",
    args: ["/d", "/c", "call", "C:\\User Name\\open-abg.cmd", "wechat", "status", "--json"],
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

test("renders a stable POSIX mail shim with paths but without credentials", () => {
  const content = renderShim({
    platform: "linux",
    nodeRuntime: "/home/example/.private-site-node/current/runtime/node",
    entrypoint: "/home/example/.private-site-node/current/projects/core/open-agent-bridge/bin/oab-mail-ingest.mjs",
    envPath: "/home/example/.personal-agent/secrets/applications/site.env",
    environment: {
      PRIVATE_SITE_DATA_ROOT: "/home/example/.personal-agent",
      OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: "/home/example/.personal-agent/mail",
      OPEN_AGENT_BRIDGE_API_BASE: "http://127.0.0.1:8788",
    },
  });
  assert.match(content, /PRIVATE_SITE_DATA_ROOT='\/home\/example\/\.personal-agent'/);
  assert.match(content, /OPEN_AGENT_BRIDGE_MAIL_DATA_DIR='\/home\/example\/\.personal-agent\/mail'/);
  assert.match(content, /\/current\/projects\/core\/open-agent-bridge\/bin\/oab-mail-ingest\.mjs/);
  assert.match(content, /\/current\/runtime\/node/);
  assert.doesNotMatch(content, /MAIL_INGEST_TOKEN|API_TOKEN|UPLOAD_TOKEN/);
});

test("canonicalizes an aliased POSIX install root while keeping shims on current", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "private-site-cli-alias-"));
  const realRoot = path.join(root, "real");
  const aliasRoot = path.join(root, "alias");
  const installRoot = path.join(realRoot, "install");
  const aliasedInstallRoot = path.join(aliasRoot, "install");
  const releaseRoot = path.join(installRoot, "releases", "fixture-release");
  const binDir = path.join(root, "bin");
  const bridgeEntrypoint = path.join(releaseRoot, "projects", "core", "open-agent-bridge", "bin", "oab.mjs");
  const mailEntrypoint = path.join(releaseRoot, "projects", "core", "open-agent-bridge", "bin", "oab-mail-ingest.mjs");
  try {
    fs.mkdirSync(path.dirname(bridgeEntrypoint), { recursive: true });
    fs.writeFileSync(bridgeEntrypoint, "// bridge fixture\n");
    fs.writeFileSync(mailEntrypoint, "// mail fixture\n");
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
    const content = fs.readFileSync(path.join(binDir, "open-abg-mail-ingest"), "utf8");
    assert.equal(result.ready, true);
    assert.equal(result.followsCurrent, true);
    assert.equal(result.mailIngest.followsCurrent, true);
    assert.match(content, new RegExp(`${escapeRegExp(canonicalInstallRoot)}/current/projects/core/open-agent-bridge/bin/oab-mail-ingest\\.mjs`));
    assert.doesNotMatch(content, /fixture-release\/projects\/core\/open-agent-bridge\/bin\/oab-mail-ingest/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
