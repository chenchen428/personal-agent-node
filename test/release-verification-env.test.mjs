import assert from "node:assert/strict";
import test from "node:test";

import { releaseVerificationEnvironment } from "../scripts/lib/release-verification-env.mjs";

test("release verification isolates fresh-install fixtures from the active Personal Agent runtime", () => {
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
  }, {
    PERSONAL_AGENT_HOME: "fixture-home",
    PERSONAL_AGENT_DATA_ROOT: "fixture-workspace",
    PRIVATE_SITE_INSTALL_ROOT: "fixture-core",
    PRIVATE_SITE_DATA_ROOT: "fixture-workspace",
  });

  assert.deepEqual(isolated, {
    PATH: "runtime-path",
    NODE_ENV: "production",
    PERSONAL_AGENT_HOME: "fixture-home",
    PERSONAL_AGENT_DATA_ROOT: "fixture-workspace",
    PRIVATE_SITE_INSTALL_ROOT: "fixture-core",
    PRIVATE_SITE_DATA_ROOT: "fixture-workspace",
  });
  assert.equal("PERSONAL_AGENT_SPACE_ID" in isolated, false);
  assert.equal("PERSONAL_AGENT_SPACE_ROOT" in isolated, false);
  assert.equal("PERSONAL_AGENT_CONTROL_PORT" in isolated, false);
  assert.equal("PRIVATE_SITE_RELEASE_ROOT" in isolated, false);
});
