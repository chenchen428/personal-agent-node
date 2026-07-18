import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Xiaohongshu CLI opens the browser without connecting and preserves signed URL reads", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, opened: true, connectionCreated: false, detail: {} }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const env = {
    ...process.env,
    OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`,
    OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token",
  };
  const cli = path.join(projectRoot, "bin", "pa-cli.mjs");
  const url = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=signed-token`;

  await execFileAsync(process.execPath, [cli, "connection", "xiaohongshu", "open", "--json"], { cwd: projectRoot, env });
  await execFileAsync(process.execPath, [cli, "connection", "xiaohongshu", "read", "--url", url, "--json"], { cwd: projectRoot, env });

  assert.deepEqual(requests, [
    { method: "POST", url: "/api/connections/xiaohongshu/open", body: {} },
    { method: "POST", url: "/api/connections/xiaohongshu/read", body: { url } },
  ]);
});

test("Twitter CLI delegates only search and read contracts", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, tweets: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const env = {
    ...process.env,
    OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`,
    OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token",
  };
  const cli = path.join(projectRoot, "bin", "pa-cli.mjs");
  const url = "https://x.com/example/status/1812345678901234567";

  await execFileAsync(process.execPath, [cli, "connection", "twitter", "search", "--query", "personal agents", "--json"], { cwd: projectRoot, env });
  await execFileAsync(process.execPath, [cli, "connection", "twitter", "read", "--url", url, "--json"], { cwd: projectRoot, env });

  assert.deepEqual(requests, [
    { method: "POST", url: "/api/connections/twitter/search", body: { query: "personal agents" } },
    { method: "POST", url: "/api/connections/twitter/read", body: { url } },
  ]);
});

const noteId = "65b123456789abcdef123456";
