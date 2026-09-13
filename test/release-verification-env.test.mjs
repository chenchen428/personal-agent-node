import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareBridgeCliShims } from "../core/runtime/src/cli-shims.ts";

import { releaseVerificationEnvironment } from "../scripts/lib/release-verification-env.mjs";

test("release verification isolates fresh-install fixtures from the active Personal Agent runtime", () => {
  const fixtureWorkspace = path.resolve(os.tmpdir(), "release-verification-env-fixture");
  const isolated = releaseVerificationEnvironment({
    PATH: "runtime-path",
    NODE_ENV: "production",
    PERSONAL_AGENT_HOME: "active-home",
    PERSONAL_AGENT_DATA_ROOT: "active-workspace",
    PERSONAL_AGENT_SPACE_ID: "sp_active",
    PERSONAL_AGENT_SPACE_ROOT: "active-space",
    PERSONAL_AGENT_CONTROL_PORT: "8792",
    PRIVATE_SITE_INSTALL_ROOT: "active-core",
    PRIVATE_SITE_DATA_ROOT: "active-space",
    PRIVATE_SITE_RELEASE_ROOT: "active-release",
    OPEN_AGENT_BRIDGE_ENV_FILE: "active-environment",
    OPEN_AGENT_BRIDGE_API_TOKEN: "active-token",
  }, {
    PERSONAL_AGENT_HOME: "fixture-home",
    PERSONAL_AGENT_DATA_ROOT: fixtureWorkspace,
    PRIVATE_SITE_INSTALL_ROOT: "fixture-core",
    PRIVATE_SITE_DATA_ROOT: fixtureWorkspace,
  });

  assert.deepEqual(isolated, {
    PATH: "runtime-path",
    NODE_ENV: "production",
    PERSONAL_AGENT_HOME: "fixture-home",
    PERSONAL_AGENT_DATA_ROOT: fixtureWorkspace,
    PRIVATE_SITE_INSTALL_ROOT: "fixture-core",
    PRIVATE_SITE_DATA_ROOT: fixtureWorkspace,
    PRIVATE_SITE_CLI_BIN: path.join(fixtureWorkspace, ".release-verification", "bin"),
  });
  assert.equal("PERSONAL_AGENT_SPACE_ID" in isolated, false);
  assert.equal("PERSONAL_AGENT_SPACE_ROOT" in isolated, false);
  assert.equal("PERSONAL_AGENT_CONTROL_PORT" in isolated, false);
  assert.equal("PRIVATE_SITE_RELEASE_ROOT" in isolated, false);
  assert.equal("OPEN_AGENT_BRIDGE_ENV_FILE" in isolated, false);
  assert.equal("OPEN_AGENT_BRIDGE_API_TOKEN" in isolated, false);
});

test("application verification shim preparation cannot overwrite the active user's command directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-shim-isolation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appData = path.join(root, "active-profile", "AppData", "Roaming");
  const activeBin = path.join(appData, "npm");
  fs.mkdirSync(activeBin, { recursive: true });
  for (const name of ["pa-cli.cmd", "open-abg.cmd"]) fs.writeFileSync(path.join(activeBin, name), "active shim must survive");
  const dataRoot = path.join(root, "fixture", "workspace");
  const env = releaseVerificationEnvironment({ APPDATA: appData, PRIVATE_SITE_CLI_BIN: activeBin,
    PERSONAL_AGENT_HOME: path.join(root, "active-home"), PRIVATE_SITE_INSTALL_ROOT: path.join(root, "active-core") }, {
    PERSONAL_AGENT_DATA_ROOT: dataRoot, PRIVATE_SITE_DATA_ROOT: dataRoot,
    OPEN_AGENT_BRIDGE_API_TOKEN: "isolated-probe-token",
  });
  const entrypoint = path.join(env.PRIVATE_SITE_INSTALL_ROOT, "current", "core", "agent", "bin", "pa-cli.mjs");
  fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
  fs.writeFileSync(entrypoint, "// isolated release\n");
  const result = prepareBridgeCliShims({ dataRoot, envPath: path.join(dataRoot, "site.env"), ports: { bridge: 19999 } }, { platform: "win32", env });
  assert.equal(result.followsCurrent, true);
  assert.equal(result.binDir, path.join(dataRoot, ".release-verification", "bin"));
  for (const name of ["pa-cli.cmd", "open-abg.cmd"]) assert.equal(fs.readFileSync(path.join(activeBin, name), "utf8"), "active shim must survive");
  assert.equal(env.OPEN_AGENT_BRIDGE_API_TOKEN, "isolated-probe-token");
  assert.doesNotMatch(fs.readFileSync(result.commandPath, "utf8"), /active-profile|active-home|active-core|isolated-probe-token/);
});

test("verification cannot silently fall back to active runtime defaults without a fixture", () => {
  assert.throws(() => releaseVerificationEnvironment({ PERSONAL_AGENT_DATA_ROOT: "active" }), /explicit absolute fixture/);
  assert.throws(() => releaseVerificationEnvironment({}, { PRIVATE_SITE_DATA_ROOT: "relative-fixture" }), /explicit absolute fixture/);
});
