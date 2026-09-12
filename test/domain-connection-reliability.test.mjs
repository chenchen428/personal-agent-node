import assert from "node:assert/strict";
import test from "node:test";
import { waitForConnectionResult } from "../core/app/src/components/desktop-v627/domain-verification-polling.ts";

const options = () => ({ signal: new AbortController().signal, deadline: Date.now() + 500, intervalMs: 1, timeoutMessage: "状态暂未确认" });

test("domain verification retries an unreadable status and stops after authoritative success", async () => {
  let calls = 0;
  let errors = 0;
  const results = [];
  const result = await waitForConnectionResult({ ...options(),
    probe: async () => { calls += 1; if (calls === 1) throw new Error("temporary gateway failure"); return { state: "completed", verification: { phase: "verified" } }; },
    onError: () => errors++, onResult: (value) => results.push(value),
  });
  assert.equal(result.verification.phase, "verified");
  assert.equal(errors, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 2);
  assert.equal(results.length, 1);
});

test("domain verification preserves an explicit backend failure", async () => {
  const result = await waitForConnectionResult({ ...options(), probe: async () => ({ state: "failed", message: "域名验证未通过" }) });
  assert.equal(result.state, "failed");
  assert.equal(result.message, "域名验证未通过");
});

test("cancelled domain polling aborts the read and cannot revive a success panel", async () => {
  const controller = new AbortController();
  let resolveRead;
  let readSignal;
  let results = 0;
  let pending;
  const started = new Promise((resolve) => {
    pending = waitForConnectionResult({ ...options(), signal: controller.signal,
      probe: (signal) => { readSignal = signal; resolve(); return new Promise((done) => { resolveRead = done; }); },
      onResult: () => results++,
    });
  });
  await started;
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await rejected;
  assert.equal(readSignal.aborted, true);
  resolveRead({ state: "completed" });
  await Promise.resolve();
  assert.equal(results, 0);
});

test("a hung domain status expires as unconfirmed and aborts its request", async () => {
  let readSignal;
  await assert.rejects(waitForConnectionResult({ ...options(), deadline: Date.now() + 30,
    probe: (signal) => { readSignal = signal; return new Promise(() => {}); },
  }), /状态暂未确认/);
  assert.equal(readSignal.aborted, true);
});
