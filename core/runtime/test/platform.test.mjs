import assert from "node:assert/strict";
import test from "node:test";
import { renderLaunchdService, renderSystemdUserService } from "../src/platform-service.ts";
import { wireGuardLifecycle } from "../src/platform-wireguard.ts";
import { renderWindowsScheduledTask } from "../src/windows-service.ts";

const config = {
  domain: "example.site",
  dataRoot: "/Users/example/.personal-agent",
  logsDir: "/Users/example/.personal-agent/logs",
};

test("renders a macOS launchd Node service", () => {
  const output = renderLaunchdService(config, { cliPath: "/opt/private-site/bin/private-site.mjs", nodePath: "/usr/local/bin/node" });
  assert.match(output, /site\.personal-agent\.private-site-node/);
  assert.match(output, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(output, /<key>KeepAlive<\/key><true\/>/);
});

test("renders a Linux systemd user Node service", () => {
  const output = renderSystemdUserService(config, { cliPath: "/opt/private-site/bin/private-site.mjs", nodePath: "/usr/bin/node" });
  assert.match(output, /ExecStart="\/usr\/bin\/node" "\/opt\/private-site\/bin\/private-site\.mjs" start/);
  assert.match(output, /Restart=on-failure/);
  assert.match(output, /WantedBy=default\.target/);
});

test("renders a Windows interactive-user scheduled task", () => {
  const output = renderWindowsScheduledTask(config, {
    cliPath: "C:\\private-site\\private-site.mjs",
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    userId: "EXAMPLE\\owner",
  });
  assert.match(output, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(output, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(output, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(output, /<Hidden>true<\/Hidden>/);
  assert.match(output, /start --data-root &quot;\/Users\/example\/\.personal-agent&quot;/);
  assert.match(output, /EXAMPLE\\owner/);
});

test("describes WireGuard lifecycle for every supported Node platform", () => {
  assert.equal(wireGuardLifecycle("/tmp/private-site.conf", "win32").serviceId, "WireGuardTunnel$private-site");
  const macOS = wireGuardLifecycle("/tmp/private-site.conf", "darwin");
  assert.match(macOS.prerequisite, /brew install wireguard-tools/);
  assert.equal(macOS.executable, "/usr/bin/osascript");
  assert.match(macOS.args[1], /with administrator privileges/);
  assert.match(macOS.args[1], /wg-quick up/);
  assert.match(wireGuardLifecycle("/tmp/private-site.conf", "linux").installCommand, /wg-quick up/);
});
