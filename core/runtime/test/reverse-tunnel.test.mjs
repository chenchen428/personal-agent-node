import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocketServer } from "ws";

import {
  normalizeTunnelPath,
  isTunnelRouteAllowed,
  parseTunnelMessage,
  ReverseTunnelConnector,
  resolveTunnelRequestPath,
  sanitizeRequestHeaders,
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
  assert.throws(() => validateReverseTunnelContract({ ...contract, endpoint: "ws://relay.example.site/v1/connect" }), /must use WSS/);
  assert.throws(() => validateReverseTunnelContract({ ...contract, endpoint: "wss://relay.example.site/v1/connect?token=secret" }), /cannot contain/);
  assert.doesNotThrow(() => validateReverseTunnelContract({ ...contract, endpoint: "ws://127.0.0.1:9010/v1/connect" }));
});

test("reverse tunnel protocol rejects unsafe paths, headers, oversized frames, and invalid sequences", () => {
  assert.equal(normalizeTunnelPath("/app/chat?view=compact"), "/app/chat?view=compact");
  for (const value of ["https://evil.example/", "//evil.example/", "/bad\\path", "/bad\npath"]) assert.throws(() => normalizeTunnelPath(value), /path is invalid/);
  assert.deepEqual(sanitizeRequestHeaders({ authorization: "secret", connection: "upgrade", host: "evil.example", cookie: "session=ok", "x-forwarded-host": "node.example" }), { cookie: "session=ok", "x-forwarded-host": "node.example" });
  const distribution = testDistribution();
  assert.equal(resolveTunnelRequestPath("/"), "/app/mobile");
  assert.equal(resolveTunnelRequestPath("/app?from=domain"), "/app/mobile?from=domain");
  assert.equal(isTunnelRouteAllowed(distribution, "/echo", "http"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/login", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/public/report", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/chat/ws", "websocket"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/system/setup", "http"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/mobile/activity", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/apps/future-app/", "http"), true);
  assert.equal(isTunnelRouteAllowed(distribution, "/app/conversations", "http"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/api/mobile/activity", "http", "POST"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/future/capability", "http"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/future/socket", "websocket"), false);
  assert.equal(isTunnelRouteAllowed(distribution, "/bad\\path", "http"), false);
  assert.throws(() => parseTunnelMessage(JSON.stringify({ v: 1, type: "request.data", id: "stream-0001", seq: 0, data: Buffer.alloc(17 * 1024).toString("base64") }), { maxFrameBytes: 16 * 1024 }), /too large/);
  assert.throws(() => parseTunnelMessage(JSON.stringify({ v: 1, type: "request.start", id: "stream-0001", kind: "http", method: "GET", path: "/", headers: { "bad\nname": "x" } })), /header name/);
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
  await waitFor(() => messages.some((message) => message.type === "response.error" && message.id === "stream-future-0001"));
  assert.equal(messages.find((message) => message.type === "response.error" && message.id === "stream-future-0001").code, "REMOTE_ROUTE_DENIED");
  assert.equal(requests.length, 1);
});

test("connector denies tunneled WebSockets because remote access is mobile read-only", async (t) => {
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
  await waitFor(() => messages.some((message) => message.type === "response.error" && message.id === "stream-websocket-0001"));
  assert.equal(messages.find((message) => message.type === "response.error" && message.id === "stream-websocket-0001").code, "REMOTE_ROUTE_DENIED");
  assert.equal(localWs.clients.size, 0);
});

function tunnelAt(server) {
  return { protocol: "pa-reverse-ws-v1", endpoint: `ws://127.0.0.1:${server.address().port}/v1/connect`, heartbeatSeconds: 20, maxFrameBytes: 131072, generation: 1, token: "node-secret-token", clientVersion: "test" };
}
function testConfig(runtimeDir, port) { return { runtimeDir, domain: "owner.chenjianhui.site", gateway: { port }, distribution: testDistribution() }; }
function testDistribution() { return { routing: { paths: [
  { prefix: "/echo", access: "authenticated", kind: "proxy" },
  { prefix: "/login", access: "public", kind: "proxy" },
  { prefix: "/public", access: "public", kind: "proxy" },
  { prefix: "/api/chat/ws", access: "authenticated", kind: "proxy", websocket: true },
  { prefix: "/api/system/setup/actions", access: "local-admin", kind: "proxy" },
  { prefix: "/api/system/update", access: "local-admin", kind: "proxy" },
  { prefix: "/api/system", access: "authenticated", kind: "proxy" },
  { prefix: "/app/settings", access: "local-admin", kind: "proxy" },
  { prefix: "/app/setup/bootstrap", access: "local-bootstrap", kind: "proxy" },
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
