import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, resolveNodeConfig } from "../src/config.ts";
import { authorizeRoute, createPrivateSiteGateway } from "../src/gateway.ts";

test("route access model keeps local administration on authenticated loopback", async () => {
  const auth = http.createServer((_request, response) => { response.writeHead(204); response.end(); });
  await new Promise((resolve) => auth.listen(0, "127.0.0.1", resolve));
  const config = { domain: "example.site", ports: { bridge: auth.address().port }, gateway: { trustEdgeHeaders: false } };
  const request = (remoteAddress) => ({
    headers: { host: "example.site", cookie: "session=redacted" },
    socket: { remoteAddress },
  });
  try {
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "public" }, config), true);
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "authenticated" }, config), true);
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "local-bootstrap" }, config), false);
    assert.equal(await authorizeRoute(request("127.0.0.1"), { access: "local-bootstrap" }, config), true);
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "local-admin" }, config), false);
    assert.equal(await authorizeRoute(request("127.0.0.1"), { access: "local-admin" }, config), true);
    assert.equal(await authorizeRoute(request("127.0.0.1"), { access: "internal" }, config), false);
    assert.equal(await authorizeRoute(request("127.0.0.1"), { access: "unknown" }, config), false);
  } finally {
    await new Promise((resolve, reject) => auth.close((error) => error ? reject(error) : resolve()));
  }
});

test("path gateway rejects unknown hosts, prefix confusion, and encoded traversal", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-gateway-"));
  const blogRoot = path.join(dataRoot, "publications", "blog");
  fs.mkdirSync(blogRoot, { recursive: true });
  fs.writeFileSync(path.join(blogRoot, "index.html"), "<!doctype html><title>Personal Agent</title>");
  initializeSite({ domain: "example.site", dataRoot });
  const config = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot, SITE_DOMAIN: "example.site" });
  const { server } = createPrivateSiteGateway({ config });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const home = await request({ port, host: "example.site", path: "/" });
    assert.equal(home.status, 200);
    assert.match(home.body, /Personal Agent/);

    assert.equal((await request({ port, host: "unknown.site", path: "/" })).status, 404);
    for (const legacy of ["/admin", "/agent", "/agentx", "/api/agent", "/api/files"]) assert.equal((await request({ port, host: "example.site", path: legacy })).status, 404, legacy);
    assert.equal((await request({ port, host: "example.site", path: "/unknown" })).status, 404);
    assert.equal((await request({ port, host: "example.site", path: "/blog/%2e%2e/admin" })).status, 400);
    assert.equal((await request({ port, host: "example.site", path: "/blog/%2fprivate" })).status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("canonical Console and domain API routes authenticate and rewrite to internal handlers", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-routes-"));
  const received = [];
  const bridge = http.createServer((request, response) => {
    if (request.url === "/_auth/check") {
      response.writeHead(request.headers.cookie === "session=ok" ? 204 : 401);
      response.end();
      return;
    }
    received.push({ service: "bridge", url: request.url, authenticated: request.headers["x-personal-agent-authenticated"] });
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  const consoleServer = http.createServer((request, response) => {
    received.push({ service: "console", url: request.url, authenticated: request.headers["x-personal-agent-authenticated"] });
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Console</title>");
  });
  await Promise.all([listen(bridge), listen(consoleServer)]);
  try {
    initializeSite({ domain: "example.site", dataRoot });
    const base = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot, SITE_DOMAIN: "example.site" });
    const config = { ...base, ports: { ...base.ports, bridge: bridge.address().port, admin: consoleServer.address().port } };
    const { server } = createPrivateSiteGateway({ config });
    await listen(server);
    try {
      const port = server.address().port;
      assert.equal((await request({ port, host: "example.site", path: "/app" })).status, 302);
      assert.equal((await request({ port, host: "example.site", path: "/app", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/app/setup", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/app/chat", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/app/mail", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/mail", headers: { cookie: "session=ok" } })).status, 404);
      assert.equal((await request({ port, host: "example.site", path: "/api/chat/sessions", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/api/system/projects", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/api/system/setup", headers: { cookie: "session=ok" } })).status, 200);
      assert.deepEqual(received.map(({ service, url }) => ({ service, url })), [
        { service: "console", url: "/app" },
        { service: "console", url: "/app/setup" },
        { service: "bridge", url: "/agent-bridge" },
        { service: "bridge", url: "/mail" },
        { service: "bridge", url: "/api/sessions" },
        { service: "console", url: "/api/projects" },
        { service: "console", url: "/api/setup" },
      ]);
      assert.ok(received.every((entry) => entry.authenticated === "1"));
    } finally {
      await close(server);
    }
  } finally {
    await Promise.all([close(bridge), close(consoleServer)]);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function request({ port, host, path: requestPath, headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: requestPath, headers: { host, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
