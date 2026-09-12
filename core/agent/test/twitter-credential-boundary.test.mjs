import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createTwitterReadPage } from "../../../scripts/lib/twitter-browser-credentials.mjs";

function fixture({ cookie = "ct0=browser-only-csrf; auth_token=browser-only-auth", reflect = false } = {}) {
  const scripts = []; const requests = []; let cookieCalls = 0;
  const page = {
    getCookies: async () => { cookieCalls++; throw new Error("must never obtain browser cookies"); },
    goto: async () => {}, wait: async () => {},
    evaluate: async (script) => {
      scripts.push(script);
      const value = vm.runInNewContext(script, { document: { cookie }, location: { origin: "https://x.com", href: "https://x.com/home" }, URL,
        fetch: async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => reflect ? { token: init.headers["X-Csrf-Token"] } : { rows: [{ id: "123456", text: "safe result" }] } }; },
      });
      return typeof value === "function" ? await value() : value;
    },
  };
  return { ...createTwitterReadPage(page), scripts, requests, cookieCalls: () => cookieCalls };
}

function requestSource(marker, url = "/i/api/graphql/publicquery/SearchTimeline") {
  const headers = JSON.stringify({ Authorization: "public-sdk-fixture", "X-Csrf-Token": marker });
  return `async () => { const response = await fetch(${JSON.stringify(url)}, { method: 'POST', headers: ${headers}, body: '{"query":"ordinary search"}', credentials: 'include' }); return response.ok ? await response.json() : { error: response.status }; }`;
}

test("X adapters never call the underlying cookie API; CSRF resolves only in browser request headers", async () => {
  const context = fixture();
  const fakeCookies = await context.page.getCookies({ url: "https://x.com" });
  assert.deepEqual(fakeCookies.map((cookie) => cookie.name), ["ct0"]);
  assert.doesNotMatch(JSON.stringify(fakeCookies), /browser-only/);
  const result = await context.page.evaluate(requestSource(fakeCookies[0].value));
  assert.equal(context.cookieCalls(), 0);
  assert.equal(context.requests[0].init.headers["X-Csrf-Token"], "browser-only-csrf");
  assert.equal(context.requests[0].url, "https://x.com/i/api/graphql/publicquery/SearchTimeline");
  assert.doesNotMatch(JSON.stringify(result), /browser-only|PA_CSRF_PLACEHOLDER/);
  assert.doesNotMatch(context.scripts.join("\n"), /browser-only-csrf|browser-only-auth|PA_CSRF_PLACEHOLDER/);
});

test("missing browser-local CSRF reports the platform login blocker without requesting content", async () => {
  const context = fixture({ cookie: "auth_token=browser-only-auth" });
  const [{ value }] = await context.page.getCookies({ url: "https://x.com" });
  await assert.rejects(context.page.evaluate(requestSource(value)), { code: "CONNECTION_LOGIN_REQUIRED" });
  assert.equal(context.requests.length, 0); assert.equal(context.cookieCalls(), 0);
});

test("X proxy fails closed on arbitrary evaluation, cookie targets, marker escape and external authenticated requests", async () => {
  const context = fixture();
  await assert.rejects(context.page.getCookies({ url: "https://other.example" }), { code: "CONNECTION_CREDENTIAL_BOUNDARY" });
  await assert.rejects(context.page.evaluate("document.cookie"), { code: "CONNECTION_CREDENTIAL_BOUNDARY" });
  const [{ value }] = await context.page.getCookies({ url: "https://x.com" });
  await assert.rejects(context.page.goto(`https://x.com/home?token=${value}`), { code: "CONNECTION_CREDENTIAL_BOUNDARY" });
  await assert.rejects(context.page.evaluate(`async () => { return {token:${JSON.stringify(value)}}; }`), { code: "CONNECTION_CREDENTIAL_BOUNDARY" });
  await assert.rejects(context.page.evaluate(requestSource(value, "https://other.example/i/api/graphql/publicquery/SearchTimeline")), { code: "CONNECTION_CREDENTIAL_BOUNDARY" });
  assert.equal(context.requests.length, 0); assert.equal(context.cookieCalls(), 0);
});

test("a reflected browser credential or Node placeholder can never become a read result", async () => {
  const context = fixture({ reflect: true });
  const [{ value }] = await context.page.getCookies({ url: "https://x.com" });
  await assert.rejects(context.page.evaluate(requestSource(value)), (error) => {
    assert.equal(error.code, "CONNECTION_CREDENTIAL_BOUNDARY"); assert.doesNotMatch(error.message, /browser-only|PA_CSRF/); return true;
  });
  assert.throws(() => context.assertSafeResult([{ text: value }]), { code: "CONNECTION_CREDENTIAL_BOUNDARY" });
});
