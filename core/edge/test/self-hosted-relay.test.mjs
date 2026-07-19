import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSelfHostedRelay } from "../src/self-hosted-relay.ts";
import { ReverseTunnelConnector } from "../../runtime/src/reverse-tunnel.ts";

test("self-hosted Relay authenticates one Node key and forwards HTTP to its loopback gateway", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-self-hosted-relay-"));
  const token = crypto.randomBytes(32).toString("base64url");
  const gateway = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain", "x-relay-path": request.url || "", "x-space-route": String(request.headers["x-personal-agent-space-route"] || "") });
    response.end("SELF_HOSTED_RELAY_OK");
  });
  await listen(gateway);
  const gatewayPort = gateway.address().port;
  const relayPort = await freePort();
  const relay = createSelfHostedRelay({
    config: {
      schemaVersion: 1,
      domain: "relay.example.test",
      siteId: "site_relaytest",
      tokenSha256: crypto.createHash("sha256").update(token).digest("hex"),
      listenHost: "127.0.0.1",
      listenPort: relayPort,
      generation: 1,
      heartbeatSeconds: 5,
    },
    logger: { log() {}, error() {} },
  });
  await relay.listen();
  const connector = new ReverseTunnelConnector({
    config: { runtimeDir: root, gateway: { port: gatewayPort }, domain: "relay.example.test", distribution: {} },
    tunnel: {
      protocol: "pa-reverse-ws-v1",
      endpoint: `ws://127.0.0.1:${relayPort}/v1/connect`,
      token,
      heartbeatSeconds: 5,
      maxFrameBytes: 128 * 1024,
      generation: 1,
      routePolicy: "gateway",
      clientVersion: "test",
    },
    logger: { log() {}, error() {} },
    random: () => 0,
  });
  connector.start();
  t.after(async () => {
    connector.stop();
    await relay.close();
    await close(gateway);
    fs.rmSync(root, { recursive: true, force: true });
  });
  await waitFor(() => relay.status().connected);
  const response = await fetch(`http://127.0.0.1:${relayPort}/full/app?source=custom`, { headers: { host: "relay.example.test" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-relay-path"), "/full/app?source=custom");
  assert.equal(await response.text(), "SELF_HOSTED_RELAY_OK");
  const spaceResponse = await get({ port: relayPort, host: "work.relay.example.test", path: "/app", headers: { "x-personal-agent-space-route": "forged" } });
  assert.equal(spaceResponse.headers["x-space-route"], "work");
  assert.equal(spaceResponse.body, "SELF_HOSTED_RELAY_OK");
  assert.doesNotMatch(fs.readFileSync(path.join(root, "reverse-tunnel.json"), "utf8"), new RegExp(token));
});

function listen(server) { return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); }
function close(server) { return new Promise((resolve) => server.close(resolve)); }
function get({ port, host, path: requestPath, headers = {} }) { return new Promise((resolve, reject) => { const request = http.request({ hostname: "127.0.0.1", port, path: requestPath, headers: { host, ...headers } }, (response) => { const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") })); }); request.on("error", reject); request.end(); }); }
async function freePort() { const server = http.createServer(); await listen(server); const port = server.address().port; await close(server); return port; }
async function waitFor(predicate, timeout = 3000) { const started = Date.now(); while (!predicate()) { if (Date.now() - started > timeout) throw new Error("Timed out waiting for Relay"); await new Promise((resolve) => setTimeout(resolve, 20)); } }
