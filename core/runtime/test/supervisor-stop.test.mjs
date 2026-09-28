import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeSite, writeJsonAtomic } from "../src/config.ts";
import { installationPaths } from "../src/space-registry.ts";
import { assertPortAvailable, stopChildren } from "../src/supervisor.ts";

const cli = path.resolve(import.meta.dirname, "../bin/private-site.mjs");

test("stop waits for the old supervisor and its listening port before reporting stopped", async t => {
  if (process.platform === "win32") return t.skip("POSIX signal timing");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-stop-test-"));
  initializeSite({ domain: "stop-test.local", dataRoot });
  const child = spawn(process.execPath, ["-e", `
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => console.log(server.address().port));
    process.on("SIGTERM", () => setTimeout(() => server.close(() => process.exit(0)), 800));
  `], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await once(child, "exit"); }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  const [chunk] = await once(child.stdout, "data");
  const port = Number(String(chunk).trim());
  assert.ok(port > 0);
  const runtimeFile = path.join(installationPaths(dataRoot).runtimeRoot, "supervisor.json");
  writeJsonAtomic(runtimeFile, { pid: child.pid, status: "running", releaseRoot: "test-release" });

  const stop = spawn(process.execPath, ["--import", "tsx", cli, "stop", "--data-root", dataRoot, "--expected-pid", String(child.pid)],
    { stdio: ["ignore", "pipe", "pipe"], cwd: path.resolve(import.meta.dirname, "../../..") });
  let stdout = "", stderr = "";
  stop.stdout.on("data", chunk => { stdout += chunk; });
  stop.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(stop, "exit");
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).stopped, true);
  assert.notEqual(child.exitCode, null, "old supervisor must have exited before stop returns");
  assert.equal(await portOpen(port), false, "old port must be free before stop returns");
  assert.equal(JSON.parse(fs.readFileSync(runtimeFile, "utf8")).status, "stopped");
});

test("supervisor force-stops a child that ignores TERM before releasing its port", async t => {
  if (process.platform === "win32") return t.skip("POSIX signal timing");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-child-stop-"));
  const child = spawn(process.execPath, ["-e", `
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => console.log(server.address().port));
    process.on("SIGTERM", () => {});
  `], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await once(child, "exit"); }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [chunk] = await once(child.stdout, "data");
  const port = Number(String(chunk).trim());
  const output = fs.openSync(path.join(root, "child.log"), "a");
  await stopChildren(new Map([["gateway", { child, output }]]));
  assert.notEqual(child.signalCode, null, "TERM-ignoring child must exit after KILL");
  assert.equal(await portOpen(port), false);
});

test("startup rejects a port still held by the old gateway", async t => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { if (server.listening) server.close(); });
  const port = server.address().port;
  await assert.rejects(assertPortAvailable("127.0.0.1", port, "private-site-gateway"), /already in use/);
  await new Promise(resolve => server.close(resolve));
  await assertPortAvailable("127.0.0.1", port, "private-site-gateway");
});

test("stop does not report success while an old gateway remains on the recorded Space port", async t => {
  if (process.platform === "win32") return t.skip("POSIX signal timing");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-orphan-gateway-"));
  const { config } = initializeSite({ domain: "stop-test.local", dataRoot });
  const gateway = net.createServer();
  await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
  const port = gateway.address().port;
  const supervisor = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);"], { stdio: "ignore" });
  t.after(async () => {
    if (supervisor.exitCode === null && supervisor.signalCode === null) { supervisor.kill("SIGKILL"); await once(supervisor, "exit"); }
    await new Promise(resolve => gateway.close(resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  const runtimeFile = path.join(installationPaths(dataRoot).runtimeRoot, "supervisor.json");
  writeJsonAtomic(runtimeFile, { pid: supervisor.pid, status: "running", releaseRoot: "test-release", spaces: { [config.space.id]: { pid: supervisor.pid } } });
  const stop = spawn(process.execPath, ["--import", "tsx", cli, "stop", "--data-root", dataRoot, "--expected-pid", String(supervisor.pid)],
    { stdio: ["ignore", "pipe", "pipe"], cwd: path.resolve(import.meta.dirname, "../../.."), env: { ...process.env, PRIVATE_SITE_GATEWAY_PORT: String(port) } });
  let stderr = "";
  stop.stderr.on("data", chunk => { stderr += chunk; });
  const [code] = await once(stop, "exit");
  assert.notEqual(code, 0, "a remaining gateway listener must fail stop");
  assert.match(stderr, /gateway.*still listening/i);
  assert.notEqual(JSON.parse(fs.readFileSync(runtimeFile, "utf8")).status, "stopped");
  const start = spawn(process.execPath, ["--import", "tsx", cli, "daemon-start", "--data-root", dataRoot],
    { stdio: ["ignore", "pipe", "pipe"], cwd: path.resolve(import.meta.dirname, "../../.."), env: { ...process.env, PRIVATE_SITE_GATEWAY_PORT: String(port) } });
  let startError = "";
  start.stderr.on("data", chunk => { startError += chunk; });
  const [startCode] = await once(start, "exit");
  assert.notEqual(startCode, 0, "new UI must not claim launch while the old gateway still listens");
  assert.match(startError, /gateway.*still listening/i);
});

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}
