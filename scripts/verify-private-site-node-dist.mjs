#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const requestedRoot = path.resolve(process.argv[2] || "");
if (!fs.existsSync(requestedRoot)) throw new Error("Usage: verify-private-site-node-dist.mjs <release-root>");
const releaseRoot = fs.realpathSync(requestedRoot);
const manifest = readJson("release-manifest.json");

await main();

async function main() {
  verifyLayout();
  verifyChecksums();
  verifyPublicBoundary();
  verifyCompiledCli();
  const releasePreparation = verifyPreparation();
  const application = await verifyApplication();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    releaseId: manifest.releaseId,
    revision: manifest.revision,
    architecture: manifest.architecture,
    delivery: manifest.delivery,
    releasePreparation,
    application,
    localMail: { dataOwner: "workspace", smtpServerBundled: false, independentlyGoverned: true },
    webConversation: { route: "/app/chat", realAgentRuntimeRequired: true, sameSessionReplyRequired: true, wechatRequired: true },
  }, null, 2)}\n`);
}

function verifyLayout() {
  assert(manifest.schemaVersion === 2, "Release manifest schema must be 2");
  assert(manifest.releaseType === "personal-agent-node", "Release type must be personal-agent-node");
  assert(manifest.architecture === "next-core-workspace", "Release architecture is not the unified Next.js application");
  assert(manifest.releaseId && manifest.revision, "Release identity is incomplete");
  assert(manifest.dirty === false || process.env.PERSONAL_AGENT_ALLOW_DIRTY_RELEASE === "1", "Release must be built from a clean worktree");
  assert(manifest.delivery?.core?.mutable === false && manifest.delivery?.workspace?.mutable === true, "Core/Workspace ownership is invalid");
  assert(manifest.delivery?.workspace?.preserveOnUninstall === true, "Workspace preservation is not declared");
  assert(manifest.pluginApi?.version === "personal-agent/v1", "Plugin API version is missing");
  assert(manifest.appApi?.version === "personal-agent/app-v1" && manifest.appApi?.cloudRequired === false, "Personal App API contract is missing");
  assert(!fs.existsSync(at("projects")), "Historical projects directory must not be distributed");
  for (const relative of [
    "core/app/server.js", "core/app/.next/static", "core/runtime/bin/personal-agent.mjs", "core/runtime/bin/private-site.mjs",
    "core/runtime/app/control-service.mjs", "core/runtime/app/gateway.mjs", "core/runtime/app/reverse-tunnel.mjs", "core/agent/app/server.mjs", "core/agent/app/worker.mjs",
    "core/control/server.mjs", "core/apps/schema/personal-agent.app.schema.json", "core/plugins/schema/personal-agent.plugin.schema.json",
    "workspace/AGENTS.md", "workspace/skills", "workspace/workflows", "workspace/registry/skills.json", "workspace/registry/plugins.json",
    "registry/delivery.json", "docs/adr/0003-core-workspace-next-architecture.md", "SBOM.cdx.json", "SHA256SUMS",
  ]) assert(fs.existsSync(at(relative)), `Release file is missing: ${relative}`);
  const installer = fs.readFileSync(at("scripts/install-private-site-node-release.mjs"), "utf8");
  assert(!/from\s+["'][^"']+\.ts["']/.test(installer), "Release installer depends on unpackaged TypeScript source");
  for (const relative of ["workspace/apps", "workspace/files", "workspace/databases", "workspace/plugins", "workspace/secrets", "workspace/logs"]) {
    assert(fs.statSync(at(relative)).isDirectory(), `Workspace directory is missing: ${relative}`);
  }
}

function verifyChecksums() {
  const expected = new Map();
  for (const line of fs.readFileSync(at("SHA256SUMS"), "utf8").trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  ([^\0]+)$/.exec(line);
    assert(match, `Invalid checksum record: ${line}`);
    assert(safeRelative(match[2]), `Unsafe checksum path: ${match[2]}`);
    expected.set(match[2], match[1]);
  }
  const files = listFiles(releaseRoot).map((file) => path.relative(releaseRoot, file).replaceAll("\\", "/")).filter((name) => name !== "SHA256SUMS");
  assert(files.length === expected.size, "Checksums do not cover the complete release");
  for (const relative of files) {
    assert(expected.has(relative), `Checksum is missing: ${relative}`);
    assert(sha256(at(relative)) === expected.get(relative), `Checksum mismatch: ${relative}`);
  }
}

function verifyPublicBoundary() {
  for (const file of listFiles(releaseRoot)) {
    const relative = path.relative(releaseRoot, file).replaceAll("\\", "/");
    const parts = relative.split("/");
    const base = parts.at(-1) || "";
    assert(!parts.includes(".git") && !parts.includes(".local"), `Private workspace member leaked: ${relative}`);
    assert(base !== ".env" && !base.startsWith(".env."), `Environment file leaked: ${relative}`);
    assert(!/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|db-wal|db-shm|log)$/i.test(base), `Credential or runtime data leaked: ${relative}`);
  }
  const packageMetadata = readJson("package.json");
  assert(packageMetadata.workspaces === undefined, "Release must be one package, not an npm workspace graph");
  const dependencyText = JSON.stringify(packageMetadata.dependencies || {});
  assert(!/smtp-server|imapflow|haraka/i.test(dependencyText), "Raw mail server dependency is bundled");
  const sbom = readJson("SBOM.cdx.json");
  const componentPurls = new Set((sbom.components || []).map((entry) => entry.purl));
  assert(componentPurls.has("pkg:cargo/tauri@2.11.5"), "Desktop Tauri runtime is missing from the SBOM");
  assert(componentPurls.has("pkg:cargo/tauri-plugin-single-instance@2.4.3"), "Desktop single-instance runtime is missing from the SBOM");
}

function verifyCompiledCli() {
  const result = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), "help", "--json"], { encoding: "utf8", timeout: 30_000 });
  assert(result.status === 0, `Compiled CLI failed: ${String(result.stderr || "").trim()}`);
  const body = JSON.parse(result.stdout);
  assert(body.ok === true && body.result?.binary === "personal-agent", "Compiled CLI contract is invalid");
}

function verifyPreparation() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-release-verify-"));
  const homeRoot = path.join(root, ".personal-agent");
  const installRoot = path.join(homeRoot, "core");
  const workspaceRoot = path.join(homeRoot, "workspace");
  const binRoot = path.join(root, "bin");
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    fs.symlinkSync(process.platform === "win32" ? releaseRoot : path.relative(installRoot, releaseRoot), path.join(installRoot, "current"), process.platform === "win32" ? "junction" : "dir");
    fs.writeFileSync(path.join(installRoot, "installation.json"), `${JSON.stringify({ schemaVersion: 2, activeReleaseId: manifest.releaseId, revision: manifest.revision, dataRoot: workspaceRoot, service: "skipped" })}\n`);
    const env = { ...process.env, PERSONAL_AGENT_HOME: homeRoot, PRIVATE_SITE_INSTALL_ROOT: installRoot, PRIVATE_SITE_DATA_ROOT: workspaceRoot, PRIVATE_SITE_CLI_BIN: binRoot };
    const init = spawnSync(process.execPath, [at(manifest.entrypoints.node), "init", "--domain", "personal-agent.local"], { env, encoding: "utf8", timeout: 30_000 });
    assert(init.status === 0, `Release init failed: ${String(init.stderr || "").trim()}`);
    const prepare = spawnSync(process.execPath, [at(manifest.entrypoints.node), "prepare"], { env, encoding: "utf8", timeout: 60_000 });
    assert(prepare.status === 0, `Release prepare failed: ${String(prepare.stderr || "").trim()}`);
    for (const relative of ["AGENTS.md", "skills", "workflows", "registry", "apps", "plugins", "files", "databases", "secrets"]) assert(fs.existsSync(path.join(workspaceRoot, relative)), `Prepared Workspace is missing: ${relative}`);
    const appCompatibility = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "config", "apps-compatibility.json"), "utf8"));
    assert(appCompatibility.schemaVersion === 1 && appCompatibility.candidateNodeApis?.includes("1"), "Prepared Workspace is missing the Personal App compatibility report");
    assert(!fs.existsSync(path.join(workspaceRoot, "workspace")), "Workspace must not be nested inside itself");
    const repeated = spawnSync(process.execPath, [at(manifest.entrypoints.node), "prepare"], { env, encoding: "utf8", timeout: 60_000 });
    assert(repeated.status === 0, "Release preparation is not idempotent");
    return { homeRoot: "<temporary>/.personal-agent", core: "core", workspace: "workspace", idempotent: true, workspacePreserved: true };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function verifyApplication() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-app-verify-"));
  const controlPort = await availablePort();
  const appPort = await availablePort();
  const env = { ...process.env, PRIVATE_SITE_DATA_ROOT: path.join(root, "workspace"), PERSONAL_AGENT_CONTROL_PORT: String(controlPort) };
  const control = spawn(process.execPath, [at(manifest.entrypoints.control)], { cwd: path.dirname(at(manifest.entrypoints.control)), env, stdio: "ignore" });
  const app = spawn(process.execPath, [at(manifest.entrypoints.app)], { cwd: path.dirname(at(manifest.entrypoints.app)), env: { ...env, HOSTNAME: "127.0.0.1", PORT: String(appPort), PERSONAL_AGENT_CONTROL_URL: `http://127.0.0.1:${controlPort}` }, stdio: "ignore" });
  try {
    await waitForHttp(`http://127.0.0.1:${controlPort}/healthz`);
    await waitForHttp(`http://127.0.0.1:${appPort}/healthz`);
    const health = await (await fetch(`http://127.0.0.1:${appPort}/healthz`)).json();
    assert(health.architecture === "core-workspace", "Next health contract is invalid");
    const setup = await fetch(`http://127.0.0.1:${appPort}/api/system/setup`);
    assert(setup.status === 200, `Next BFF setup route failed: ${setup.status}`);
    const setupBody = await setup.json();
    assert(setupBody.schemaVersion === 1 && Array.isArray(setupBody.checks), "Next BFF returned an invalid setup contract");
    const page = await (await fetch(`http://127.0.0.1:${appPort}/app/setup`)).text();
    assert(page.includes("初始化向导") && page.includes("把 PA 准备好"), "Next Setup Center did not render");
    return { framework: "nextjs", standalone: true, health: true, bff: true, setupCenter: true };
  } finally {
    control.kill("SIGTERM");
    app.kill("SIGTERM");
    await Promise.all([waitForExit(control), waitForExit(app)]);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

async function waitForHttp(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => { child.once("exit", resolve); setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 3000).unref(); });
}

function safeRelative(value) { return value && !path.isAbsolute(value) && !value.split(/[\\/]/).some((part) => !part || part === "." || part === ".."); }
function at(relative) { return path.join(releaseRoot, ...relative.split("/")); }
function readJson(relative) { return JSON.parse(fs.readFileSync(at(relative), "utf8")); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function listFiles(directory) { const files = []; const walk = (current) => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const target = path.join(current, entry.name); if (entry.isDirectory()) walk(target); else if (entry.isFile()) files.push(target); } }; walk(directory); return files.sort(); }
function assert(condition, message) { if (!condition) throw new Error(message); }
