import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ClientResourceCache, clientResourceCache, bindClientCache, cacheStatusForRoute, clearClientCache, visitPage } from "../core/app/src/lib/client-resource-cache.ts";
import { fetchJson } from "../core/app/src/lib/client-json.ts";

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function browser(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const window = Object.assign(new EventTarget(), { location: { origin: "http://127.0.0.1:8843", pathname: "/app/pages" } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  bindClientCache("host-a:space-a");
  t.after(() => { clearClientCache(); if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); });
  return window;
}

test("resource memory obeys entry and byte limits and evicts least recently read values", () => {
  const cache = new ClientResourceCache(2, 100);
  cache.bind("space-a"); cache.set("a", "first"); cache.set("b", "second"); cache.get("a"); cache.set("c", "third");
  assert.equal(cache.get("b"), undefined); assert.equal(cache.get("a").value, "first");
  assert.equal(cache.set("huge", "x".repeat(100)), false); assert.equal(cache.size, 2);
  assert.ok(cache.byteSize <= 100);
  cache.set("big", "x".repeat(40)); assert.ok(cache.byteSize <= 100);
});

test("binding another Space aborts prior reads and rejects their late cache writes", () => {
  const cache = new ClientResourceCache(); cache.bind("host-a:space-a");
  const generation = cache.generation; const controller = new AbortController(); cache.track(controller);
  cache.set("/api/private", { secret: "only-a" });
  const latest = cache.beginRead("/api/private");
  cache.bind("host-a:space-b");
  assert.equal(controller.signal.aborted, true); assert.equal(cache.size, 0); assert.equal(latest(), false);
  assert.equal(cache.set("/api/private", { secret: "late-a" }, generation), false);
  assert.equal(cache.get("/api/private"), undefined);
});

test("menu revisit preserves the instance key while bounded history evicts only the oldest page", () => {
  let keys = [];
  for (const key of ["mail", "data", "pages", "calendar"]) keys = visitPage(keys, key, 3);
  assert.deepEqual(keys, ["data", "pages", "calendar"]);
  keys = visitPage(keys, "data", 3);
  assert.deepEqual(keys, ["pages", "calendar", "data"]);
  assert.equal(new Set(keys).size, 3);
});

test("background refresh keeps last good data and clears stale state after recovery", async (t) => {
  browser(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ value: "latest" }));
  await fetchJson("/api/private");
  assert.equal(clientResourceCache.get("/api/private").value.value, "latest");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await assert.rejects(fetchJson("/api/private"), /offline/);
  assert.equal(clientResourceCache.get("/api/private").value.value, "latest");
  assert.equal(cacheStatusForRoute("/app/pages").stale, true);
  t.mock.method(globalThis, "fetch", async () => Response.json({ value: "recovered" }));
  await fetchJson("/api/private");
  assert.equal(clientResourceCache.get("/api/private").value.value, "recovered");
  assert.equal(cacheStatusForRoute("/app/pages").stale, false);
});

test("old concurrent responses cannot replace newer values in the cache", async (t) => {
  browser(t); const old = deferred(), current = deferred(); let calls = 0;
  t.mock.method(globalThis, "fetch", () => (++calls === 1 ? old.promise : current.promise));
  const first = fetchJson("/api/race", { signal: new AbortController().signal });
  const second = fetchJson("/api/race", { signal: new AbortController().signal });
  current.resolve(Response.json({ value: "new" })); await second;
  old.resolve(Response.json({ value: "old" })); await first;
  assert.equal(clientResourceCache.get("/api/race").value.value, "new");
});

test("Space change cancels a request even when its transport ignores AbortSignal", async (t) => {
  browser(t); const pending = deferred(); let signal;
  t.mock.method(globalThis, "fetch", (_url, init) => { signal = init.signal; return pending.promise; });
  const request = fetchJson("/api/race-space");
  const rejected = assert.rejects(request, { name: "AbortError" });
  bindClientCache("host-b:space-b"); assert.equal(signal.aborted, true);
  pending.resolve(Response.json({ value: "old-space" })); await rejected;
  assert.equal(clientResourceCache.get("/api/race-space"), undefined);
});

test("authorization expiry clears all private data instead of falling back to stale data", async (t) => {
  browser(t); clientResourceCache.set("/api/secret", { value: "private" });
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "login required" }, { status: 401 }));
  await assert.rejects(fetchJson("/api/expired"), /login required/);
  assert.equal(clientResourceCache.size, 0);
});

test("non-JSON authentication responses still discard all private snapshots", async (t) => {
  browser(t);
  for (const status of [401, 403]) {
    clientResourceCache.set("/api/private", { value: "must disappear" });
    t.mock.method(globalThis, "fetch", async () => new Response("<html>Sign in</html>", { status, headers: { "content-type": "text/html" } }));
    await assert.rejects(fetchJson("/api/expired-html"));
    assert.equal(clientResourceCache.size, 0);
  }
});

test("page recovery evicts only that page's resources and keeps other last-good data", () => {
  const cache = new ClientResourceCache(); cache.bind("space-a");
  cache.set("/api/mail", { value: "mail" }, cache.generation, "/app/mail");
  cache.set("/api/pages", { value: "pages" }, cache.generation, "/app/pages");
  cache.forgetRoute("/app/mail");
  assert.equal(cache.get("/api/mail"), undefined); assert.equal(cache.get("/api/pages").value.value, "pages");
});

test("desktop cache uses public Activity and native history with per-page error recovery", () => {
  const root = path.resolve(import.meta.dirname, "../core/app/src");
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const cache = read("components/desktop-cache/desktop-page-cache.tsx");
  const resources = read("lib/client-resource-cache.ts");
  const session = read("components/desktop-cache/client-session-boundary.tsx");
  assert.match(cache, /<Activity key=\{key\} mode=/);
  assert.match(cache, /window\.history\.pushState/);
  assert.match(cache, /<PageRecoveryBoundary key=\{revision\}/);
  assert.match(cache, /clientResourceCache\.forgetRoute\(path\)/);
  assert.doesNotMatch(cache, /LayoutRouterContext|next\/dist|childrenByPath|cloneElement/);
  assert.doesNotMatch(resources, /localStorage|sessionStorage|indexedDB/);
  assert.match(session, /clientScopeKey\(payload, window\.location\.origin\)/);
  assert.match(session, /pagehide/); assert.match(session, /event\.persisted/);
  assert.match(read("app/app/error.tsx"), /RecoveryPanel onRetry=\{reset\}/);
  assert.match(read("app/global-error.tsx"), /<html lang="zh-CN">/);
});
