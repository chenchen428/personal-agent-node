import assert from "node:assert/strict";
import test from "node:test";
import { startConnectionPolling } from "../core/app/src/components/connection-polling.ts";
import { createLatestRequest } from "../core/app/src/lib/latest-request.ts";
import { syncWechatConnectionAfterLogin } from "../core/app/src/components/wechat-login-sync.ts";
import { createLatestJsonRequest } from "../core/app/src/lib/latest-json-request.ts";
import { fetchJson } from "../core/app/src/lib/client-json.ts";

function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }
function clock(t) { t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 }); }

test("confirmation stops QR probes and its expiry timer even when catalog synchronization fails", async (t) => {
  clock(t);
  const events = [];
  let probes = 0;
  const pending = deferred();
  startConnectionPolling({
    deadline: Date.now() + 120_000,
    probe: async () => { probes += 1; return pending.promise; },
    onResult: (result) => { events.push(result.state); void syncWechatConnectionAfterLogin(async () => { throw new Error("catalog offline"); }); },
    onError: () => events.push("error"), onTimeout: () => events.push("expired"),
  });
  t.mock.timers.tick(1_200);
  pending.resolve({ state: "completed" });
  await flush();
  t.mock.timers.tick(240_000);
  await flush();
  assert.deepEqual(events, ["completed"]);
  assert.equal(probes, 1);
});

test("cancel or replacement invalidates an in-flight response even if the transport ignores abort", async (t) => {
  clock(t);
  const old = deferred();
  const events = [];
  let signal;
  const stop = startConnectionPolling({ deadline: Date.now() + 120_000,
    probe: async (value) => { signal = value; return old.promise; },
    onResult: (result) => events.push(result.state), onError: () => events.push("error"), onTimeout: () => events.push("expired") });
  t.mock.timers.tick(1_200);
  stop();
  assert.equal(signal.aborted, true);
  startConnectionPolling({ deadline: Date.now() + 120_000,
    probe: async () => ({ state: "completed" }), onResult: () => events.push("new-completed"),
    onError: () => events.push("new-error"), onTimeout: () => events.push("new-expired") });
  t.mock.timers.tick(1_200); await flush();
  old.resolve({ state: "failed", message: "old authorization expired" }); await flush();
  t.mock.timers.tick(240_000); await flush();
  assert.deepEqual(events, ["new-completed"]);
});

test("transient probe errors retry without overlapping requests and confirmed failure remains terminal", async (t) => {
  clock(t);
  const pending = deferred();
  const events = [];
  let probes = 0;
  startConnectionPolling({ deadline: Date.now() + 120_000,
    probe: async () => { probes += 1; if (probes === 1) throw new Error("503"); return pending.promise; },
    onResult: (result) => events.push(result.state), onError: () => events.push("retry"), onTimeout: () => events.push("expired") });
  t.mock.timers.tick(1_200); await flush();
  t.mock.timers.tick(1_800); await flush();
  t.mock.timers.tick(10_000); await flush();
  assert.equal(probes, 2);
  pending.resolve({ state: "failed", message: "Authorization revoked" }); await flush();
  t.mock.timers.tick(240_000); await flush();
  assert.deepEqual(events, ["retry", "failed"]);
});

test("a hanging request reaches the authorization deadline exactly once and cannot succeed later", async (t) => {
  clock(t);
  const hanging = deferred();
  const events = [];
  let signal;
  startConnectionPolling({ deadline: Date.now() + 5_000,
    probe: async (value) => { signal = value; return hanging.promise; },
    onResult: (result) => events.push(result.state), onError: () => events.push("error"), onTimeout: () => events.push("expired") });
  t.mock.timers.tick(1_200); await flush();
  t.mock.timers.tick(3_800); await flush();
  assert.equal(signal.aborted, true);
  hanging.resolve({ state: "completed" }); await flush();
  t.mock.timers.tick(240_000); await flush();
  assert.deepEqual(events, ["expired"]);
});

test("pending authorizations still expire after retries", async (t) => {
  clock(t);
  const events = [];
  startConnectionPolling({ deadline: Date.now() + 5_000,
    probe: async () => ({ state: "pending" }), onResult: (result) => events.push(result.state),
    onError: () => events.push("error"), onTimeout: () => events.push("expired") });
  t.mock.timers.tick(1_200); await flush();
  t.mock.timers.tick(1_800); await flush();
  t.mock.timers.tick(2_000); await flush();
  assert.equal(events.at(-1), "expired");
  assert.equal(events.filter((event) => event === "expired").length, 1);
});

test("latest catalog responses win, including a genuine disconnect after earlier success", async () => {
  const requests = createLatestRequest();
  const old = deferred(); const current = deferred();
  let state = "pending";
  const load = async (result) => { const valid = requests.begin(); const value = await result; if (valid()) state = value; };
  const first = load(old.promise); const second = load(current.promise);
  current.resolve("connected"); await second;
  old.resolve("needs_setup"); await first;
  assert.equal(state, "connected");
  await load(Promise.resolve("disconnected"));
  assert.equal(state, "disconnected");
});

test("mutation or unmount invalidates pending reads without accepting stale failures", async () => {
  const requests = createLatestRequest();
  const old = deferred(); let state = "connected";
  const valid = requests.begin();
  const reading = old.promise.catch(() => { if (valid()) state = "error"; });
  requests.invalidate();
  old.reject(new Error("old request")); await reading;
  assert.equal(state, "connected");
});

test("catalog refresh after mutation bypasses pending GET deduplication and ignores obsolete transport responses", async (t) => {
  const responses = [deferred(), deferred(), deferred()];
  const signals = []; let calls = 0; let state; let settled = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => { signals.push(init.signal); return responses[calls++].promise; });
  const cached = fetchJson("/api/connections?fixture=mutation");
  const reader = createLatestJsonRequest();
  const callbacks = { value: (value) => { state = value.state; }, error: () => { state = "error"; }, settled: () => { settled += 1; } };
  const beforeMutation = reader.refresh("/api/connections?fixture=mutation", callbacks);
  const afterMutation = reader.refresh("/api/connections?fixture=mutation", callbacks);
  assert.equal(calls, 3);
  assert.equal(signals[1].aborted, true);
  responses[2].resolve(Response.json({ state: "connected" })); await afterMutation;
  responses[0].resolve(Response.json({ state: "needs_setup" })); await cached;
  responses[1].resolve(Response.json({ state: "needs_setup" })); await beforeMutation;
  assert.equal(state, "connected");
  assert.equal(settled, 1);
  reader.cancel();
});
