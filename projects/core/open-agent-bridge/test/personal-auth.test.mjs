import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PersonalAuth, PERSONAL_AUTH_DEFAULT_TTL_SECONDS, verifyPasswordVerifier, writePasswordVerifier } from "../src/auth/personal-auth.js";

const TEST_PASSWORD = "personal-auth-test-password";

test("requires explicit password and cookie secret configuration", () => {
  assert.throws(
    () => new PersonalAuth({ cookieSecret: "test-secret-with-enough-entropy" }),
    /PERSONAL_AGENT_AUTH_PASSWORD or a local auth verifier is required/,
  );
  assert.throws(
    () => new PersonalAuth({ password: TEST_PASSWORD }),
    /PERSONAL_AGENT_AUTH_COOKIE_SECRET is required/,
  );
});

test("stores a salted scrypt verifier and prefers it over the migration password", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-auth-verifier-"));
  const verifierFile = path.join(root, "config", "local-auth.json");
  const durablePassword = "durable-local-password-2026";
  try {
    const document = writePasswordVerifier(verifierFile, durablePassword);
    assert.equal(document.algorithm, "scrypt");
    assert.equal(document.verifier.includes(durablePassword), false);
    assert.equal(verifyPasswordVerifier(durablePassword, document), true);
    assert.equal(verifyPasswordVerifier("wrong-password", document), false);
    if (process.platform !== "win32") assert.equal(fs.statSync(verifierFile).mode & 0o777, 0o600);
    const fixture = await startFixture({ verifierFile });
    try {
      const migratedPassword = await login(fixture.baseUrl, TEST_PASSWORD);
      assert.equal(migratedPassword.status, 401);
      const durable = await login(fixture.baseUrl, durablePassword);
      assert.equal(durable.status, 303);
    } finally { await fixture.close(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("renders a password-only responsive login page", async () => {
  const fixture = await startFixture();
  try {
    const response = await fetch(`${fixture.baseUrl}/login?return_to=%2Fagent-corn`, { headers: { host: "agent.personal-agent.local" } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /name="password"/);
    assert.match(html, /name="viewport"/);
    assert.match(html, /value="\/agent-corn"/);
    assert.doesNotMatch(html, /name="username"/);
    assert.doesNotMatch(html, new RegExp(TEST_PASSWORD));
  } finally {
    await fixture.close();
  }
});

test("issues a one-year host-only cookie and rejects cross-tenant reuse", async () => {
  const fixture = await startFixture();
  try {
    const response = await fetch(`${fixture.baseUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-host": "agent.personal-agent.local",
        "x-forwarded-proto": "https",
      },
      body: new URLSearchParams({ password: TEST_PASSWORD, return_to: "/agent-bridge" }),
    });
    const cookie = response.headers.get("set-cookie") || "";
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/agent-bridge");
    assert.match(cookie, new RegExp(`Max-Age=${PERSONAL_AUTH_DEFAULT_TTL_SECONDS}`));
    assert.match(cookie, /^__Host-personal_agent=/);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);

    const tokenCookie = cookie.split(";", 1)[0];
    const check = await fetch(`${fixture.baseUrl}/_auth/check`, {
      headers: { cookie: tokenCookie, "x-forwarded-host": "agent.personal-agent.local" },
    });
    assert.equal(check.status, 204);
    const crossTenant = await fetch(`${fixture.baseUrl}/_auth/check`, {
      headers: { cookie: tokenCookie, "x-forwarded-host": "other.personal-agent.local" },
    });
    assert.equal(crossTenant.status, 401);
  } finally {
    await fixture.close();
  }
});

test("consumes one short-lived loopback setup nonce without printing or persisting it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-auth-bootstrap-"));
  const bootstrap = path.join(root, "bootstrap.json");
  const token = crypto.randomBytes(32).toString("base64url");
  fs.writeFileSync(bootstrap, JSON.stringify({ schemaVersion: 1, sha256: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString() }), { mode: 0o600 });
  const fixture = await startFixture({ setupBootstrapFile: bootstrap });
  try {
    const first = await fetch(`${fixture.baseUrl}/setup/bootstrap?token=${token}`, {
      redirect: "manual",
      headers: { "x-real-ip": "127.0.0.1", "x-forwarded-host": "127.0.0.1", "x-forwarded-proto": "https" },
    });
    assert.equal(first.status, 303);
    assert.equal(first.headers.get("location"), "/app/setup");
    assert.match(first.headers.get("set-cookie") || "", /^__Host-personal_agent=/);
    assert.equal(fs.existsSync(bootstrap), false);
    assert.doesNotMatch(first.headers.get("set-cookie") || "", new RegExp(token));

    const replay = await fetch(`${fixture.baseUrl}/setup/bootstrap?token=${token}`, {
      redirect: "manual",
      headers: { "x-real-ip": "127.0.0.1", "x-forwarded-host": "127.0.0.1", "x-forwarded-proto": "https" },
    });
    assert.equal(replay.status, 401);
  } finally {
    await fixture.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects wrong passwords, expired cookies, and unsafe return locations", async () => {
  let currentTime = Date.UTC(2026, 6, 10);
  const fixture = await startFixture({ now: () => currentTime, ttlSeconds: 60 });
  try {
    const wrong = await fetch(`${fixture.baseUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-host": "agent.personal-agent.local" },
      body: new URLSearchParams({ password: "wrong", return_to: "https://example.com" }),
    });
    assert.equal(wrong.status, 401);
    assert.match(await wrong.text(), /密码不正确/);

    const login = await fetch(`${fixture.baseUrl}/login`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-host": "agent.personal-agent.local" },
      body: new URLSearchParams({ password: TEST_PASSWORD, return_to: "https://example.com" }),
    });
    assert.equal(login.headers.get("location"), "/");
    const tokenCookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];
    currentTime += 61_000;
    const expired = await fetch(`${fixture.baseUrl}/_auth/check`, {
      headers: { cookie: tokenCookie, "x-forwarded-host": "agent.personal-agent.local" },
    });
    assert.equal(expired.status, 401);
  } finally {
    await fixture.close();
  }
});

async function startFixture(overrides = {}) {
  const auth = new PersonalAuth({
    password: TEST_PASSWORD,
    cookieSecret: "test-secret-with-enough-entropy",
    ...overrides,
  });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (!await auth.handle(request, response, url)) {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function login(baseUrl, password) {
  return fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-host": "agent.personal-agent.local" },
    body: new URLSearchParams({ password, return_to: "/app" }),
  });
}
