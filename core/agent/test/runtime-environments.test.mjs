import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { createRuntimeEnvironmentService, runtimeProviderBaseUrl } from "../src/runtime-environments/index.ts";

function fixture(t, options = {}) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pa-runtime-environments-"));
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const service = createRuntimeEnvironmentService({ workspaceRoot, spaceId: "space-a", ...options });
  return { service, workspaceRoot };
}
async function provider(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const responses = { object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OK" }] }] };
const messages = { type: "message", role: "assistant", content: [{ type: "text", text: "OK" }] };
const draft = (baseUrl, extra = {}) => ({ mode: "custom", baseUrl, model: "unlisted-model-v1", credential: "fixture-secret", ...extra });

test("runtime settings migrate legacy defaults and require revision-safe Space ownership", t => {
  const { service, workspaceRoot } = fixture(t, { legacyFallback: { model: "fallback", reasoningEffort: "high" } });
  assert.equal(service.read().profiles.codex.model, "fallback");
  fs.mkdirSync(path.join(workspaceRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "config", "codex-runtime-settings.json"), JSON.stringify({ model: "legacy-selected", reasoningEffort: "low" }));
  assert.equal(service.read().profiles.codex.model, "legacy-selected");
  const saved = service.save({ revision: 0, engine: "claude-code", profiles: { "claude-code": { model: "sonnet" } } });
  assert.equal(saved.revision, 1);
  assert.equal(saved.profiles.codex.reasoningEffort, "low");
  assert.equal(service.readExecution().engine, "claude-code");
  assert.throws(() => service.save({ revision: 0, engine: "codex" }), error => error.statusCode === 409);
  assert.throws(() => createRuntimeEnvironmentService({ workspaceRoot, spaceId: "space-b" }).read(), error => error.code === "RUNTIME_SPACE_MISMATCH");
  assert.throws(() => service.save({ engine: "codex" }), error => error.statusCode === 400);
});

test("profiles keep secrets isolated and omit credentials from views and config", t => {
  const { service, workspaceRoot } = fixture(t);
  service.save({ revision: 0, engine: "codex", profiles: {
    codex: draft("https://codex.example/v1", { credential: "codex-private" }),
    "claude-code": draft("https://claude.example", { credential: "claude-private" }),
  } });
  assert.equal(service.readExecution().credential, "codex-private");
  service.save({ revision: 1, engine: "claude-code", profiles: { "claude-code": { credential: "", model: "claude-unlisted" } } });
  assert.equal(service.readExecution().credential, "claude-private");
  const safe = JSON.stringify(service.read()) + fs.readFileSync(path.join(workspaceRoot, "config", "runtime-environments.json"), "utf8");
  assert.doesNotMatch(safe, /codex-private|claude-private/);
  assert.equal(service.read().profiles.codex.credentialConfigured, true);
  service.save({ revision: 2, engine: "claude-code", profiles: { "claude-code": { clearCredential: true } } });
  assert.equal(service.readExecution().credential, "");
  assert.equal(service.read().profiles.codex.credentialConfigured, true);
  assert.throws(() => service.save({ revision: 3, engine: "codex", profiles: { codex: { baseUrl: "https://other.example" } } }), /重新填写或清除/);
  assert.equal(service.read().revision, 3);
});

test("distinct Space directories retain independent selection and secrets", t => {
  const a = fixture(t).service;
  const b = fixture(t, { spaceId: "space-b" }).service;
  a.save({ revision: 0, engine: "codex", profiles: { codex: draft("https://example.com/v1") } });
  assert.equal(b.read().revision, 0);
  assert.equal(b.read().profiles.codex.credentialConfigured, false);
  assert.equal(b.readExecution().credential, "");
});

test("failed multi-profile saves retain the old config and credential pair", t => {
  const { service, workspaceRoot } = fixture(t);
  service.save({ revision: 0, engine: "codex", profiles: { codex: draft("https://example.com/v1", { credential: "original-key" }) } });
  assert.throws(() => service.save({ revision: 1, engine: "codex", profiles: {
    codex: { credential: "replacement-key" }, "claude-code": { authType: "invalid" },
  } }));
  assert.equal(service.read().revision, 1);
  assert.equal(service.readExecution().credential, "original-key");
  assert.equal(fs.readdirSync(path.join(workspaceRoot, "secrets", "runtime-environments", "codex")).length, 1);
});

test("custom drafts make real protocol calls without saving and do not leak provider data", async t => {
  const seen = [];
  const url = await provider(t, async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    seen.push({ url: request.url, headers: request.headers, body: JSON.parse(text) });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(request.url === "/v1/responses" ? responses : messages));
  });
  const { service } = fixture(t);
  const a = await service.testConnectivity({ engine: "codex", profile: draft(`${url}/v1`) });
  const b = await service.testConnectivity({ engine: "claude-code", profile: draft(url) });
  const c = await service.testConnectivity({ engine: "claude-code", profile: draft(url, { authType: "bearer" }) });
  assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(c.ok, true);
  assert.equal(seen[0].url, "/v1/responses");
  assert.equal(seen[0].headers.authorization, "Bearer fixture-secret");
  assert.equal(seen[0].body.model, "unlisted-model-v1");
  assert.equal(seen[0].body.store, false);
  assert.equal(seen[1].url, "/v1/messages");
  assert.equal(seen[1].headers["x-api-key"], "fixture-secret");
  assert.equal(seen[1].headers["anthropic-version"], "2023-06-01");
  assert.equal(seen[2].headers.authorization, "Bearer fixture-secret");
  assert.equal(service.read().revision, 0);
  assert.doesNotMatch(JSON.stringify([a, b, c]), /fixture-secret|output_text|unlisted-model/);
});

test("provider roots and full endpoints share canonical probe and execution paths", async t => {
  const paths = [];
  const url = await provider(t, (request, response) => {
    paths.push(request.url);
    response.end(JSON.stringify(request.url.endsWith("/responses") ? responses : messages));
  });
  const { service } = fixture(t);
  const cases = [
    ["codex", "/v1", "/v1", "/v1/responses"],
    ["codex", "/v1/responses/", "/v1", "/v1/responses"],
    ["codex", "/gateway/responses", "/gateway", "/gateway/responses"],
    ["codex", "/responses", "", "/responses"],
    ["claude-code", "", "", "/v1/messages"],
    ["claude-code", "/v1", "", "/v1/messages"],
    ["claude-code", "/v1/messages/", "", "/v1/messages"],
    ["claude-code", "/messages", "", "/v1/messages"],
    ["claude-code", "/anthropic", "/anthropic", "/anthropic/v1/messages"],
    ["claude-code", "/anthropic/v1", "/anthropic", "/anthropic/v1/messages"],
    ["claude-code", "/anthropic/v1/messages", "/anthropic", "/anthropic/v1/messages"],
  ];
  for (const [engine, input, canonical, endpoint] of cases) {
    assert.equal(runtimeProviderBaseUrl(engine, `${url}${input}`), `${url}${canonical}`);
    assert.equal((await service.testConnectivity({ engine, profile: draft(`${url}${input}`) })).ok, true);
    assert.equal(paths.at(-1), endpoint);
    service.save({ revision: service.read().revision, engine, profiles: { [engine]: draft(`${url}${input}`) } });
    assert.equal(service.readExecution().profile.baseUrl, `${url}${canonical}`);
  }
});

test("connection checks reject bad URL, missing auth, header injection and unsafe origin reuse", async t => {
  const { service } = fixture(t);
  for (const url of ["https://user:pass@example.com", "https://example.com?token=secret", "https://example.com#x", "ftp://example.com", "http://example.com", "javascript:alert(1)"]) {
    assert.equal((await service.testConnectivity({ engine: "codex", profile: draft(url) })).status, "invalid-config");
  }
  assert.equal((await service.testConnectivity({ engine: "codex", profile: draft("https://example.com", { credential: "" }) })).status, "missing-credential");
  assert.equal((await service.testConnectivity({ engine: "codex", profile: draft("https://example.com", { credential: "key\r\nx-test:bad" }) })).status, "invalid-config");
  service.save({ revision: 0, engine: "codex", profiles: { codex: draft("https://example.com/v1") } });
  assert.equal((await service.testConnectivity({ engine: "codex", profile: { baseUrl: "https://other.example/v1" } })).status, "missing-credential");
  assert.equal((await service.testConnectivity({ engine: "claude-code", profile: draft("https://example.com", { credential: "" }) })).status, "missing-credential");
});

test("draft checks reuse only the owning engine saved credential and respect clear", async t => {
  const keys = [];
  const url = await provider(t, (request, response) => { keys.push(request.headers.authorization); response.end(JSON.stringify(responses)); });
  const { service } = fixture(t);
  service.save({ revision: 0, engine: "codex", profiles: { codex: draft(`${url}/v1`, { credential: "saved-key" }) } });
  assert.equal((await service.testConnectivity({ engine: "codex", profile: { model: "draft-model", credential: "" } })).ok, true);
  assert.deepEqual(keys, ["Bearer saved-key"]);
  assert.equal(service.read().profiles.codex.model, "unlisted-model-v1");
  assert.equal((await service.testConnectivity({ engine: "codex", profile: { clearCredential: true } })).status, "missing-credential");
  assert.equal(service.read().profiles.codex.credentialConfigured, true);
});

test("connection checks normalize unauthorized, redirects, malformed and oversized responses", async t => {
  const { service } = fixture(t);
  const url = await provider(t, (request, response) => {
    if (request.url.startsWith("/unauthorized")) { response.writeHead(401); response.end("fixture-secret"); }
    else if (request.url.startsWith("/redirect")) { response.writeHead(307, { location: "https://other.example" }); response.end(); }
    else if (request.url.startsWith("/large")) { response.writeHead(200); response.end("a".repeat(140 * 1024)); }
    else if (request.url.startsWith("/incomplete")) { response.end(JSON.stringify({ ...responses, status: "incomplete" })); }
    else { response.writeHead(200); response.end("fixture-secret"); }
  });
  for (const [route, status] of [["unauthorized", "unauthorized"], ["redirect", "protocol-error"], ["large", "protocol-error"], ["incomplete", "protocol-error"], ["bad", "protocol-error"]]) {
    const result = await service.testConnectivity({ engine: "codex", profile: draft(`${url}/${route}`) });
    assert.equal(result.status, status);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret|other.example/);
  }
});

test("timeouts cover both response headers and streaming bodies", async t => {
  const { service } = fixture(t, { timeoutMs: 60 });
  const url = await provider(t, (request, response) => {
    if (request.url.startsWith("/body")) { response.writeHead(200); response.write("{"); }
  });
  for (const route of ["headers", "body"]) {
    assert.equal((await service.testConnectivity({ engine: "codex", profile: draft(`${url}/${route}`) })).status, "timeout");
  }
});

test("detection normalizes CLI status, prevents shell execution and suppresses raw output", async t => {
  const calls = [];
  const { service } = fixture(t, { commands: { codex: { command: "node", args: ["a path/codex.js"] } }, exec: async (command, args) => {
    calls.push({ command, args });
    return { stdout: args.includes("--version") ? "codex 1.2.3 secret-account" : "Logged in using fixture-secret" };
  } });
  const result = await service.detect({ engine: "codex" });
  assert.equal(result.installed, true);
  assert.equal(result.version, "1.2.3");
  assert.equal(result.authentication, "authenticated");
  assert.equal(result.protocolReady, false);
  assert.deepEqual(calls[0], { command: "node", args: ["a path/codex.js", "--version"] });
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|secret-account/);
});

test("account tests require an actual successful runner probe, with bounded failures", async t => {
  const unsupported = fixture(t).service;
  assert.equal((await unsupported.testConnectivity({ engine: "codex" })).ok, false);
  const success = fixture(t, { accountConnectivity: async () => true }).service;
  assert.equal((await success.testConnectivity({ engine: "claude-code" })).ok, true);
  const failure = fixture(t, { accountConnectivity: async () => { throw new Error("fixture-secret"); } }).service;
  assert.doesNotMatch(JSON.stringify(await failure.testConnectivity({ engine: "codex" })), /fixture-secret/);
  const timeout = fixture(t, { timeoutMs: 60, accountConnectivity: async () => new Promise(() => {}) }).service;
  assert.equal((await timeout.testConnectivity({ engine: "codex" })).status, "timeout");
});

test("account catalog uses safe fields and never trusts injected diagnostic text", async t => {
  const { service } = fixture(t, {
    exec: async () => { throw new Error("fixture-secret"); },
    detectAccount: async () => ({ installed: true, authentication: "authenticated", protocolReady: true,
      message: "fixture-secret", models: [{ id: "model-one", label: "fixture-secret", reasoningEfforts: ["high", "secret value"] }], defaultModel: { id: "model-default" }, headers: { authorization: "fixture-secret" } }),
  });
  const result = await service.detect({ engine: "codex" });
  assert.equal(result.protocolReady, true);
  assert.equal(result.defaultModel.id, "model-default");
  assert.deepEqual(result.models, [{ id: "model-one", label: "model-one", reasoningEfforts: ["high"] }]);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|authorization|secret value/);
});

test("detectors keep each engine command, auth parser and adapter fallback independent", async t => {
  const calls = [];
  const { service } = fixture(t, {
    commands: { codex: { command: "node.exe", args: ["C:/Tools/Codex CLI/codex.js"] }, "claude-code": { command: "node.exe", args: ["C:/Tools/Claude Code/cli.js"] } },
    exec: async (command, args) => {
      calls.push([command, ...args]);
      if (args.includes("--version")) return { stdout: "3.2.1" };
      return args.includes("login") ? { stdout: "Logged in" } : { stdout: '{"loggedIn":true,"email":"private@example.invalid"}' };
    },
    detectAccount: async () => ({}),
  });
  assert.equal((await service.detect({ engine: "codex" })).authentication, "authenticated");
  assert.equal((await service.detect({ engine: "claude-code" })).authentication, "authenticated");
  assert.deepEqual(calls, [
    ["node.exe", "C:/Tools/Codex CLI/codex.js", "--version"],
    ["node.exe", "C:/Tools/Codex CLI/codex.js", "login", "status"],
    ["node.exe", "C:/Tools/Claude Code/cli.js", "--version"],
    ["node.exe", "C:/Tools/Claude Code/cli.js", "auth", "status"],
  ]);
});
