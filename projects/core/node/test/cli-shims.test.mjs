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
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.writeFileSync(entrypoint, "// fixture\n");
  const config = { envPath: path.join(root, "site.env") };
  const result = prepareBridgeCliShims(config, { platform: "win32", installRoot, binDir, env: { PATH: binDir } });
  const content = fs.readFileSync(path.join(binDir, "open-abg.cmd"), "utf8");
  assert.equal(result.ready, true);
  assert.equal(result.followsCurrent, true);
  assert.equal(result.pathReady, true);
  assert.match(content, /OPEN_AGENT_BRIDGE_ENV_FILE=/);
  assert.match(content, /\\current\\projects\\core\\open-agent-bridge\\bin\\oab\.mjs/);
  assert.doesNotMatch(content, /API_TOKEN|UPLOAD_TOKEN/);
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
  const content = renderShim({ platform: "linux", entrypoint: "/release/current/oab.mjs", envPath: "/data/site env" });
  assert.match(content, /^#!\/bin\/sh/);
  assert.match(content, /OPEN_AGENT_BRIDGE_ENV_FILE='\/data\/site env'/);
  assert.match(content, /"\$@"/);
  fs.rmSync(root, { recursive: true, force: true });
});
