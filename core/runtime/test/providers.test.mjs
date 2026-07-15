import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultProviders, providerCatalog, providerStatus, readProviders, setProvider } from "../src/providers.ts";

test("defaults to local tunnel and BYOK without Cloud access", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-providers-"));
  try {
    const config = { configDir: path.join(root, "config"), env: {} };
    assert.deepEqual(readProviders(config), defaultProviders());
    assert.equal(providerStatus(config).tunnel.provider, "local");
    assert.equal(providerStatus(config).token.provider, "byok");
    assert.equal(providerCatalog.tunnel["personal-agent-cloud"].managed, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stores only credential environment names for independent providers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-providers-set-"));
  try {
    const config = { configDir: path.join(root, "config"), env: { MODEL_GATEWAY_KEY: "configured-secret" } };
    setProvider(config, { kind: "tunnel", provider: "ngrok", credentialEnv: "NGROK_AUTHTOKEN" });
    setProvider(config, { kind: "token", provider: "openai-compatible", endpoint: "https://tokens.example.test/v1/", credentialEnv: "MODEL_GATEWAY_KEY" });
    const stored = fs.readFileSync(path.join(config.configDir, "providers.json"), "utf8");
    assert.doesNotMatch(stored, /configured-secret/);
    assert.equal(providerStatus(config).tunnel.provider, "ngrok");
    assert.equal(providerStatus(config).token.endpoint, "https://tokens.example.test/v1");
    assert.equal(providerStatus(config).token.credentialConfigured, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects credential values and incomplete compatible gateways", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-providers-invalid-"));
  const config = { configDir: path.join(root, "config"), env: {} };
  try {
    assert.throws(() => setProvider(config, { kind: "token", provider: "openai-compatible" }), /endpoint is required/i);
    assert.throws(() => setProvider(config, { kind: "token", provider: "byok", credentialEnv: "sk-not-an-env-name" }), /environment variable/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
