import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { BridgeStore } from "../src/store/store.js";

const agentRoot = path.resolve(import.meta.dirname, "..");

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-main-startup-"));
  const store = new BridgeStore({ dataDir: path.join(root, "databases", "bridge") });
  const main = store.getOrCreateDesktopMainSession({ workspaceRoot: root });
  store.appendEvent(main.id, "session.user_message", { content: "完成启动恢复测试报告", source: "desktop" });
  store.appendEvent(main.id, "session.tool_result", { content: "已产生底稿，等待最终汇总" });
  store.updateSession(main.id, { status: "running", cliSessionId: "existing-fixture-thread" });
  const marker = path.join(root, "recovery-calls.jsonl");
  const preload = path.join(root, "inject-fixture-runner.mjs");
  fs.writeFileSync(preload, `
    import fs from 'node:fs';
    import { runtimeRunner } from ${JSON.stringify(pathToFileURL(path.join(agentRoot, "src", "agent", "runtime-runner.ts")).href)};
    runtimeRunner.runAppServerCommand = async config => {
      fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ sessionId: config.sessionId, cliSessionId: config.cliSessionId, allowCreateThread: config.allowCreateThread, recovery: config.stdin.startsWith('[main-recovery:continue]') }) + '\\n');
      await config.onSessionEvent({ sessionId: config.sessionId, kind: 'session.assistant_message', payload: { content: '启动后自动完成原请求。', metadata: { streamState: 'completed' } } });
      await config.onSessionEvent({ sessionId: config.sessionId, kind: 'session.complete', payload: { success: true, idle: true } });
      return { success: true };
    };
  `);
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
    }
    store.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  function start(port) {
    const child = spawn(process.execPath, ["--import", "tsx", "--import", pathToFileURL(preload).href, "src/server/server.ts"], {
      cwd: agentRoot, env: {
        ...process.env, NODE_ENV: "test", PRIVATE_SITE_DATA_ROOT: root, PERSONAL_AGENT_DATA_ROOT: root,
        PERSONAL_AGENT_SPACE_ID: "startup-fixture", PERSONAL_AGENT_SPACE_SLUG: "personal",
        OPEN_AGENT_BRIDGE_WORKSPACE_ROOT: root, OPEN_AGENT_BRIDGE_DATA_DIR: path.join(root, "databases", "bridge"),
        OPEN_AGENT_BRIDGE_HOST: "127.0.0.1", OPEN_AGENT_BRIDGE_PORT: String(port),
        OPEN_AGENT_BRIDGE_API_TOKEN: "startup-fixture-token", PERSONAL_AGENT_AUTH_PASSWORD: "startup-fixture-password",
        PERSONAL_AGENT_AUTH_COOKIE_SECRET: "startup-fixture-cookie-secret-long-enough", OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0", OPEN_AGENT_BRIDGE_SCHEDULER: "0",
        WECHAT_INBOUND_ATTACHMENTS_DIR: path.join(root, "files", "inbound"), OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: path.join(root, "mail"),
      }, stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    return { child, output: () => output };
  }
  return { root, store, main, marker, start };
}

test("successful server listen automatically resumes the existing main session without user input", { timeout: 20_000 }, async t => {
  const { store, main, marker, start } = await fixture(t);
  const { child, output } = start(await freePort());
  await waitFor(() => store.getSessionRecord(main.id).status === "idle", child, output);
  const calls = fs.readFileSync(marker, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(calls, [{ sessionId: main.id, cliSessionId: "existing-fixture-thread", allowCreateThread: false, recovery: true }]);
  const history = store.getSession(main.id).messages;
  assert.equal(history.filter(message => message.role === "user").length, 1);
  assert.equal(history.at(-1).content, "启动后自动完成原请求。");
  assert.match(output(), /open-agent-bridge listening/);
});

test("failed server listen leaves interrupted main state untouched and never calls the runner", { timeout: 20_000 }, async t => {
  const { store, main, marker, start } = await fixture(t);
  const blocker = net.createServer(); await new Promise(resolve => blocker.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  const { child, output } = start(blocker.address().port);
  const [code] = await once(child, "exit");
  assert.notEqual(code, 0); assert.match(output(), /EADDRINUSE/);
  assert.equal(fs.existsSync(marker), false); assert.equal(store.getSessionRecord(main.id).status, "running");
  assert.equal(store.getSession(main.id).events.some(event => event.payload.metadata?.eventType === "main/recovery/started"), false);
});

function freePort() { return new Promise(resolve => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function waitFor(predicate, child, output) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (predicate()) return;
    if (child.exitCode !== null) throw new Error(`fixture server stopped before recovery: ${output().slice(-800)}`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`fixture recovery timed out: ${output().slice(-800)}`);
}
