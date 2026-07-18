import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const agentRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(agentRoot, "..", "..");

test("V6.22 read-only client API is local, searchable and self-contained", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-client-v622-"));
  const port = await freePort();
  const token = "client-v622-test-token";
  const uploadsDir = path.join(root, "uploads");
  fs.mkdirSync(path.join(uploadsDir, "relative-page"), { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, "relative-page", "index.html"), "<h1>Relative page</h1>");
  const child = spawn(process.execPath, [path.join(workspaceRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/server/server.ts"], {
    cwd: agentRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      OPEN_AGENT_BRIDGE_PORT: String(port),
      OPEN_AGENT_BRIDGE_API_TOKEN: token,
      PERSONAL_AGENT_AUTH_PASSWORD: "client-v622-local-password",
      PERSONAL_AGENT_AUTH_COOKIE_SECRET: "client-v622-cookie-secret-for-tests",
      OPEN_AGENT_BRIDGE_DATA_DIR: path.join(root, "bridge"),
      OPEN_AGENT_BRIDGE_AGENT_DATA_DIR: path.join(root, "agent-data"),
      OPEN_AGENT_BRIDGE_AGENT_DATA_DATABASE: path.join(root, "agent-data", "agent-data.sqlite"),
      OPEN_AGENT_BRIDGE_PRIVATE_PUBLICATIONS_DIR: path.join(root, "private-publications"),
      OPEN_AGENT_BRIDGE_UPLOADS_DIR: uploadsDir,
      OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: path.join(root, "mail"),
      PRIVATE_SITE_DATA_ROOT: path.join(root, "workspace"),
      OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0",
      OPEN_AGENT_BRIDGE_SCHEDULER: "0",
      OPEN_AGENT_BRIDGE_ALLOW_LOCAL_ONLY_MANAGED_FILES: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 3_000); });
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  });
  await waitForServer(port, child, () => output);

  const capabilities = await get(port, token, "/api/node/v1/capabilities");
  assert.equal(capabilities.result.capabilities.client.readOnly, true);

  const conversation = await get(port, token, "/api/desktop/conversation");
  assert.equal(conversation.session.role, "main");
  const conversationSessions = await get(port, token, "/api/sessions?limit=20");
  assert.equal(conversationSessions.totalSessions, 1);
  assert.equal(conversationSessions.sessions[0].id, conversation.session.id);
  assert.equal(conversationSessions.sessions.some((session) => session.role === "worker"), false);

  const overviewStartedAt = Date.now();
  const overview = await get(port, token, "/api/node/v1/client/overview");
  assert.ok(Date.now() - overviewStartedAt < 1_000, "overview must not wait for remote connection probes");
  assert.equal(overview.result.machine.state, "running");
  assert.equal(overview.result.machine.mobileAccess, "unavailable");
  assert.equal(overview.result.machine.mobileAddress, "");
  assert.equal(overview.result.machine.workspaceRoot, workspaceRoot);
  assert.equal(typeof overview.result.counts.pages, "number");
  assert.equal(typeof overview.result.counts.runningWork, "number");
  assert.equal(Array.isArray(overview.result.recent), true);

  const connectionsStartedAt = Date.now();
  const connections = await get(port, token, "/api/connections");
  assert.ok(Date.now() - connectionsStartedAt < 1_000, "connections must not wait for browser or network probes");
  assert.equal(Array.isArray(connections.connections), true);

  const personalWechatSetup = await get(port, token, "/api/connections/wechat-personal/setup");
  assert.equal(personalWechatSetup.setup.qianxunDocsUrl, "https://daenmax.github.io/qxpro-doc/doc/start/");
  assert.equal(personalWechatSetup.setup.qianxunBaseUrl, "http://127.0.0.1:8055");
  assert.equal(personalWechatSetup.setup.callbackUrl, `http://127.0.0.1:${port}/api/internal/channels/wechat-personal/callback`);
  assert.equal(typeof (await get(port, token, "/api/connections/wechat-personal/status?probe=0")).connection, "object");
  assert.deepEqual((await get(port, token, "/api/connections/wechat-personal/conversations?limit=50&before=100")).conversations, []);
  assert.deepEqual((await get(port, token, "/api/connections/wechat-personal/history?conversation=pwc_0123456789abcdef0123456789abcdef&limit=100")).messages, []);
  assert.equal(await status(port, token, "/api/connections/wechat-personal/history?conversation=raw-wxid"), 400);
  const callback = await fetch(`http://127.0.0.1:${port}/api/internal/channels/wechat-personal/callback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "recvMsg", wxid: "wxid_owner", data: { msgType: 1, fromWxid: "wxid_friend", msg: "hello" } }),
  });
  assert.equal(callback.status, 200);
  assert.equal((await callback.text()).trim(), "ignored:not_configured");

  const activity = await get(port, token, "/api/node/v1/client/activity?q=does-not-exist&limit=3");
  assert.deepEqual(activity.result.items, []);
  assert.equal(activity.result.query, "does-not-exist");

  const pages = await get(port, token, "/api/node/v1/client/pages");
  assert.equal(Array.isArray(pages.result.pages), true);
  const relativePage = pages.result.pages.find((page) => page.url === "/public/uploads/relative-page/index.html");
  assert.ok(relativePage);
  assert.equal(relativePage.shareUrl, "");
  assert.doesNotMatch(relativePage.url, /https?:\/\//);
  const missingPages = await get(port, token, "/api/node/v1/client/pages?q=does-not-exist&visibility=private");
  assert.deepEqual(missingPages.result.pages, []);

  const mobileActivity = await get(port, token, "/api/mobile/activity?query=does-not-exist&limit=3");
  assert.deepEqual(mobileActivity.result.items, []);
  assert.equal(mobileActivity.result.query, "does-not-exist");
  assert.equal(await status(port, token, "/agent-memory"), 404);
  assert.equal(await status(port, token, "/api/memories"), 404);

  const mobileTasks = await get(port, token, "/api/mobile/tasks?query=does-not-exist&status=running");
  assert.deepEqual(mobileTasks.result.items, []);
  assert.deepEqual(mobileTasks.result.counts, { all: 0, running: 0, completed: 0, interrupted: 0 });

  const mobilePages = await get(port, token, "/api/mobile/pages?query=does-not-exist&visibility=private");
  assert.deepEqual(mobilePages.result.items, []);
  assert.deepEqual(mobilePages.result.counts, { all: 0, private: 0, public: 0 });

  assert.equal(await status(port, token, "/api/node/v1/client/automations"), 410);

  const runtime = await get(port, token, "/api/node/v1/client/runtime");
  assert.equal(runtime.result.shellLifecycle, "client-owned");
  assert.equal(runtime.result.shellStopsService, undefined);

  const dataSchema = await get(port, token, "/api/agent-data/schema?counts=0&preview=1");
  assert.deepEqual(dataSchema.objects, []);
  assert.equal(dataSchema.initialResult, null);
});

async function get(port, token, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  return payload;
}

async function status(port, token, pathname) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers: { authorization: `Bearer ${token}` } });
  return response.status;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(port)); });
  });
}

async function waitForServer(port, child, getOutput) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Agent exited before startup (${child.exitCode})\n${getOutput()}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/health`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Agent\n${getOutput()}`);
}
