import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, resolveNodeConfig } from "../src/config.ts";
import { authorizeRoute, createPrivateSiteGateway } from "../src/gateway.ts";
import { setDefaultPersonalApp } from "../src/apps.ts";

test("route access model gives direct loopback access without weakening tunneled hosts", async () => {
  const auth = http.createServer((_request, response) => { response.writeHead(204); response.end(); });
  await new Promise((resolve) => auth.listen(0, "127.0.0.1", resolve));
  const config = { domain: "example.site", ports: { bridge: auth.address().port }, gateway: { trustEdgeHeaders: false } };
  const request = (remoteAddress, host = "example.site", cookie = "session=redacted") => ({
    headers: { host, cookie },
    socket: { remoteAddress },
  });
  try {
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "public" }, config), true);
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "authenticated" }, config), true);
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "local-bootstrap" }, config), false);
    assert.equal(await authorizeRoute(request("127.0.0.1"), { access: "local-bootstrap" }, config), false);
    assert.equal(await authorizeRoute(request("127.0.0.1", "127.0.0.1", ""), { access: "local-bootstrap" }, config), true);
    assert.equal(await authorizeRoute(request("203.0.113.8"), { access: "local-admin" }, config), false);
    assert.equal(await authorizeRoute(request("127.0.0.1"), { access: "authenticated" }, config), true);
    assert.equal(await authorizeRoute(request("127.0.0.1"), { access: "local-admin" }, config), false);
    assert.equal(await authorizeRoute(request("127.0.0.1", "127.0.0.1", ""), { access: "authenticated" }, config), true);
    assert.equal(await authorizeRoute(request("127.0.0.1", "127.0.0.1", ""), { access: "local-admin" }, config), true);
    assert.equal(await authorizeRoute(request("127.0.0.1", "localhost", ""), { access: "authenticated" }, config), true);
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
    assert.equal(home.status, 302);

    assert.equal((await request({ port, host: "unknown.site", path: "/" })).status, 404);
    for (const legacy of ["/admin", "/agent", "/agentx", "/api/agent", "/api/files"]) assert.equal((await request({ port, host: "example.site", path: legacy })).status, 404, legacy);
    assert.equal((await request({ port, host: "example.site", path: "/unknown" })).status, 404);
    assert.equal((await request({ port, host: "example.site", path: "/_next/staticx/app.css" })).status, 404);
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
    received.push({ service: "bridge", url: request.url, authenticated: request.headers["x-personal-agent-authenticated"], cookie: request.headers.cookie, authorization: request.headers.authorization });
    response.setHeader("set-cookie", "private=must-not-leak");
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
      assert.equal((await request({ port, host: "example.site", path: "/_next/static/app.css" })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/login" })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/" })).status, 302);
      const authenticatedHome = await request({ port, host: "example.site", path: "/", headers: { cookie: "session=ok" } });
      assert.equal(authenticatedHome.status, 302);
      assert.equal(authenticatedHome.headers.location, "/app");
      const publicPage = await request({ port, host: "example.site", path: "/public/report", headers: { cookie: "private=must-not-forward", authorization: "Bearer must-not-forward" } });
      assert.equal(publicPage.status, 200);
      assert.equal(publicPage.headers["set-cookie"], undefined);
      assert.equal((await request({ port, host: "example.site", path: "/app" })).status, 302);
      assert.equal((await request({ port, host: "127.0.0.1", path: "/app" })).status, 200);
      assert.equal((await request({ port, host: "127.0.0.1", path: "/app/settings" })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/app", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/app/settings", headers: { cookie: "session=ok" } })).status, 302);
      assert.equal((await request({ port, host: "example.site", path: "/app/setup", headers: { cookie: "session=ok" } })).status, 302);
      assert.equal((await request({ port, host: "127.0.0.1", path: "/app/setup" })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/app/chat", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/app/mail", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/mail", headers: { cookie: "session=ok" } })).status, 404);
      assert.equal((await request({ port, host: "example.site", path: "/api/chat/sessions", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/api/node/v1/capabilities", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/api/mobile/pages?limit=1", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/api/system/projects", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/api/system/setup", headers: { cookie: "session=ok" } })).status, 200);
      assert.equal((await request({ port, host: "example.site", path: "/api/system/setup/actions/installation.local-auth/plan", headers: { cookie: "session=ok" } })).status, 302);
      assert.equal((await request({ port, host: "127.0.0.1", path: "/api/system/setup/actions/installation.local-auth/plan" })).status, 200);
      assert.deepEqual(received.map(({ service, url }) => ({ service, url })), [
        { service: "console", url: "/_next/static/app.css" },
        { service: "bridge", url: "/login" },
        { service: "bridge", url: "/pages/report" },
        { service: "console", url: "/app" },
        { service: "console", url: "/app/settings" },
        { service: "console", url: "/app" },
        { service: "console", url: "/app/setup" },
        { service: "console", url: "/app/chat" },
        { service: "console", url: "/app/mail" },
        { service: "bridge", url: "/api/sessions" },
        { service: "bridge", url: "/api/node/v1/capabilities" },
        { service: "bridge", url: "/api/mobile/pages?limit=1" },
        { service: "console", url: "/api/projects" },
        { service: "console", url: "/api/setup" },
        { service: "console", url: "/api/setup/actions/installation.local-auth/plan" },
      ]);
      assert.equal(received[0].authenticated, undefined);
      assert.equal(received[1].authenticated, undefined);
      assert.equal(received[2].authenticated, undefined);
      assert.equal(received[2].cookie, undefined);
      assert.equal(received[2].authorization, undefined);
      assert.ok(received.filter((_, index) => ![0, 1, 2].includes(index)).every((entry) => entry.authenticated === "1"));
    } finally {
      await close(server);
    }
  } finally {
    await Promise.all([close(bridge), close(consoleServer)]);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("tunneled login preserves the session cookie through the gateway", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-login-gateway-"));
  const bridge = http.createServer((request, response) => {
    if (request.url === "/_auth/check") {
      response.writeHead(request.headers.cookie === "session=issued" ? 204 : 401);
      response.end();
      return;
    }
    if (request.url === "/login" && request.method === "POST") {
      response.writeHead(303, {
        location: "/",
        "set-cookie": "session=issued; Path=/; HttpOnly; Secure; SameSite=Lax",
      });
      response.end();
      return;
    }
    if (request.url === "/logout") {
      response.writeHead(303, {
        location: "/login",
        "set-cookie": "session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await listen(bridge);
  try {
    initializeSite({ domain: "example.site", dataRoot });
    const base = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot, SITE_DOMAIN: "example.site" });
    const config = { ...base, ports: { ...base.ports, bridge: bridge.address().port } };
    const { server } = createPrivateSiteGateway({ config });
    await listen(server);
    try {
      const port = server.address().port;
      const login = await request({ port, host: "example.site", path: "/login", method: "POST" });
      assert.equal(login.status, 303);
      assert.equal(login.headers.location, "/");
      assert.match(login.headers["set-cookie"]?.[0] || "", /^session=issued;/);

      const home = await request({ port, host: "example.site", path: "/", headers: { cookie: "session=issued" } });
      assert.equal(home.status, 302);
      assert.equal(home.headers.location, "/app");

      const logout = await request({ port, host: "example.site", path: "/logout" });
      assert.equal(logout.status, 303);
      assert.equal(logout.headers.location, "/login");
      assert.match(logout.headers["set-cookie"]?.[0] || "", /^session=;/);
    } finally {
      await close(server);
    }
  } finally {
    await close(bridge);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("authenticated Personal Apps use the default root while invalid Apps fall back safely", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-app-gateway-"));
  const bridge = http.createServer((request, response) => {
    response.writeHead(request.url === "/_auth/check" && request.headers.cookie === "session=ok" ? 204 : 401);
    response.end();
  });
  await listen(bridge);
  try {
    initializeSite({ domain: "example.site", dataRoot });
    const base = resolveNodeConfig({ PRIVATE_SITE_DATA_ROOT: dataRoot, SITE_DOMAIN: "example.site" });
    const config = { ...base, ports: { ...base.ports, bridge: bridge.address().port } };
    const appRoot = path.join(config.appsDir, "example.dashboard");
    fs.mkdirSync(path.join(appRoot, "dist"), { recursive: true });
    fs.writeFileSync(path.join(appRoot, "personal-agent.app.json"), `${JSON.stringify({ apiVersion: "personal-agent/app-v1", id: "example.dashboard", name: "Dashboard", entry: "dist/index.html", requires: { nodeApi: "1" } })}\n`);
    fs.writeFileSync(path.join(appRoot, "dist", "index.html"), "<!doctype html><title>Personal App</title>");
    setDefaultPersonalApp(config, "example.dashboard");
    const { server } = createPrivateSiteGateway({ config });
    await listen(server);
    try {
      const port = server.address().port;
      assert.equal((await request({ port, host: "example.site", path: "/apps/example.dashboard/" })).status, 302);
      const home = await request({ port, host: "example.site", path: "/", headers: { cookie: "session=ok" } });
      assert.equal(home.status, 302);
      assert.equal(home.headers.location, "/apps/example.dashboard/");
      const canonical = await request({ port, host: "example.site", path: "/apps/example.dashboard?view=summary", headers: { cookie: "session=ok" } });
      assert.equal(canonical.status, 308);
      assert.equal(canonical.headers.location, "/apps/example.dashboard/?view=summary");
      const app = await request({ port, host: "example.site", path: "/apps/example.dashboard/settings", headers: { cookie: "session=ok" } });
      assert.equal(app.status, 200);
      assert.match(app.body, /Personal App/);
      fs.rmSync(path.join(appRoot, "dist", "index.html"));
      const fallback = await request({ port, host: "example.site", path: "/", headers: { cookie: "session=ok" } });
      assert.equal(fallback.headers.location, "/app");
      assert.equal((await request({ port, host: "example.site", path: "/apps/example.dashboard/", headers: { cookie: "session=ok" } })).status, 404);
    } finally {
      await close(server);
    }
  } finally {
    await close(bridge);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function request({ port, host, path: requestPath, method = "GET", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: requestPath, method, headers: { host, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
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
