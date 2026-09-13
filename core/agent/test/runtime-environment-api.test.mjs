import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSpace, initializeInstallation } from "../../runtime/src/space-registry.ts";
import { createRuntimeEnvironmentService } from "../src/runtime-environments/index.ts";

const packageRoot = path.resolve(import.meta.dirname, "../../..");
const apiPath = "/api/node/v1/client/agent-runtime";

test("runtime configuration HTTP API preserves secrets, draft isolation, revisions and legacy Codex compatibility", async t => {
  const fixture = await startAgent(t);
  const { request } = fixture;
  const requests = [];
  const provider = http.createServer(async (req, response) => {
    let text = ""; for await (const chunk of req) text += chunk;
    requests.push({ path: req.url, key: req.headers.authorization, body: JSON.parse(text) });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }] }));
  });
  await listen(provider); t.after(() => { provider.closeAllConnections(); provider.close(); });
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  const current = await request(apiPath);
  assert.equal(current.status, 200);
  assert.equal(current.body.engine, "codex");
  assert.equal(current.body.revision, 0);
  assert.equal(current.body.profiles.codex.model, "legacy-model");
  const saved = await request(apiPath, { revision: 0, engine: "claude-code", profiles: {
    codex: { mode: "custom", baseUrl, model: "custom-codex", credential: "api-codex-private" },
    "claude-code": { mode: "custom", baseUrl: "https://claude.example.invalid", model: "custom-claude", credential: "api-claude-private" },
  } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.equal(saved.body.profiles.codex.credentialConfigured, true);
  assert.equal(saved.body.profiles["claude-code"].credentialConfigured, true);
  const viewed = await request(apiPath);
  assert.doesNotMatch(JSON.stringify([saved.body, viewed.body]), /api-codex-private|api-claude-private|credentialId/);
  assert.doesNotMatch(fs.readFileSync(path.join(fixture.spaceRoot, "config", "runtime-environments.json"), "utf8"), /api-codex-private|api-claude-private/);

  assert.equal((await request(apiPath, { revision: 0, engine: "codex" })).status, 409);
  assert.equal((await request(apiPath, { revision: 1, engine: "invalid" })).status, 400);
  assert.equal((await request(apiPath, { revision: 1, engine: "codex", profiles: { codex: { baseUrl: "https://name:secret@example.invalid" } } })).status, 400);
  assert.equal((await request(apiPath, { engine: "codex" })).status, 400);
  assert.equal((await request(apiPath, { revision: 1, engine: "codex", profiles: { codex: null } })).status, 400);
  assert.equal((await request(`${apiPath}/detect`, null)).status, 400);
  assert.equal((await request(`${apiPath}/test`, null)).status, 400);
  assert.equal((await request(`${apiPath}/test`, { engine: "codex", profile: { model: "unsaved-custom-model", credential: "" } })).body.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/responses");
  assert.equal(requests[0].key, "Bearer api-codex-private");
  assert.equal(requests[0].body.model, "unsaved-custom-model");
  const afterDraft = await request(apiPath);
  assert.equal(afterDraft.body.revision, 1);
  assert.equal(afterDraft.body.engine, "claude-code");
  assert.equal(afterDraft.body.profiles.codex.model, "custom-codex");
  assert.equal((await request(`${apiPath}/test`, { engine: "codex", profile: { credential: "", clearCredential: true } })).body.status, "missing-credential");
  const legacy = await request("/api/node/v1/client/codex-settings", { model: "legacy-updated-custom", reasoningEffort: "high" });
  assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
  const afterLegacy = await request(apiPath);
  assert.equal(afterLegacy.body.engine, "claude-code");
  assert.equal(afterLegacy.body.profiles.codex.model, "legacy-updated-custom");
  assert.equal(afterLegacy.body.profiles.codex.mode, "custom");
  assert.equal(afterLegacy.body.profiles.codex.credentialConfigured, true);
  assert.equal(afterLegacy.body.profiles["claude-code"].model, "custom-claude");
  const oldRead = await request("/api/node/v1/client/codex-settings");
  assert.equal(oldRead.status, 200);
  assert.equal(oldRead.body.model, "legacy-updated-custom");
});

test("Agent runtime API requires marked local desktop and rejects direct forged, mobile and cross-origin calls", async t => {
  const { request, port } = await startAgent(t);
  for (const route of [apiPath, "/api/node/v1/client/codex-settings"]) {
    for (const headers of [
      { "x-personal-agent-surface": "" }, { "x-personal-agent-surface": "mobile" },
      { "sec-ch-ua-mobile": "?1" }, { "user-agent": "Mozilla/5.0 (iPad)" },
      { host: "remote.example.invalid" }, { origin: "https://evil.example" },
      { origin: `http://127.0.0.1:${port + 1}` },
      { "x-forwarded-for": "127.0.0.1" }, { "x-forwarded-host": `127.0.0.1:${port}` },
    ]) assert.equal((await request(route, undefined, headers)).status, 403, `${route}: ${JSON.stringify(headers)}`);
  }
});

test("child runtime API returns main settings read-only and rejects every mutation path server-side", async t => {
  const fixture = await startAgent(t, { childSpace: true });
  const waitForReply = async (model) => {
    let latest;
    for (let attempt = 0; attempt < 150; attempt++) {
      const result = await fixture.request("/api/desktop/conversation");
      latest = result.body.session;
      if (result.body.session?.status === "idle" && JSON.stringify(result.body).includes(model)) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Inherited runtime did not return the selected main model: ${JSON.stringify({ status: latest?.status, messages: latest?.messages?.map(item => ({ role: item.role, content: item.content })) })}`);
  };
  const view = await fixture.request(apiPath);
  assert.equal(view.status, 200); assert.equal(view.body.readOnly, true); assert.equal(view.body.inherited, true);
  assert.equal(view.body.sourceSpace.id, fixture.mainId);
  assert.equal(view.body.profiles.codex.model, "shared-main-model");
  assert.doesNotMatch(JSON.stringify(view.body), /shared-main-credential|credentialId|secrets/);
  const firstTurn = await fixture.request("/api/desktop/conversation/messages", { content: "Return the selected model", clientMessageId: "shared-runtime-first" });
  assert.equal(firstTurn.status, 202);
  const firstReply = await waitForReply("shared-main-model");
  assert.doesNotMatch(JSON.stringify(firstReply.body), /shared-main-credential/);
  for (const route of [apiPath, `${apiPath}/detect`, `${apiPath}/test`, "/api/node/v1/client/codex-settings"]) {
    const result = await fixture.request(route, { revision: 1, engine: "codex", model: "forged", sourceSpace: { id: fixture.mainId }, profile: { mode: "custom", baseUrl: "https://attacker.invalid", credential: "attempt" } });
    assert.equal(result.status, 403, route);
    assert.equal(result.body.error.code, "RUNTIME_SETTINGS_READ_ONLY", route);
  }
  const legacy = await fixture.request("/api/node/v1/client/codex-settings");
  assert.equal(legacy.body.readOnly, true); assert.equal(legacy.body.model, "shared-main-model");
  assert.equal((await fixture.request(apiPath, undefined, { "x-personal-agent-surface": "mobile" })).status, 403);
  fixture.mainService.save({ revision: 1, engine: "codex", profiles: { codex: { model: "updated-main-model" } } });
  const nextTurn = await fixture.request("/api/desktop/conversation/messages", { content: "Return the selected model again", clientMessageId: "shared-runtime-second" });
  assert.equal(nextTurn.status, 202); await waitForReply("updated-main-model");
  const receipt = JSON.parse(fs.readFileSync(path.join(fixture.spaceRoot, "runtime", "setup", "web-conversation.json")));
  assert.equal(receipt.runtimeSourceSpaceId, fixture.mainId);
  fixture.mainService.save({ revision: 2, engine: "claude-code", profiles: { "claude-code": { model: "updated-main-model" } } });
  const changed = await fixture.request(apiPath);
  assert.equal(changed.body.engine, "claude-code"); assert.equal(changed.body.revision, 3);
  assert.equal(changed.body.profiles["claude-code"].model, "updated-main-model");
  assert.equal(fs.existsSync(path.join(fixture.spaceRoot, "config", "runtime-environments.json")), false);
  assert.equal(fs.existsSync(path.join(fixture.spaceRoot, "secrets", "runtime-environments")), false);
});

async function startAgent(t, { childSpace = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-runtime-api-"));
  const portServer = http.createServer(); await listen(portServer); const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const installationRoot = path.join(root, "installation");
  const { personal } = initializeInstallation({ dataRoot: installationRoot });
  const selected = childSpace ? createSpace({ dataRoot: installationRoot, slug: "work", displayName: "Work" }) : personal;
  const spaceRoot = selected.root;
  const mainService = createRuntimeEnvironmentService({ workspaceRoot: personal.root, spaceId: personal.id });
  if (childSpace) mainService.save({ revision: 0, engine: "codex", profiles: { codex: { mode: "custom", baseUrl: "https://models.example.invalid/v1", model: "shared-main-model", credential: "shared-main-credential" } } });
  const work = path.join(root, "agent-workspace"); fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(path.join(spaceRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(spaceRoot, "config", "codex-runtime-settings.json"), JSON.stringify({ model: "legacy-model", reasoningEffort: "low" }));
  const mockCli = path.join(root, "mock-codex.mjs");
  fs.writeFileSync(mockCli, `import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => { const p = JSON.parse(line); if (p.id === undefined) return;
if (p.method === 'thread/start' || p.method === 'thread/resume') { process.stdout.write(JSON.stringify({id:p.id,result:{thread:{id:p.params.threadId || 'shared-runtime-thread'}}})+'\\n'); return; }
if (p.method === 'turn/start') {
 process.stdout.write(JSON.stringify({id:p.id,result:{turn:{id:'shared-runtime-turn'}}})+'\\n');
 process.stdout.write(JSON.stringify({method:'item/completed',params:{threadId:p.params.threadId,turnId:'shared-runtime-turn',item:{type:'agentMessage',id:'reply',text:JSON.stringify({model:p.params.model,credential:process.env.PERSONAL_AGENT_MODEL_API_KEY})}}})+'\\n');
 process.stdout.write(JSON.stringify({method:'turn/completed',params:{threadId:p.params.threadId,turn:{id:'shared-runtime-turn',status:'completed'}}})+'\\n'); return;
}
const result = p.method === 'skills/list' ? {data:[{cwd:p.params.cwds[0],skills:[],errors:[]}]} : p.method === 'model/list' ? {data:[{id:'mock-model',isDefault:true,supportedReasoningEfforts:['high','low']}]} : p.method === 'config/read' ? {config:{model:'mock-model'}} : {};
process.stdout.write(JSON.stringify({id:p.id,result})+'\\n'); });
rl.on('close',()=>process.exit(0));`);
  const token = "runtime-api-fixture-token";
  const env = { ...process.env, NODE_ENV: "test", OPEN_AGENT_BRIDGE_PORT: String(port), OPEN_AGENT_BRIDGE_API_TOKEN: token,
    PRIVATE_SITE_DATA_ROOT: spaceRoot, PERSONAL_AGENT_DATA_ROOT: installationRoot, PERSONAL_AGENT_SPACE_ID: selected.id,
    PERSONAL_AGENT_SPACE_ROOT: spaceRoot, PERSONAL_AGENT_SPACE_SLUG: selected.slug, PERSONAL_AGENT_SPACE_KIND: selected.kind,
    OPEN_AGENT_BRIDGE_WORKSPACE_ROOT: work, OPEN_AGENT_BRIDGE_DATA_DIR: path.join(spaceRoot, "databases", "bridge"),
    OPEN_AGENT_BRIDGE_AGENT_DATA_DIR: path.join(spaceRoot, "agent-data"), OPEN_AGENT_BRIDGE_AGENT_DATA_DATABASE: path.join(spaceRoot, "agent-data", "data.sqlite"),
    OPEN_AGENT_BRIDGE_PRIVATE_PUBLICATIONS_DIR: path.join(spaceRoot, "private-publications"), OPEN_AGENT_BRIDGE_UPLOADS_DIR: path.join(spaceRoot, "uploads"),
    OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: path.join(spaceRoot, "mail"), OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0", OPEN_AGENT_BRIDGE_SCHEDULER: "0",
    PERSONAL_AGENT_AUTH_PASSWORD: "fixture-password", PERSONAL_AGENT_AUTH_COOKIE_SECRET: "fixture-cookie-secret",
    OPEN_AGENT_BRIDGE_CODEX_COMMAND: "unavailable-fixture-codex", OPEN_AGENT_BRIDGE_CODEX_APP_SERVER_COMMAND: process.execPath,
    OPEN_AGENT_BRIDGE_CODEX_APP_SERVER_ARGS: JSON.stringify([mockCli]), PRIVATE_SITE_INSTALL_ROOT: "", PERSONAL_AGENT_HOME: root,
    CODEX_HOME: path.join(root, "codex"), CLAUDE_CONFIG_DIR: path.join(root, "claude") };
  for (const key of Object.keys(env)) if (/^(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN)$/.test(key)) delete env[key];
  const child = spawn(process.execPath, [path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs"), "src/server/server.ts"], { cwd: path.join(packageRoot, "core", "agent"), env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", chunk => { output = (output + chunk).slice(-12000); }); child.stderr.on("data", chunk => { output = (output + chunk).slice(-12000); });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => { child.once("exit", resolve); setTimeout(resolve, 3000); }); }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 125 });
  });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(`Fixture exited: ${output}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
    if (attempt === 299) throw new Error(`Fixture startup timed out: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { port, spaceRoot, mainService, mainId: personal.id, async request(route, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = http.request({ hostname: "127.0.0.1", port, path: route, method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-personal-agent-surface": "desktop", ...headers }, timeout: 15000 }, response => {
        let text = ""; response.on("data", chunk => { text += chunk; });
        response.on("end", () => { try { resolve({ status: response.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); } });
      });
      outgoing.on("error", reject); outgoing.on("timeout", () => outgoing.destroy(new Error("Fixture request timed out")));
      outgoing.end(body === undefined ? undefined : JSON.stringify(body));
    });
  } };
}
function listen(server) { return new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); }
