const RUNTIME_ENV_PREFIX = /^(?:PERSONAL_AGENT|PRIVATE_SITE)_/;

export function releaseVerificationEnvironment(baseEnv = process.env, overrides = {}) {
  const isolated = {};
  for (const [name, value] of Object.entries(baseEnv || {})) {
    if (!RUNTIME_ENV_PREFIX.test(name) && value !== undefined) isolated[name] = value;
  }
  return { ...isolated, ...overrides };
}
