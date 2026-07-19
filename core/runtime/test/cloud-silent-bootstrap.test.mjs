import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensureCloudDeviceIdentity } from "../src/cloud-device-identity.ts";
import { createLoopbackCallback, silentBootstrapManagedCloudCredential } from "../src/cloud-silent-bootstrap.ts";
import { initializeSite, resolveNodeConfig, writeJsonAtomic } from "../src/config.ts";
import { initializeInstallation } from "../src/space-registry.ts";

test("silent bootstrap uses the browser session without exposing or reading it and is single-flight", async (t) => {
  const { root, config, now } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let opened = 0;
  let starts = 0;
  let exchanges = 0;
  let startBody;
  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    const body = JSON.parse(options.body);
    if (pathname === "/api/node/silent/start") {
      starts += 1;
      startBody = body;
      return json(201, { authorizationUrl: "http://127.0.0.1:8080/api/node/silent/authorize?transaction=silentauth_abcdefghijklmnop&prompt=none", expiresIn: 120 });
    }
    exchanges += 1;
    assert.equal(body.nonce, startBody.nonce);
    return json(200, credentialPayload({ config, nonce: body.nonce, now }));
  };
  const callbackFactory = async ({ state }) => ({
    redirectUri: "http://127.0.0.1:49152/callback/abcdefghijklmnopqrstuvwxyz012345",
    wait: Promise.resolve({ code: "one-time-authorization-code-123456", error: "", state }),
    close() {},
  });
  const options = { config, fetchImpl, callbackFactory, openBrowser: async () => { opened += 1; return true; }, now };
  const [first, second] = await Promise.all([silentBootstrapManagedCloudCredential(options), silentBootstrapManagedCloudCredential(options)]);
  assert.deepEqual(first, second);
  assert.equal(starts, 1);
  assert.equal(exchanges, 1);
  assert.equal(opened, 1);
  assert.match(fs.readFileSync(config.envPath, "utf8"), /PERSONAL_AGENT_CLOUD_REFRESH_TOKEN/);
  const metadata = JSON.parse(fs.readFileSync(path.join(config.configDir, "cloud.json"), "utf8"));
  assert.equal(metadata.credentialRecoveryMethod, "silent-browser-session");
  assert.equal(metadata.schemaVersion, 4);
});

test("silent bootstrap fails closed for expired browser sessions, unavailable browser, and nonce mismatch", async (t) => {
  const cases = [
    { name: "expired session", browser: true, callback: { error: "login_required" }, code: "CLOUD_SILENT_LOGIN_REQUIRED" },
    { name: "browser unavailable", browser: false, callback: { code: "unused" }, code: "CLOUD_BROWSER_UNAVAILABLE" },
    { name: "nonce mismatch", browser: true, callback: { code: "one-time-authorization-code-123456" }, wrongNonce: true, code: "CLOUD_SILENT_NONCE_MISMATCH" },
    { name: "authorization timeout", browser: true, callbackError: Object.assign(new Error("timeout"), { code: "CLOUD_SILENT_TIMEOUT" }), code: "CLOUD_SILENT_TIMEOUT" },
  ];
  for (const item of cases) {
    const { root, config, now } = fixture();
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    let startBody;
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body);
      if (new URL(url).pathname.endsWith("/start")) {
        startBody = body;
        return json(201, { authorizationUrl: "http://127.0.0.1:8080/api/node/silent/authorize?transaction=silentauth_abcdefghijklmnop&prompt=none" });
      }
      return json(200, credentialPayload({ config, nonce: item.wrongNonce ? "wrong-nonce-value-that-is-long-enough" : body.nonce, now }));
    };
    await assert.rejects(
      silentBootstrapManagedCloudCredential({
        config, fetchImpl, now, openBrowser: async () => item.browser,
        callbackFactory: async () => ({ redirectUri: "http://127.0.0.1:49152/callback/abcdefghijklmnopqrstuvwxyz012345", wait: item.callbackError ? new Promise((_resolve, reject) => setTimeout(() => reject(item.callbackError), 0)) : Promise.resolve(item.callback), close() {} }),
      }),
      (error) => error.code === item.code,
      item.name,
    );
    assert.ok(startBody || item.browser === false);
  }
});

test("loopback callback accepts only its random path, exact host, and matching state", async () => {
  const state = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const callback = await createLoopbackCallback({ state, timeoutMs: 5000 });
  const wrong = new URL(callback.redirectUri);
  wrong.pathname = "/callback/attackerattackerattackerattacker";
  assert.equal((await get(wrong)).statusCode, 404);
  const target = new URL(callback.redirectUri);
  target.searchParams.set("state", "wrong-state-value-that-is-long-enough");
  target.searchParams.set("code", "one-time-code-value-long-enough");
  const rejected = assert.rejects(callback.wait, (error) => error.code === "CLOUD_SILENT_STATE_MISMATCH");
  assert.equal((await get(target)).statusCode, 400);
  await rejected;
  callback.close();
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-silent-bootstrap-"));
  const initialized = initializeSite({ domain: "personal-agent.local", dataRoot: root });
  const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: root });
  ensureCloudDeviceIdentity({ dataRoot: config.dataRoot });
  initializeInstallation({ dataRoot: config.installationDataRoot });
  writeJsonAtomic(path.join(config.configDir, "cloud.json"), {
    schemaVersion: 3,
    cloudUrl: "http://127.0.0.1:8080",
    siteId: "site_abcdefghijklmnop",
    managedHost: "silent.personal-agent.cn",
    credential: {
      tokenType: "Bearer",
      accessExpiresAt: "2026-07-19T10:01:00.000Z",
      refreshExpiresAt: "2026-08-19T10:00:00.000Z",
      refreshEndpoint: "http://127.0.0.1:8080/api/node/token/refresh",
      deviceBinding: { installationId: initializeInstallation({ dataRoot: config.installationDataRoot }).installation.installationId, spaceId: config.space.id },
    },
    tunnel: { protocol: "pa-reverse-ws-v1", endpoint: "ws://127.0.0.1:9090/v1/connect", heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 1 },
  }, 0o600);
  return { root, config, now: () => new Date("2026-07-19T10:00:00.000Z"), initialized };
}

function credentialPayload({ config, nonce, now }) {
  const installationId = initializeInstallation({ dataRoot: config.installationDataRoot }).installation.installationId;
  return {
    nonce,
    nodeToken: "new-access-token-value-1234567890",
    refreshToken: "new-refresh-token-value-1234567890",
    credential: {
      tokenType: "Bearer",
      accessExpiresAt: new Date(now().getTime() + 15 * 60_000).toISOString(),
      refreshExpiresAt: new Date(now().getTime() + 30 * 24 * 60 * 60_000).toISOString(),
      refreshEndpoint: "http://127.0.0.1:8080/api/node/token/refresh",
      deviceBinding: { installationId, spaceId: config.space.id },
    },
    tunnel: { protocol: "pa-reverse-ws-v1", endpoint: "ws://127.0.0.1:9090/v1/connect", heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 2 },
  };
}

function json(status, value) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function get(url) { return new Promise((resolve, reject) => { const request = http.get(url, (response) => { response.resume(); resolve(response); }); request.once("error", reject); }); }
