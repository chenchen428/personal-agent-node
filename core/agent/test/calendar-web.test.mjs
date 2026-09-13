import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CalendarStore } from "../src/calendar/store.js";

test("real Calendar HTTP API authenticates readers and rejects browser writes, Space selectors and forged capabilities", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-calendar-http-"));
  const seeded = new CalendarStore({ dataDir: path.join(root, "databases", "calendar"), spaceId: "calendar-http", sessionResolver: (id) => ({ id, role: "main" }) });
  const entry = seeded.create({ sessionId: "fixture-main" }, { title: "公开测试日程", participants: ["测试甲"], startAt: "2026-09-12T09:00:00+08:00", timeZone: "Asia/Shanghai" });
  seeded.close();
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const cwd = path.resolve(import.meta.dirname, "..");
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/server.ts"], { cwd, env: {
    ...process.env, NODE_ENV: "test", PRIVATE_SITE_DATA_ROOT: root, PERSONAL_AGENT_DATA_ROOT: root,
    PERSONAL_AGENT_SPACE_ID: "calendar-http", PERSONAL_AGENT_SPACE_SLUG: "personal",
    OPEN_AGENT_BRIDGE_DATA_DIR: path.join(root, "databases", "bridge"), OPEN_AGENT_BRIDGE_HOST: "127.0.0.1", OPEN_AGENT_BRIDGE_PORT: String(port),
    OPEN_AGENT_BRIDGE_API_TOKEN: "calendar-http-test-token", PERSONAL_AGENT_AUTH_PASSWORD: "calendar-http-test-password",
    PERSONAL_AGENT_AUTH_COOKIE_SECRET: "calendar-http-cookie-secret-long-enough", OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0", OPEN_AGENT_BRIDGE_SCHEDULER: "0",
    WECHAT_INBOUND_ATTACHMENTS_DIR: path.join(root, "files", "inbound"), OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: path.join(root, "mail"),
  }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => { if (child.exitCode === null) { child.kill("SIGTERM"); await once(child, "exit"); } fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: "Bearer calendar-http-test-token" };
  let ready = false;
  for (let i = 0; i < 120; i += 1) {
    try { if ((await fetch(`${base}/api/calendar`, { headers })).ok) { ready = true; break; } } catch { /* startup */ }
    if (child.exitCode !== null) throw new Error(`Test server failed: ${output.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "test server ready");
  assert.equal((await fetch(`${base}/api/calendar`, { redirect: "manual" })).status, 401);
  const list = await (await fetch(`${base}/api/calendar?limit=1`, { headers })).json();
  assert.equal(list.total, 1); assert.equal(list.items[0].id, entry.id); assert.equal(list.hasMore, false);
  const upcoming = await (await fetch(`${base}/api/calendar?view=upcoming&from=2026-08-01T00:00:00Z&limit=1`, { headers })).json();
  assert.equal(upcoming.nextEntry.id, entry.id);
  assert.equal(upcoming.ongoingEntry, null);
  assert.equal((await fetch(`${base}/api/calendar?view=upcoming&spaceId=another-space`, { headers })).status, 400);
  assert.equal((await (await fetch(`${base}/api/calendar/${entry.id}`, { headers })).json()).entry.title, entry.title);
  assert.equal((await (await fetch(`${base}/api/calendar/${entry.id}/history`, { headers })).json()).total, 1);
  assert.equal((await fetch(`${base}/api/calendar/cal_missing`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/calendar?spaceId=another-space`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/api/calendar`, { method: "POST", headers, body: "{}" })).status, 403);
  for (const extra of [{}, { "x-cove-calendar-capability": "forged", "x-agent-role": "main" }, { "x-forwarded-for": "127.0.0.1", "x-cove-calendar-capability": "forged" }]) {
    const response = await fetch(`${base}/api/internal/calendar-agent`, { method: "POST", headers: { ...headers, ...extra, "content-type": "application/json" }, body: JSON.stringify({ action: "create", input: { title: "forged" } }) });
    assert.equal(response.status, 403);
  }
});
