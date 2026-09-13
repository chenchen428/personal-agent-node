import assert from "node:assert/strict";
import test from "node:test";
import { buildSpaceNavigationUrl, waitForSpaceRuntime } from "../core/app/src/lib/space-navigation.ts";

const target = {
  id: "sp_example",
  state: "stopped",
  desiredState: "running",
  localUrl: "http://127.0.0.1:8863",
  managedHost: "work-owner.personal-agent.cn",
};

test("space navigation waits for an already requested runtime before navigating", async () => {
  const calls = [];
  const states = ["stopped", "degraded", "running"];
  const ready = await waitForSpaceRuntime(target, {
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method || "GET", headers: init?.headers });
      const state = states.shift();
      return jsonResponse({ spaces: [{ ...target, state }] });
    },
    sleep: async () => undefined,
    pollIntervalMs: 1,
    timeoutMs: 5,
  });

  assert.equal(ready.state, "running");
  assert.equal(calls.length, 3);
  assert.equal(calls.every((call) => call.method === "GET"), true);
  assert.equal(calls.every((call) => call.headers["x-personal-agent-surface"] === "desktop"), true);
});

test("space navigation starts a stopped runtime exactly once", async () => {
  const calls = [];
  const ready = await waitForSpaceRuntime({ ...target, desiredState: "stopped" }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method || "GET", body: init?.body, headers: init?.headers });
      if (init?.method === "POST") return jsonResponse({ ok: true });
      return jsonResponse({ spaces: [{ ...target, state: "running" }] });
    },
    sleep: async () => undefined,
  });

  assert.equal(ready.state, "running");
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
  assert.deepEqual(JSON.parse(calls[0].body), { action: "start", spaceId: target.id });
  assert.equal(calls.every((call) => call.headers["x-personal-agent-surface"] === "desktop"), true);
});

test("space navigation remains on the current page when startup times out", async () => {
  await assert.rejects(() => waitForSpaceRuntime(target, {
    fetchImpl: async () => jsonResponse({ spaces: [target] }),
    sleep: async () => undefined,
    pollIntervalMs: 10,
    timeoutMs: 20,
  }), /启动超时/);
});

test("space navigation keeps the module but removes private queries and hashes", () => {
  assert.equal(
    buildSpaceNavigationUrl(target, "http://127.0.0.1:8843/app/chat?from=desktop#latest"),
    "http://127.0.0.1:8863/app/conversations",
  );
  assert.equal(
    buildSpaceNavigationUrl(target, "https://owner.personal-agent.cn/app/connections"),
    "https://work-owner.personal-agent.cn/app/connections",
  );
});

test("space navigation never sends source-Space object identities to the target", () => {
  for (const [route, destination] of [
    ["/app/workers?task=private-worker", "/app/workers"],
    ["/app/workers/plans?id=private-plan", "/app/workers/calendar"],
    ["/app/pages/private-page?query=confidential#private-fragment", "/app/pages"],
    ["/app/chat/private-session", "/app/conversations"],
    ["/app/mobile/workers/private-worker", "/app/mobile/workers"],
    ["/app/mobile/workers/plans?id=private-plan", "/app/mobile/workers/calendar"],
  ]) assert.equal(buildSpaceNavigationUrl(target, `http://127.0.0.1:8843${route}`), `http://127.0.0.1:8863${destination}`);
});

test("a cancelled runtime wait cannot poll or complete with a late response", async () => {
  const controller = new AbortController();
  await assert.rejects(waitForSpaceRuntime(target, {
    signal: controller.signal,
    fetchImpl: async () => { controller.abort(); return jsonResponse({ spaces: [{ ...target, state: "running" }] }); },
  }), { name: "AbortError" });
  await assert.rejects(waitForSpaceRuntime({ ...target, state: "running" }, { signal: controller.signal }), { name: "AbortError" });
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
