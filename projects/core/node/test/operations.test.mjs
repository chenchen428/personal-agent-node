import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { controlEndpoint, createControlService, requestControl } from "../src/control-service.mjs";
import { createOperationStore } from "../src/operations.mjs";

test("R2/R3 operation approval binds digest, expires, redacts and executes once", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-operations-"));
  let clock = Date.parse("2026-07-13T12:00:00.000Z");
  const store = createOperationStore({ dataRoot, now: () => clock, randomUUID: () => "00000000-0000-4000-8000-000000000001" });
  try {
    const planned = store.plan({ command: "extension remove", risk: "R3", inputSummary: "Remove extension x", target: "extension:x", stateFingerprint: "state-a", idempotencyKey: "remove-x" });
    assert.equal(Date.parse(planned.expiresAt) - Date.parse(planned.createdAt), 10 * 60_000);
    assert.throws(() => store.approve(planned.id, { digest: planned.digest, actor: { kind: "agent", authenticated: true, loopback: true, channel: "local-tty" } }), /local human/i);
    assert.throws(() => store.approve(planned.id, { digest: "0".repeat(64), actor: localHuman() }), /digest/i);
    store.approve(planned.id, { digest: planned.digest, actor: localHuman() });
    let executions = 0;
    const handler = async () => { executions += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { token: "must-not-persist", nested: { password: "must-not-persist" }, reference: "ok" }; };
    const [first, replay] = await Promise.all([
      store.execute(planned.id, { digest: planned.digest, actor: { kind: "runtime" }, handler }),
      store.execute(planned.id, { digest: planned.digest, actor: { kind: "runtime" }, handler }),
    ]);
    assert.equal(first.status, "succeeded");
    assert.equal(replay.status, "succeeded");
    assert.equal(executions, 1);
    assert.equal(first.result.token, "[REDACTED]");
    assert.equal(first.result.nested.password, "[REDACTED]");
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(store.directory, `${planned.id}.json`)).mode & 0o777, 0o600);

    clock += 1;
    const expiringStore = createOperationStore({ dataRoot, now: () => clock, randomUUID: () => "00000000-0000-4000-8000-000000000002" });
    const expiring = expiringStore.plan({ command: "backup restore", risk: "R3", inputSummary: "Restore backup", target: "node", stateFingerprint: "state-b" });
    clock += 10 * 60_000 + 1;
    assert.throws(() => expiringStore.approve(expiring.id, { digest: expiring.digest, actor: localHuman() }), /expired/i);
    assert.equal(expiringStore.inspect(expiring.id).status, "expired");
  } finally { fs.rmSync(dataRoot, { recursive: true, force: true }); }
});

test("control socket requires a one-time approval challenge and survives malformed JSON", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-control-"));
  const config = { dataRoot, runtimeDir: path.join(dataRoot, "runtime") };
  const service = createControlService({ config, logger: { error() {} } });
  try {
    await service.listen();
    assert.equal(service.endpoint, controlEndpoint(config));
    if (process.platform === "win32") assert.match(service.endpoint, /^\\\\\.\\pipe\\personal-agent-[a-f0-9]{16}$/);
    else assert.equal(service.endpoint, path.join(dataRoot, "runtime", "control.sock"));
    if (process.platform !== "win32") assert.equal(fs.statSync(service.endpoint).mode & 0o777, 0o600);
    assert.equal((await requestControl(config, "health")).result.service, "personal-agent-control");
    const plan = service.operations.plan({ command: "cloud disconnect", risk: "R2", inputSummary: "Disconnect managed Cloud", target: "site" });
    await assert.rejects(requestControl(config, "operation.approve", { id: plan.id, digest: plan.digest }), /local human/i);
    const challenge = await requestControl(config, "operation.approval-challenge", { id: plan.id, digest: plan.digest });
    await assert.rejects(requestControl(config, "operation.approve", { id: plan.id, digest: plan.digest, nonce: challenge.result.nonce, confirmation: "wrong" }), /local human/i);
    const fresh = await requestControl(config, "operation.approval-challenge", { id: plan.id, digest: plan.digest });
    const approved = await requestControl(config, "operation.approve", { id: plan.id, digest: plan.digest, nonce: fresh.result.nonce, confirmation: fresh.result.prompt });
    assert.equal(approved.result.operation.status, "approved");
    const malformed = await rawRequest(service.endpoint, "not-json\n");
    assert.equal(JSON.parse(malformed).error.code, "INVALID_REQUEST");
    assert.equal((await requestControl(config, "health")).ok, true);
  } finally {
    await service.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function rawRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint, () => socket.end(body));
    let output = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { output += chunk; });
    socket.on("end", () => resolve(output.trim()));
    socket.on("error", reject);
  });
}

function localHuman() { return { kind: "human", authenticated: true, loopback: true, channel: "local-console" }; }
