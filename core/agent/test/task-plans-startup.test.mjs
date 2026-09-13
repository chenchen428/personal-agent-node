import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CalendarStore } from "../src/calendar/store.js";
import { BridgeStore } from "../src/store/store.js";

test("a duplicate server failing to bind never recovers or changes an active plan run", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-plan-startup-"));
  const calendar = new CalendarStore({ dataDir: path.join(root, "databases", "calendar"), spaceId: "startup-fixture", sessionResolver: id => ({ id, role: "main" }) });
  const legacy = new BridgeStore({ dataDir: path.join(root, "databases", "bridge") });
  const old = legacy.createScheduledTask({ name: "正在运行的旧计划", cron: "0 9 * * *", timezone: "Asia/Shanghai", prompt: "测试桩", enabled: true });
  const at = "2026-09-14T01:00:00.000Z";
  const plan = calendar.create({ sessionId: "main" }, { title: "已开始的测试执行", startAt: at, timeZone: "Asia/Shanghai", executionMode: "execute", executionPrompt: "测试桩" });
  const run = calendar.claimRun(plan.id, at);
  calendar.updateRun(run.id, { status: "running", sessionId: "active-session" });
  const blocker = net.createServer();
  await new Promise(resolve => blocker.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, ["--import", "tsx", "src/server/server.ts"], {
    cwd: path.resolve(import.meta.dirname, ".."), env: {
      ...process.env, NODE_ENV: "test", PRIVATE_SITE_DATA_ROOT: root, PERSONAL_AGENT_DATA_ROOT: root,
      PERSONAL_AGENT_SPACE_ID: "startup-fixture", PERSONAL_AGENT_SPACE_SLUG: "personal",
      OPEN_AGENT_BRIDGE_WORKSPACE_ROOT: root, OPEN_AGENT_BRIDGE_DATA_DIR: path.join(root, "databases", "bridge"),
      OPEN_AGENT_BRIDGE_HOST: "127.0.0.1", OPEN_AGENT_BRIDGE_PORT: String(blocker.address().port),
      OPEN_AGENT_BRIDGE_API_TOKEN: "startup-fixture-token", PERSONAL_AGENT_AUTH_PASSWORD: "startup-fixture-password",
      PERSONAL_AGENT_AUTH_COOKIE_SECRET: "startup-fixture-cookie-secret-long-enough", OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0", OPEN_AGENT_BRIDGE_SCHEDULER: "1",
      WECHAT_INBOUND_ATTACHMENTS_DIR: path.join(root, "files", "inbound"), OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: path.join(root, "mail"),
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const timeout = setTimeout(() => child.kill(), 15_000);
  t.after(async () => {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); }
    await new Promise(resolve => blocker.close(resolve));
    calendar.close(); legacy.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const [code] = await once(child, "exit");
  clearTimeout(timeout);
  assert.notEqual(code, 0);
  assert.match(output, /EADDRINUSE/);
  assert.equal(calendar.listRuns({ planId: plan.id }).items[0].status, "running");
  assert.equal(calendar.listRuns({ planId: plan.id }).items[0].sessionId, "active-session");
  assert.equal(legacy.getScheduledTask(old.id).enabled, true);
  assert.equal(calendar.listPlans().total, 1);
});
