import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { CalendarStore } from "../src/calendar/store.js";
import { executeCalendarCommand } from "../src/calendar/control.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "bin", "pa-cli.mjs");

test("calendar CLI uses scoped control commands and revision-safe follow-up without scheduling or sending", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cove-calendar-cli-"));
  const store = new CalendarStore({ dataDir, spaceId: "space-a", sessionResolver: (id) => id === "main-a" ? { id, role: "main" } : null });
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: request.url, method: request.method, capability: request.headers["x-cove-calendar-capability"], command });
    try {
      if (request.headers["x-cove-calendar-capability"] !== "ephemeral-calendar-value") throw Object.assign(new Error("invalid capability"), { statusCode: 403 });
      const result = executeCalendarCommand({ calendarStore: store, session: { id: "main-a", role: "main" }, command });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, result }));
    } catch (error) {
      response.writeHead(error.statusCode || 400, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: error.message, code: error.code }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.close(); store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const env = { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${server.address().port}` };
  const run = async (...argv) => {
    const result = await execFileAsync(process.execPath, [cli, "calendar", ...argv, "--capability", "ephemeral-calendar-value", "--json"], { cwd: root, env });
    assert.doesNotMatch(result.stdout + result.stderr, /ephemeral-calendar-value/);
    return JSON.parse(result.stdout);
  };
  const created = await run("create", "--title", "确认设计", "--participants-json", '["小王","小李"]',
    "--start-at", "2026-09-12T09:00:00+08:00", "--time-zone", "Asia/Shanghai");
  assert.equal(created.data.startAt, "2026-09-12T01:00:00.000Z");
  assert.deepEqual(created.data.participants, ["小王", "小李"]);
  const id = created.data.id;
  const followed = await run("follow-up", "--id", id, "--expected-revision", "1", "--content", "等待对方确认",
    "--next-follow-up-at", "2026-09-13T09:00:00+08:00", "--status", "in_progress");
  assert.equal(followed.data.revision, 2);
  assert.equal((await run("due", "--before", "2026-09-14T00:00:00Z")).data.total, 1);
  const file = path.join(dataDir, "patch.json");
  fs.writeFileSync(file, JSON.stringify({ nextFollowUpAt: null, notes: "保留多行\n内容" }));
  assert.equal((await run("update", "--id", id, "--expected-revision", "2", "--input-file", file)).data.nextFollowUpAt, null);
  assert.equal((await run("show", "--id", id)).data.notes, "保留多行\n内容");
  assert.equal((await run("history", "--id", id, "--limit", "2", "--offset", "0")).data.hasMore, true);
  assert.equal((await run("list", "--from", "2026-09-12T00:00:00+08:00", "--to", "2026-09-13T00:00:00+08:00", "--status", "in_progress")).data.total, 1);
  await assert.rejects(run("update", "--id", id, "--expected-revision", "1", "--title", "stale"), (error) => /日程已更新/.test(error.stderr));
  assert.equal(requests.every((request) => request.url === "/api/internal/calendar-agent" && request.method === "POST"
    && request.capability === "ephemeral-calendar-value"), true);
  assert.equal(store.history(id).total, 3);
});

test("calendar CLI requires turn capability and rejects caller-owned identity selectors", async () => {
  for (const args of [
    ["list"],
    ["list", "--capability", "value", "--space", "other"],
    ["create", "--capability", "value", "--actor", "main-a"],
    ["follow-up", "--id", "cal_id", "--capability", "value", "--content", "missing revision"],
    ["create", "--capability", "value", "--participants-json", '"not-an-array"'],
  ]) {
    await assert.rejects(execFileAsync(process.execPath, [cli, "calendar", ...args, "--json"], {
      cwd: root, env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: "http://127.0.0.1:1" },
    }), (error) => /capability is required|Unsupported calendar option|expected-revision|array of participant names/.test(error.stderr));
  }
});

test("calendar poster CLI forwards only governed record and range inputs", async (t) => {
  let captured;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, result: { action: "poster", data: { objectIds: ["obj_poster"] } } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const result = await execFileAsync(process.execPath, [cli, "calendar", "poster", "--from", "2026-09-12T00:00:00Z",
    "--to", "2026-09-13T00:00:00Z", "--capability", "value", "--json"], {
    cwd: root, env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${server.address().port}` },
  });
  assert.deepEqual(captured, { action: "poster", entryId: "", input: { from: "2026-09-12T00:00:00Z", to: "2026-09-13T00:00:00Z" } });
  assert.deepEqual(JSON.parse(result.stdout).data.objectIds, ["obj_poster"]);
});
