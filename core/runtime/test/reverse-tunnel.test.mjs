import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { WebSocketServer } from "ws";

import {
  loadReverseTunnelConfig,
  normalizeTunnelPath,
  isTunnelRouteAllowed,
  parseTunnelMessage,
  ReverseTunnelConnector,
  resolveTunnelRequestPath,
  sanitizeRequestHeaders,
  selfHostedTunnelContract,
  validateReverseTunnelContract,
} from "../src/reverse-tunnel.ts";

test("reverse tunnel contract accepts WSS and loopback WS without credentials or network routes", () => {
  const contract = validateReverseTunnelContract({
    protocol: "pa-reverse-ws-v1",
    endpoint: "wss://relay.example.site/v1/connect",
    heartbeatSeconds: 20,
    maxFrameBytes: 131072,
    generation: 2,
  });
  assert.equal(contract.protocol, "pa-reverse-ws-v1");
  assert.equal(contract.generation, 2);
  assert.equal(contract.routePolicy, "gateway");
  assert.throws(() => validateReverseTunnelContract({ ...contract, endpoint: "ws://relay.example.site/v1/connect" }), /must use WSS/);
  assert.throws(() => validateReverseTunnelContract({ ...contract, endpoint: "wss://relay.example.site/v1/connect?token=secret" }), /cannot contain/);
  assert.doesNotThrow(() => validateReverseTunnelContract({ ...contract, endpoint: "ws://127.0.0.1:9010/v1/connect" }));
});

test("self-hosted Relay uses the apex endpoint and upgrades legacy connect subdomains in memory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-self-hosted-endpoint-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binding = {
    kind: "sites",
    baseDomain: "agent.example.net",
    domain: "agent.example.net",
    tunnel: {
      protocol: "pa-reverse-ws-v1",
      endpoint: "wss://connect.agent.example.net/v1/connect",
      heartbeatSeconds: 20,
      maxFrameBytes: 131072,
      generation: 1,
      routePolicy: "gateway",
      credentialEnv: "PERSONAL_AGENT_CUSTOM_DOMAIN_TOKEN",
    },
  };
  fs.writeFileSync(path.join(root, "custom-domain-bindings.json"), JSON.stringify({ schemaVersion: 1, sites: binding }));
  assert.equal(selfHostedTunnelContract(binding).endpoint, "wss://agent.example.net/v1/connect");
  assert.equal(loadReverseTunnelConfig({
    site: { connectionMode: "self-hosted-edge" },
    configDir: root,
    env: { PERSONAL_AGENT_CUSTOM_DOMAIN_TOKEN: "a".repeat(43) },
  }).endpoint, "wss://agent.example.net/v1/connect");
});

test("unexpected non-authentication broker responses terminate the handshake and schedule a retry", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-reverse-http-error-"));
  class RejectingWebSocket extends EventEmitter {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => this.emit("unexpected-response", {}, { statusCode: 403, resume() {} }));
    }
    terminate() { this.readyState = 3; this.emit("close", 1006, Buffer.alloc(0)); }
    close() { this.terminate(); }
  }
  const connector = new ReverseTunnelConnector({
    config: testConfig(root, 8790),
    tunnel: tunnelAtFake(),
    WebSocketImpl: RejectingWebSocket,
    logger: silentLogger,
    random: () => 0,
  }).start();
  t.after(() => { connector.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await waitFor(() => readState(root)?.state === "degraded");
  assert.equal(readState(root).cause, "broker_http_403");
  assert.equal(connector.reconnectAttempt, 1);
});

test("reverse tunnel protocol rejects unsafe paths, headers, oversized frames, and invalid sequences", () => {
  assert.equal(normalizeTunnelPath("/app/chat?view=compact"), "/app/chat?view=compact");
  for (const value of ["https://evil.example/", "//evil.example/", "/bad\\path", "/bad\npath"]) assert.throws(() => normalizeTunnelPath(value), /path is invalid/);
  assert.deepEqual(sanitizeRequestHeaders({ authorization: "secret", connection: "upgrade", host: "evil.example", cookie: "session=ok", "x-forwarded-host": "node.example" }), { cookie: "session=ok", "x-forwarded-host": "node.example" });
  const distribution = testDistribution();
  assert.equal(resolveTunnelRequestPath("/"), "/");
  assert.equal(resolveTunnelRequestPath("/app?from=domain"), "/app?from=domain");
  assert.equal(isTunnelRouteAllowed(distribution, "/echo", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/login", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/public/report", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/chat/ws", "websocket"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/system/setup", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/system/spaces", "http"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/system/spaces", "http", "POST"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/spaces", "http", "POST"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/mobile/activity", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/apps/future-app/", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/app/conversations", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/mobile/activity", "http", "POST"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/future/capability", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/future/socket", "websocket"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/bad\\path", "http"), false);
  assert.equal(resolveTunnelRequestPath("/", "mobile-readonly"), "/app/mobile");
  assert.equal(isTunnelRouteAllowed(distribution, "/app/conversations", "http", "GET", "mobile-readonly"), false);
  assert.throws(() => parseTunnelMessage(JSON.stringify({ v: 1, type: "request.data", id: "stream-0001", seq: 0, data: Buffer.alloc(17 * 1024).toString("base64") }), { maxFrameBytes: 16 * 1024 }), /too large/);
  assert.throws(() => parseTunnelMessage(JSON.stringify({ v: 1, type: "request.start", id: "stream-0001", kind: "http", method: "GET", path: "/", headers: { "bad\nname": "x" } })), /header name/);
});

test("self-hosted Relay delegates full HTTP and WebSocket access to the authenticated local gateway", () => {
  assert.equal(isTunnelRouteAllowed({}, "/app", "http", "GET", "gateway"), true);
  assert.equal(isTunnelRouteAllowed({}, "/api/chat/ws", "websocket", "GET", "gateway"), true);
  assert.equal(isTunnelRouteAllowed({}, "//evil.example/path", "http", "GET", "gateway"), false);
  assert.equal(resolveTunnelRequestPath("/", "gateway"), "/");
});

test("connector forwards HTTP streams only to the fixed loopback gateway and never persists its token", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-reverse-http-"));
  const requests = [];
  const local = http.createServer(async (request, response) => {
    const body = await readBody(request);
    requests.push({ url: request.url, method: request.method, headers: request.headers, body: body.toString() });
    response.writeHead(201, { "content-type": "text/plain", "x-local": "ready", connection: "close" });
    response.write("reply-");
    response.end(body);
  });
  await listen(local);
  const brokerHttp = http.createServer();
  const broker = new WebSocketServer({ server: brokerHttp, path: "/v1/connect" });
  await listen(brokerHttp);
  const messages = [];
  let peer;
  broker.on("connection", (socket, request) => {
    peer = socket;
    assert.equal(request.headers.authorization, "Bearer node-secret-token");
    assert.equal(request.headers["sec-websocket-protocol"], "pa-reverse-ws-v1");
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  });
  const connector = new ReverseTunnelConnector({
    config: testConfig(root, local.address().port),
    tunnel: tunnelAt(brokerHttp),
    logger: silentLogger,
  }).start();
  t.after(async () => {
    connector.stop();
    for (const client of broker.clients) client.terminate();
    broker.close();
    await close(brokerHttp);
    await close(local);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitFor(() => messages.some((message) => message.type === "hello"));
  peer.send(JSON.stringify({ v: 1, type: "ready", connectionId: "connection-0001", generation: 1, heartbeatSeconds: 20, maxFrameBytes: 131072 }));
  peer.send(JSON.stringify({ v: 1, type: "request.start", id: "stream-http-0001", kind: "http", method: "POST", path: "/login?safe=1", headers: { authorization: "must-not-reach-local", host: "evil.example", connection: "keep-alive", "content-type": "text/plain", "x-forwarded-host": "owner.chenjianhui.site" } }));
  peer.send(JSON.stringify({ v: 1, type: "request.data", id: "stream-http-0001", seq: 0, data: Buffer.from("hello").toString("base64") }));
  peer.send(JSON.stringify({ v: 1, type: "request.end", id: "stream-http-0001" }));

  await waitFor(() => messages.some((message) => message.type === "response.end" && message.id === "stream-http-0001"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/login?safe=1");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.host, "owner.chenjianhui.site");
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].headers["x-forwarded-host"], "owner.chenjianhui.site");
  assert.equal(requests[0].body, "hello");
  const start = messages.find((message) => message.type === "response.start" && message.id === "stream-http-0001");
  assert.equal(start.status, 201);
  assert.equal(start.headers.connection, undefined);
  const responseBody = Buffer.concat(messages.filter((message) => message.type === "response.data" && message.id === "stream-http-0001").map((message) => Buffer.from(message.data, "base64"))).toString();
  assert.equal(responseBody, "reply-hello");
  const state = fs.readFileSync(path.join(root, "reverse-tunnel.json"), "utf8");
  assert.doesNotMatch(state, /node-secret-token/);
  assert.match(state, /"state": "ready"/);
  peer.send(JSON.stringify({ v: 1, type: "request.start", id: "stream-future-0001", kind: "http", method: "GET", path: "/future/capability", headers: {} }));
  peer.send(JSON.stringify({ v: 1, type: "request.end", id: "stream-future-0001" }));
  await waitFor(() => messages.some((message) => message.type === "response.end" && message.id === "stream-future-0001"));
  assert.equal(requests.at(-1).url, "/future/capability");

  peer.send(JSON.stringify({ v: 1, type: "request.start", id: "stream-spaces-0001", kind: "http", method: "GET", path: "/api/system/spaces", headers: {} }));
  peer.send(JSON.stringify({ v: 1, type: "request.end", id: "stream-spaces-0001" }));
  await waitFor(() => messages.some((message) => message.type === "response.error" && message.id === "stream-spaces-0001"));
  assert.equal(messages.find((message) => message.type === "response.error" && message.id === "stream-spaces-0001").code, "REMOTE_ROUTE_DENIED");
  assert.notEqual(requests.at(-1).url, "/api/system/spaces");
});

test("connector delegates tunneled WebSockets to the authenticated local gateway", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-reverse-ws-"));
  const localHttp = http.createServer();
  const localWs = new WebSocketServer({ noServer: true });
  localHttp.on("upgrade", (request, socket, head) => localWs.handleUpgrade(request, socket, head, (client) => localWs.emit("connection", client, request)));
  localWs.on("connection", (socket) => socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary })));
  await listen(localHttp);
  const brokerHttp = http.createServer();
  const broker = new WebSocketServer({ server: brokerHttp, path: "/v1/connect" });
  await listen(brokerHttp);
  const messages = [];
  let peer;
  broker.on("connection", (socket) => { peer = socket; socket.on("message", (data) => messages.push(JSON.parse(data.toString()))); });
  const connector = new ReverseTunnelConnector({
    config: testConfig(root, localHttp.address().port),
    tunnel: tunnelAt(brokerHttp),
    logger: silentLogger,
  }).start();
  t.after(async () => {
    connector.stop();
    for (const client of broker.clients) client.terminate();
    for (const client of localWs.clients) client.terminate();
    broker.close(); localWs.close();
    await close(brokerHttp); await close(localHttp);
    fs.rmSync(root, { recursive: true, force: true });
  });
  await waitFor(() => messages.some((message) => message.type === "hello"));
  peer.send(JSON.stringify({ v: 1, type: "ready", connectionId: "connection-0002", generation: 1 }));
  peer.send(JSON.stringify({ v: 1, type: "request.start", id: "stream-websocket-0001", kind: "websocket", method: "GET", path: "/api/chat/ws", headers: {} }));
  await waitFor(() => messages.some((message) => message.type === "response.start" && message.id === "stream-websocket-0001"));
  assert.equal(messages.find((message) => message.type === "response.start" && message.id === "stream-websocket-0001").status, 101);
  assert.equal(localWs.clients.size, 1);
  peer.send(JSON.stringify({ v: 1, type: "request.cancel", id: "stream-websocket-0001" }));
  await waitFor(() => localWs.clients.size === 0);
});

test("broker 401 triggers one credential rotation and reconnects without exposing either token", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-reverse-refresh-"));
  let refreshCalls = 0;
  class RefreshingWebSocket extends EventEmitter {
    static OPEN = 1;
    static instances = 0;
    constructor() {
      super();
      this.readyState = 0;
      this.index = ++RefreshingWebSocket.instances;
      queueMicrotask(() => {
        if (this.index === 1) this.emit("unexpected-response", {}, { statusCode: 401, resume() {} });
        else {
          this.readyState = RefreshingWebSocket.OPEN;
          this.emit("open");
          this.emit("message", Buffer.from(JSON.stringify({ v: 1, type: "ready", connectionId: "connection-refreshed", generation: 2 })), false);
        }
      });
    }
    send() {}
    close() { this.readyState = 3; this.emit("close", 1000, Buffer.alloc(0)); }
    terminate() { this.readyState = 3; this.emit("close", 1006, Buffer.alloc(0)); }
  }
  const connector = new ReverseTunnelConnector({
    config: testConfig(root, 8790),
    tunnel: { ...tunnelAtFake(), accessExpiresAt: '2030-07-13T12:15:00.000Z', refreshAvailable: true },
    WebSocketImpl: RefreshingWebSocket,
    refreshCredential: async () => {
      refreshCalls += 1;
      return { token: 'rotated-node-secret-token', accessExpiresAt: '2030-07-13T12:30:00.000Z', generation: 2 };
    },
    logger: silentLogger,
  }).start();
  t.after(() => { connector.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await waitFor(() => readState(root)?.state === 'ready');
  assert.equal(refreshCalls, 1);
  assert.equal(RefreshingWebSocket.instances, 2);
  const state = fs.readFileSync(path.join(root, 'reverse-tunnel.json'), 'utf8');
  assert.doesNotMatch(state, /node-secret-token|rotated-node-secret-token/);
  assert.equal(readState(root).authorizationRequired, false);
});

test("invalid refresh transitions to reauth_required, stops the retry storm, and single-flights concurrent refresh", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-reverse-reauth-"));
  let calls = 0;
  let rejectRefresh;
  const connector = new ReverseTunnelConnector({
    config: testConfig(root, 8790),
    tunnel: { ...tunnelAtFake(), accessExpiresAt: '2020-07-13T12:15:00.000Z', refreshAvailable: true },
    refreshCredential: () => {
      calls += 1;
      return new Promise((_resolve, reject) => { rejectRefresh = reject; });
    },
    logger: silentLogger,
  });
  t.after(() => { connector.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const first = connector.recoverCredential('broker_401');
  const second = connector.recoverCredential('broker_401');
  assert.equal(first, second);
  await waitFor(() => calls === 1);
  rejectRefresh(Object.assign(new Error('replayed'), { code: 'REFRESH_REPLAYED' }));
  await first;
  const state = readState(root);
  assert.equal(state.state, 'reauth_required');
  assert.equal(state.authorizationRequired, true);
  assert.equal(state.setupAction, 'connectivity.managed-authorize');
  assert.equal(connector.reconnectTimer, null);
});

test("terminal refresh failure enters authorizing and recovers through one silent browser bootstrap", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-reverse-silent-"));
  let silentCalls = 0;
  let resolveSilent;
  const connector = new ReverseTunnelConnector({
    config: testConfig(root, 8790),
    tunnel: { ...tunnelAtFake(), accessExpiresAt: "2020-07-13T12:15:00.000Z", refreshAvailable: true },
    refreshCredential: async () => { throw Object.assign(new Error("expired"), { code: "REFRESH_EXPIRED" }); },
    silentCredential: () => {
      silentCalls += 1;
      return new Promise((resolve) => { resolveSilent = resolve; });
    },
    logger: silentLogger,
  });
  connector.ready = true;
  t.after(() => { connector.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const recovery = connector.recoverCredential("broker_401", { keepConnection: true });
  await waitFor(() => readState(root)?.state === "authorizing");
  assert.equal(silentCalls, 1);
  resolveSilent({ token: "silently-recovered-token", accessExpiresAt: "2030-07-13T12:30:00.000Z", generation: 2 });
  assert.equal(await recovery, true);
  assert.equal(readState(root).state, "ready");
  assert.equal(connector.tunnel.token, "silently-recovered-token");
});

function tunnelAt(server) {
  return { protocol: "pa-reverse-ws-v1", endpoint: `ws://127.0.0.1:${server.address().port}/v1/connect`, heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 1, token: "node-secret-token", clientVersion: "test" };
}
function tunnelAtFake() { return { protocol: "pa-reverse-ws-v1", endpoint: "wss://relay.example.test/v1/connect", heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 1, token: "node-secret-token", clientVersion: "test" }; }
function testConfig(runtimeDir, port) { return { runtimeDir, domain: "owner.chenjianhui.site", gateway: { port }, distribution: testDistribution() }; }
function testDistribution() { return { routing: { paths: [
  { prefix: "/echo", access: "authenticated", kind: "proxy" },
  { prefix: "/login", access: "public", kind: "proxy" },
  { prefix: "/public", access: "public", kind: "proxy" },
  { prefix: "/api/chat/ws", access: "authenticated", kind: "proxy", websocket: true },
  { prefix: "/api/system/setup/actions", access: "authenticated", kind: "proxy" },
  { prefix: "/api/system/update", access: "authenticated", kind: "proxy" },
  { prefix: "/api/system", access: "authenticated", kind: "proxy" },
  { prefix: "/app/settings", access: "authenticated", kind: "proxy" },
  { prefix: "/app/setup/bootstrap", access: "authenticated", kind: "proxy" },
] } }; }
const silentLogger = { log() {}, error() {} };
function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }
async function readBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return Buffer.concat(chunks); }
async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for reverse tunnel test state");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function readState(root) { try { return JSON.parse(fs.readFileSync(path.join(root, 'reverse-tunnel.json'), 'utf8')); } catch { return null; } }
