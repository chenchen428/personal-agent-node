import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, resolveNodeConfig } from "../src/config.mjs";
import { createPrivateSiteGateway } from "../src/gateway.mjs";

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
    assert.equal((await request({ port, host: "example.site", path: "/agentx" })).status, 404);
    assert.equal((await request({ port, host: "example.site", path: "/unknown" })).status, 404);
    assert.equal((await request({ port, host: "example.site", path: "/blog/%2e%2e/admin" })).status, 400);
    assert.equal((await request({ port, host: "example.site", path: "/blog/%2fprivate" })).status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

function request({ port, host, path: requestPath }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port, path: requestPath, headers: { host } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}
