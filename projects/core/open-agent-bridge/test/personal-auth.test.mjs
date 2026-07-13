import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { PersonalAuth, PERSONAL_AUTH_DEFAULT_TTL_SECONDS } from "../src/auth/personal-auth.js";

const TEST_PASSWORD = "personal-auth-test-password";

test("requires explicit password and cookie secret configuration", () => {
  assert.throws(
    () => new PersonalAuth({ cookieSecret: "test-secret-with-enough-entropy" }),
    /PERSONAL_AGENT_AUTH_PASSWORD is required/,
  );
  assert.throws(
    () => new PersonalAuth({ password: TEST_PASSWORD }),
    /PERSONAL_AGENT_AUTH_COOKIE_SECRET is required/,
  );
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
