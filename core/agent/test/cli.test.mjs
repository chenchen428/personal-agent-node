import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("legacy Memory CLI fails closed and points to main-Agent Activity", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [path.join(projectRoot, "bin", "pa-cli.mjs"), "memory", "recall", "--json"], {
      cwd: projectRoot,
      env: { ...process.env },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /legacy Memory domain has been removed/);
      assert.match(error.stderr, /pa-cli activity/);
      return true;
    },
  );
});

test("CLI sends an explicit execute boolean for local storage verification", async (t) => {
  let received = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, execute: received.execute }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "file",
    "verify-storage",
    "--execute",
    "--json",
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`,
      OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token",
    },
  });

  assert.deepEqual(received, { execute: true });
  assert.equal(JSON.parse(stdout).execute, true);
});

test("channel login is a no-side-effect plan until the user confirms execution", async (t) => {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(500);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "channel",
    "login",
    "xiaohongshu",
    "--json",
  ], {
    cwd: projectRoot,
    env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" },
  });

  const result = JSON.parse(stdout);
  assert.equal(result.execute, false);
  assert.equal(result.confirmationRequired, true);
  assert.equal(requestCount, 0);
});

test("confirmed channel login delegates QR delivery and monitoring to the bridge", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/api/channels/xiaohongshu/login") {
      response.end(JSON.stringify({
        ok: true,
        status: "pending",
        session: "login-session",
        expiresAt: "2026-07-11T20:10:00.000Z",
        delivered: true,
        monitoring: true,
      }));
      return;
    }
    response.end(JSON.stringify({ ok: false, error: "unexpected request" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "channel",
    "login",
    "xiaohongshu",
    "--execute",
    "--json",
  ], {
    cwd: projectRoot,
    env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" },
  });

  const result = JSON.parse(stdout);
  assert.equal(result.execute, true);
  assert.equal(result.delivered, true);
  assert.equal(result.monitoring, true);
  assert.equal(result.session, "login-session");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, {});
  assert.doesNotMatch(stdout, /qrImage|base64/);
});
