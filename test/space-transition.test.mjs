import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSpaceTransition } from "../core/app/src/lib/space-transition.ts";
import { prepareDesktopStartup } from "../core/app/src/lib/desktop-startup-prefetch.ts";
import { SpaceTransition } from "../core/app/src/components/space-transition.tsx";
import { SafeClientStartup } from "../core/app/src/components/desktop-cache/safe-client-startup.tsx";

const target = { id: "space-b", displayName: "目标空间", state: "stopped", desiredState: "running", localUrl: "http://127.0.0.1:8863", managedHost: null };
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test("one switch owns navigation and cancelled late results cannot navigate", async () => {
  const pending = deferred(); const states = []; const locations = []; let waits = 0; let signal;
  const operation = createSpaceTransition({ onChange: (state) => states.push(state), navigate: (url) => locations.push(url), currentHref: () => "http://127.0.0.1:8843/app/pages/private?id=secret",
    wait: async (_target, options) => { waits += 1; signal = options.signal; return pending.promise; } });
  const first = operation.start(target);
  await operation.start(target);
  assert.equal(waits, 1); assert.equal(states.at(-1).phase, "connecting");
  operation.dismiss(); assert.equal(signal.aborted, true); assert.equal(states.at(-1), null);
  pending.resolve({ ...target, state: "running" }); await first;
  assert.deepEqual(locations, []); assert.equal(states.at(-1), null);
});

test("failed startup can be retried and bfcache restoration clears opening state", async () => {
  const states = []; const locations = []; let attempts = 0;
  const operation = createSpaceTransition({ onChange: (state) => states.push(state), navigate: (url) => locations.push(url), currentHref: () => "http://127.0.0.1:8843/app/workers?task=private",
    wait: async () => { if (++attempts === 1) throw new Error("fixture offline"); return { ...target, state: "running" }; } });
  await operation.start(target); assert.equal(states.at(-1).phase, "error"); assert.equal(states.at(-1).error, "fixture offline");
  await operation.start(target); assert.equal(states.at(-1).phase, "opening"); assert.deepEqual(locations, ["http://127.0.0.1:8863/app/workers"]);
  await operation.start(target); assert.equal(attempts, 2);
  operation.restore(); assert.equal(states.at(-1), null);
  await operation.start(target); assert.equal(attempts, 3);
});

test("active page becomes available before a slow unrelated prefetch completes", async () => {
  const background = deferred(); const batches = []; let ready = false;
  const startup = prepareDesktopStartup("/app/workers/calendar", new AbortController().signal, {
    onReady: () => { ready = true; }, prefetch: async ({ urls }) => { batches.push(urls); if (batches.length === 2) await background.promise; },
  });
  await Promise.resolve();
  assert.equal(ready, true); assert.deepEqual(batches[0], ["/api/calendar?limit=50&offset=0&view=upcoming", "/api/calendar?view=upcoming&limit=1"]);
  assert.ok(batches[1].includes("/api/connections")); assert.ok(!batches[1].includes(batches[0][0]));
  background.resolve(); await startup;
});

test("cancelled foreground startup never exposes a page or starts background work", async () => {
  const pending = deferred(); const controller = new AbortController(); let reads = 0; let ready = false;
  const startup = prepareDesktopStartup("/app/pages", controller.signal, { onReady: () => { ready = true; }, prefetch: async () => { reads += 1; await pending.promise; } });
  controller.abort(); pending.resolve(); await startup;
  assert.equal(ready, false); assert.equal(reads, 1);
});

test("transition and initial loading expose truthful states without cached private children", () => {
  const loading = renderToStaticMarkup(React.createElement(SpaceTransition, { state: { target, phase: "connecting" }, onDismiss() {}, onRetry() {} }));
  assert.match(loading, /<dialog/); assert.match(loading, /目标空间/); assert.match(loading, /role="status"/); assert.match(loading, /留在当前空间/); assert.doesNotMatch(loading, /重试切换/);
  const failed = renderToStaticMarkup(React.createElement(SpaceTransition, { state: { target, phase: "error", error: "fixture failure" }, onDismiss() {}, onRetry() {} }));
  assert.match(failed, /role="alert"/); assert.match(failed, /重试切换/);
  const startup = renderToStaticMarkup(React.createElement(SafeClientStartup, { pathname: "/app/pages", failed: false, desktop: true, onRetry() {} }, "old-private-space-content"));
  assert.match(startup, /cove-startup-frame/); assert.match(startup, /cove-space-skeleton/); assert.doesNotMatch(startup, /old-private-space-content|目标空间/);
  const css = fs.readFileSync(new URL("../core/app/src/app/space-transition.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /\.cove-space-transition[\s\S]*background: #fff/);
});
