import path from "node:path";

const RUNTIME_ENV_PREFIX = /^(?:PERSONAL_AGENT|PRIVATE_SITE|OPEN_AGENT_BRIDGE)_/i;

export function releaseVerificationEnvironment(baseEnv = process.env, overrides = {}) {
  const dataRoot = overrides.PERSONAL_AGENT_DATA_ROOT || overrides.PRIVATE_SITE_DATA_ROOT;
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error("Release verification requires an explicit absolute fixture data root");
  const runtimeRoot = path.join(dataRoot, ".release-verification");
  const isolated = {};
  for (const [name, value] of Object.entries(baseEnv || {})) {
    if (!RUNTIME_ENV_PREFIX.test(name) && value !== undefined) isolated[name] = value;
  }
  // prepare creates command shims. Removing the active configuration alone would
  // make it fall back to the real OS home/APPDATA and overwrite the user's CLI.
  return { ...isolated,
    PERSONAL_AGENT_HOME: path.join(runtimeRoot, "home"),
    PRIVATE_SITE_INSTALL_ROOT: path.join(runtimeRoot, "core"),
    PRIVATE_SITE_CLI_BIN: path.join(runtimeRoot, "bin"),
    ...overrides,
  };
}
