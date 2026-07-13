#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureNodeDirectories, gatewayUsesTls, initializeSite, mergeSecretEnv, readEnvFile, resolveNodeConfig, workspaceRoot, writeJsonAtomic } from "../src/config.mjs";
import { runSupervisor } from "../src/supervisor.mjs";
import { initializeOriginIdentity, initializeWireGuard, installOriginIdentity } from "../src/identity.mjs";
import { preparePlatformService } from "../src/platform-service.mjs";
import { installExtension, listExtensions, removeExtension } from "../src/extensions.mjs";
import { readBackupState, runScheduledBackup } from "../src/backup-scheduler.mjs";
import { bridgeCliStatus, prepareBridgeCliShims } from "../src/cli-shims.mjs";
import { ensureWorkspaceFiles } from "../src/workspace-files.mjs";
import { providerCatalog, providerStatus, setProvider } from "../src/providers.mjs";
import { startOnboardingServer } from "../src/onboarding-server.mjs";

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || "status";
if (args.dataRoot) process.env.PRIVATE_SITE_DATA_ROOT = path.resolve(args.dataRoot);

if (command === "init") await initCommand();
else if (command === "prepare") await prepareCommand();
else if (command === "start") await runSupervisor({ config: resolveNodeConfig() });
else if (command === "daemon-start") await daemonStartCommand();
else if (command === "stop") await stopCommand();
else if (command === "status") await statusCommand();
else if (command === "verify") await verifyCommand();
else if (command === "import-legacy-env") await importLegacyEnvCommand();
else if (command === "import-legacy-data") await importLegacyDataCommand();
else if (command === "mode") await modeCommand();
else if (command === "identity-init") await identityInitCommand();
else if (command === "identity-install") await identityInstallCommand();
else if (command === "wireguard-init") await wireGuardInitCommand();
else if (command === "service-prepare") await servicePrepareCommand();
else if (command === "extension") await extensionCommand();
else if (command === "provider") await providerCommand();
else if (command === "onboarding") await onboardingCommand();
else if (command === "backup") await backupCommand();
else if (command === "restore-verify") await restoreVerifyCommand();
else if (command === "restore-apply") await restoreApplyCommand();
else if (["help", "--help", "-h"].includes(command)) printHelp();
else throw new Error(`Unknown private-site command: ${command}`);

async function initCommand() {
  const { config, created } = initializeSite({ domain: args.domain, dataRoot: args.dataRoot, edgeMode: args.edgeMode || "local-only" });
  process.stdout.write(`${JSON.stringify({ ok: true, created, dataRoot: config.dataRoot, configPath: config.configPath, envPath: config.envPath, site: config.site }, null, 2)}\n`);
}

async function prepareCommand() {
  const config = resolveNodeConfig();
  ensureNodeDirectories(config);
  const workspaceFiles = ensureWorkspaceFiles(config);
  seedAgentWorkspace(config);
  const bridgeRoot = path.join(workspaceRoot, "projects", "core", "open-agent-bridge");
  const toolsRoot = path.join(workspaceRoot, "projects", "personal", "lmt_tools");
  const bundledBridge = fs.existsSync(path.join(bridgeRoot, "app", "server.mjs"));
  const bundledWorker = fs.existsSync(path.join(bridgeRoot, "app", "worker.mjs"));
  const bundledTools = fs.existsSync(path.join(toolsRoot, "server.js"));
  if (!fs.existsSync(path.join(workspaceRoot, "release-manifest.json")) || !bundledBridge || !bundledWorker) {
    throw new Error("private-site prepare must run from a verified packaged release");
  }
  if (fs.existsSync(toolsRoot) && !bundledTools) throw new Error("The owner profile is missing its packaged lmt_tools standalone runtime");
  const xiaohongshuTarget = path.join(config.dataRoot, "runtime", "xiaohongshu", "xiaohongshu-mcp.exe");
  if (process.platform === "win32" && config.env.PRIVATE_SITE_BUILD_XIAOHONGSHU === "1" && !fs.existsSync(xiaohongshuTarget)) {
    const { buildLocalXiaohongshuAdapter } = await import("../../../../scripts/build-channel-runtimes.mjs");
    await buildLocalXiaohongshuAdapter({ outputRoot: path.dirname(xiaohongshuTarget) });
  }
  seedPublications(config);
  const bridgeCli = prepareBridgeCliShims(config);
  const databasePath = path.join(config.dataRoot, "databases", "tools", "lmt-tools.sqlite");
  const migrationPath = path.join(toolsRoot, "prisma", "migrations", "0001_initial", "migration.sql");
  if (fs.existsSync(migrationPath)) run(process.execPath, [path.join(workspaceRoot, "scripts", "init-lmt-tools-database.mjs"), databasePath, migrationPath], workspaceRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, prepared: true, dataRoot: config.dataRoot, databasePath, bridgeCli, workspaceFiles }, null, 2)}\n`);
}

function seedPublications(config) {
  const seeds = [
    [path.join(workspaceRoot, "projects", "core", "site-web", "html", "blog"), path.join(config.dataRoot, "publications", "blog")],
    [path.join(workspaceRoot, "projects", "core", "site-web", "html", "docs"), path.join(config.dataRoot, "publications", "docs")],
    [path.join(workspaceRoot, "projects", "core", "site-web", "html", "resources"), path.join(config.dataRoot, "publications", "resources")],
  ];
  for (const [source, target] of seeds) {
    if (!fs.existsSync(source) || directoryHasEntries(target)) continue;
    fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
  }
  writeDefaultPublication(path.join(config.dataRoot, "publications", "blog", "index.html"), defaultHomeHtml(config.domain));
  writeDefaultPublication(path.join(config.dataRoot, "publications", "docs", "index.html"), defaultTextPage("Documentation", "Personal Agent Node documentation is installed with this release."));
  writeDefaultPublication(path.join(config.dataRoot, "publications", "resources", "index.html"), defaultTextPage("Resources", "No public resources have been published yet."));
  for (const entry of config.distribution.domain.legacyHosts) {
    const source = path.resolve(workspaceRoot, entry.source);
    const target = path.join(config.dataRoot, "publications", "legacy", path.basename(entry.source));
    if (!fs.existsSync(source) || directoryHasEntries(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
  }
}

function writeDefaultPublication(target, content) {
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode: 0o600 });
}

function defaultHomeHtml(domain) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Personal Agent</title><style>*{box-sizing:border-box;letter-spacing:0}body{margin:0;background:#f3f5f2;color:#17201c;font-family:"Avenir Next","PingFang SC",sans-serif}main{width:min(760px,calc(100% - 32px));margin:0 auto;padding:64px 0}header{border-bottom:1px solid #b9c2bc;padding-bottom:24px}h1{margin:0 0 8px;font-family:"Iowan Old Style","Songti SC",serif;font-size:40px;font-weight:600}p{margin:0;color:#5a665f;line-height:1.7}.routes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:1px solid #17201c;margin-top:36px}.routes a{min-height:84px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #cbd2cd;color:inherit;text-decoration:none}.routes a:nth-child(odd){padding-right:18px}.routes a:nth-child(even){border-left:1px solid #cbd2cd;padding-left:18px}.routes span{color:#18614c}@media(max-width:560px){main{padding-top:36px}.routes{grid-template-columns:1fr}.routes a:nth-child(n){border-left:0;padding:0}}</style></head><body><main><header><h1>Personal Agent</h1><p>${escapeHtml(domain)} · local-first private assistant</p></header><nav class="routes"><a href="/admin"><strong>管理</strong><span>Admin</span></a><a href="/agent"><strong>Agent</strong><span>Sessions</span></a><a href="/mail"><strong>邮件</strong><span>Mail</span></a><a href="/files"><strong>文件</strong><span>Files</span></a><a href="/pages"><strong>页面</strong><span>Pages</span></a><a href="/docs"><strong>文档</strong><span>Docs</span></a></nav></main></body></html>`;
}

function defaultTextPage(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box;letter-spacing:0}body{margin:0;background:#f5f6f4;color:#1c221f;font-family:"Avenir Next",sans-serif}main{width:min(680px,calc(100% - 32px));margin:12vh auto}a{color:#17634c}h1{font-family:"Iowan Old Style",serif;font-size:36px}</style></head><body><main><a href="/">Personal Agent</a><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function seedAgentWorkspace(config) {
  const nodeGuide = fs.existsSync(path.join(workspaceRoot, "infra", "node", "AGENTS.md"))
    ? path.join(workspaceRoot, "infra", "node", "AGENTS.md")
    : path.join(workspaceRoot, "AGENTS.md");
  copyMissing(nodeGuide, path.join(config.agentWorkspaceRoot, "AGENTS.md"));
  copyMissing(path.join(config.agentWorkspaceRoot, "AGENTS.md"), path.join(config.agentWorkspaceRoot, "CLAUDE.md"));
  for (const directory of ["skills", "workflows", "registry"]) {
    copyMissing(path.join(workspaceRoot, directory), path.join(config.agentWorkspaceRoot, directory));
  }
  for (const script of ["skill-tree.mjs", "skill-guard.mjs"]) {
    copyMissing(path.join(workspaceRoot, "scripts", script), path.join(config.agentWorkspaceRoot, "scripts", script));
  }
  createDirectoryPointer(config.extensionsDir, path.join(config.agentWorkspaceRoot, "extensions"));
  for (const bridge of [".agents", ".codex", ".claude", ".cursor"]) {
    createDirectoryPointer(path.join(config.agentWorkspaceRoot, "skills"), path.join(config.agentWorkspaceRoot, bridge, "skills"));
  }
}

function copyMissing(source, target) {
  if (fs.existsSync(target) || !fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
}

function createDirectoryPointer(target, linkPath) {
  if (fs.existsSync(linkPath)) return;
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(process.platform === "win32" ? target : path.relative(path.dirname(linkPath), target), linkPath, process.platform === "win32" ? "junction" : "dir");
}

function directoryHasEntries(directory) {
  try { return fs.readdirSync(directory).length > 0; } catch { return false; }
}

async function daemonStartCommand() {
  const config = resolveNodeConfig();
  ensureNodeDirectories(config);
  const status = readSupervisor(config);
  if (status?.pid && processAlive(status.pid)) {
    process.stdout.write(`${JSON.stringify({ ok: true, alreadyRunning: true, pid: status.pid })}\n`);
    return;
  }
  const logPath = path.join(config.logsDir, "supervisor.log");
  const output = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "start"], {
    cwd: workspaceRoot,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", output, output],
    env: { ...process.env, PRIVATE_SITE_DATA_ROOT: config.dataRoot },
  });
  child.unref();
  writeJsonAtomic(path.join(config.runtimeDir, "supervisor.json"), { pid: child.pid, status: "launching", startedAt: new Date().toISOString() });
  process.stdout.write(`${JSON.stringify({ ok: true, pid: child.pid, logPath }, null, 2)}\n`);
}

async function stopCommand() {
  const config = resolveNodeConfig();
  const status = readSupervisor(config);
  if (!status?.pid || !processAlive(status.pid)) {
    process.stdout.write(`${JSON.stringify({ ok: true, stopped: true, detail: "already stopped" })}\n`);
    return;
  }
  if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(status.pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(status.pid, "SIGTERM");
  writeJsonAtomic(path.join(config.runtimeDir, "supervisor.json"), { pid: status.pid, status: "stopped", stoppedAt: new Date().toISOString() });
  process.stdout.write(`${JSON.stringify({ ok: true, stopped: true, pid: status.pid })}\n`);
}

async function statusCommand() {
  const config = resolveNodeConfig();
  const supervisor = readSupervisor(config);
  const services = {};
  for (const service of config.distribution.services) {
    const host = service.name === "private-site-gateway" ? config.gateway.host : "127.0.0.1";
    services[service.name] = service.port ? await probePort(host, service.name === "private-site-gateway" ? config.gateway.port : service.port) : { state: supervisor?.components?.[service.name] ? "running" : "unknown" };
  }
  const result = { ok: true, site: config.site, dataRoot: config.dataRoot, agentWorkspaceRoot: config.agentWorkspaceRoot, extensions: listExtensions(config), supervisor: supervisor ? { ...supervisor, alive: processAlive(supervisor.pid) } : null, backup: readBackupState(config), bridgeCli: bridgeCliStatus(config), services };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function verifyCommand() {
  const config = resolveNodeConfig();
  const checks = [];
  checks.push(await httpCheck(config, config.domain, "/__private-site/health", [200]));
  for (const entry of config.distribution.domain.standardHosts) {
    const host = entry.prefix ? `${entry.prefix}.${config.domain}` : config.domain;
    const expected = entry.access === "private" ? [200, 302] : [200];
    const probePath = entry.key === "pages" ? "/health"
      : entry.key === "resources" ? "/README.md"
        : entry.key === "docs" ? "/interview.html"
          : "/";
    checks.push(await httpCheck(config, host, probePath, expected));
  }
  const ok = checks.every((check) => check.ok);
  process.stdout.write(`${JSON.stringify({ ok, generatedAt: new Date().toISOString(), checks }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}

async function importLegacyEnvCommand() {
  if (!args.sourceDir) throw new Error("import-legacy-env requires --source-dir");
  const sourceDir = path.resolve(String(args.sourceDir));
  if (!fs.statSync(sourceDir).isDirectory()) throw new Error("Legacy environment source is not a directory");
  const allowlist = [
    "PERSONAL_AGENT_AUTH_PASSWORD",
    "PERSONAL_AGENT_AUTH_COOKIE_SECRET",
    "PERSONAL_AGENT_AUTH_COOKIE_NAME",
    "PERSONAL_AGENT_AUTH_TTL_SECONDS",
    "OPEN_AGENT_BRIDGE_UPLOAD_TOKEN",
    "OPEN_AGENT_BRIDGE_API_TOKEN",
    "OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN",
    "OPEN_AGENT_BRIDGE_SCHEDULER_TIMEZONE",
    "OPEN_AGENT_BRIDGE_PROGRESS_INTERVAL_MS",
    "OPEN_AGENT_BRIDGE_ATTACHMENT_BATCH_QUIET_MS",
    "OPEN_AGENT_BRIDGE_ATTACHMENT_BATCH_MAX_WAIT_MS",
    "OPEN_AGENT_BRIDGE_HISTORY_RETENTION_DAYS",
    "OPEN_AGENT_BRIDGE_HISTORY_CLEANUP_INTERVAL_MS",
    "OPEN_AGENT_BRIDGE_MANAGED_FILE_RETENTION_DAYS",
    "OPEN_AGENT_BRIDGE_MATERIALIZED_FILE_TTL_DAYS",
    "SESSION_SECRET",
  ];
  const imported = {};
  for (const fileName of ["open-agent-bridge.env", "nginx-personal-auth.env", "lmt-tools.env"]) {
    const filePath = path.join(sourceDir, fileName);
    if (fs.existsSync(filePath)) Object.assign(imported, readEnvFile(filePath));
  }
  const config = resolveNodeConfig();
  mergeSecretEnv(config.envPath, imported, allowlist);
  fs.rmSync(sourceDir, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    importedKeys: allowlist.filter((key) => String(imported[key] || "").trim()).sort(),
    envPath: config.envPath,
  }, null, 2)}\n`);
}

async function importLegacyDataCommand() {
  if (!args.sourceDir) throw new Error("import-legacy-data requires --source-dir");
  const config = resolveNodeConfig();
  assertSupervisorStopped(config);
  const { importLegacyData } = await import("../src/migration.mjs");
  const result = importLegacyData({ config, sourceDir: args.sourceDir, phase: args.phase || "preflight" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function modeCommand() {
  const mode = args._[1];
  if (!["preflight", "active"].includes(mode)) throw new Error("mode must be preflight or active");
  const config = resolveNodeConfig();
  assertSupervisorStopped(config);
  mergeSecretEnv(config.envPath, {
    OPEN_AGENT_BRIDGE_CHANNEL_POLL: mode === "active" ? "1" : "0",
    OPEN_AGENT_BRIDGE_SCHEDULER: mode === "active" ? "1" : "0",
    PRIVATE_SITE_XIAOHONGSHU_ENABLED: mode === "active" && config.env.PRIVATE_SITE_XIAOHONGSHU_APPROVED === "1" ? "1" : "0",
  }, ["OPEN_AGENT_BRIDGE_CHANNEL_POLL", "OPEN_AGENT_BRIDGE_SCHEDULER", "PRIVATE_SITE_XIAOHONGSHU_ENABLED"]);
  process.stdout.write(`${JSON.stringify({ ok: true, mode, channelPoll: mode === "active", scheduler: mode === "active" }, null, 2)}\n`);
}

async function providerCommand() {
  const action = args._[1] || "status";
  if (action === "list") {
    process.stdout.write(`${JSON.stringify({ ok: true, providers: providerCatalog }, null, 2)}\n`);
    return;
  }
  const config = resolveNodeConfig();
  if (action === "status") {
    process.stdout.write(`${JSON.stringify({ ok: true, providers: providerStatus(config) }, null, 2)}\n`);
    return;
  }
  if (action === "set") {
    const providers = setProvider(config, {
      kind: args.kind,
      provider: args.provider,
      endpoint: args.endpoint || "",
      credentialEnv: args.credentialEnv || "",
    });
    process.stdout.write(`${JSON.stringify({ ok: true, providers }, null, 2)}\n`);
    return;
  }
  throw new Error("provider action must be list, status, or set");
}

async function onboardingCommand() {
  const port = Number(args.port || process.env.PERSONAL_AGENT_ONBOARDING_PORT || 8842);
  const cloudUrl = args.cloudUrl || process.env.PERSONAL_AGENT_CLOUD_URL || "https://personal-agent.cn";
  const onboarding = await startOnboardingServer({
    host: "127.0.0.1",
    port,
    cloudUrl,
    dataRoot: args.dataRoot,
    onEnrolled: async () => {
      await prepareCommand();
      await daemonStartCommand();
    },
  });
  process.stdout.write(`${JSON.stringify({ ok: true, onboardingUrl: onboarding.url, cloudUrl }, null, 2)}\n`);
}

async function identityInitCommand() {
  const config = resolveNodeConfig();
  assertSupervisorStopped(config);
  process.stdout.write(`${JSON.stringify(initializeOriginIdentity(config, { address: args.address || "10.77.0.2" }), null, 2)}\n`);
}

async function identityInstallCommand() {
  for (const name of ["certificate", "ca", "edgeClientCertificate"]) {
    if (!args[name]) throw new Error(`identity-install requires --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  const config = resolveNodeConfig();
  assertSupervisorStopped(config);
  const result = installOriginIdentity(config, {
    certificatePath: path.resolve(args.certificate),
    caPath: path.resolve(args.ca),
    edgeClientCertificatePath: path.resolve(args.edgeClientCertificate),
    address: args.address || "10.77.0.2",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function wireGuardInitCommand() {
  if (!args.edgePublicKey || !args.endpoint) throw new Error("wireguard-init requires --edge-public-key and --endpoint");
  const config = resolveNodeConfig();
  assertSupervisorStopped(config);
  const result = initializeWireGuard(config, {
    edgePublicKey: args.edgePublicKey,
    endpoint: args.endpoint,
    address: args.address || "10.77.0.2/32",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function servicePrepareCommand() {
  const config = resolveNodeConfig();
  assertSupervisorStopped(config);
  const result = preparePlatformService(config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function extensionCommand() {
  const action = args._[1] || "list";
  const config = resolveNodeConfig();
  if (action === "list") {
    process.stdout.write(`${JSON.stringify({ ok: true, extensions: listExtensions(config) }, null, 2)}\n`);
    return;
  }
  assertSupervisorStopped(config);
  if (action === "install") {
    if (!args.source) throw new Error("extension install requires --source");
    process.stdout.write(`${JSON.stringify({ ok: true, extension: installExtension(config, args.source) }, null, 2)}\n`);
    return;
  }
  if (action === "remove") {
    if (!args.id) throw new Error("extension remove requires --id");
    process.stdout.write(`${JSON.stringify(removeExtension(config, args.id), null, 2)}\n`);
    return;
  }
  throw new Error("extension action must be list, install, or remove");
}

async function backupCommand() {
  const config = resolveNodeConfig();
  if (args.scheduled === true) {
    const result = await runScheduledBackup(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const { createEncryptedBackup } = await import("../src/backup.mjs");
  const supervisor = readSupervisor(config);
  const online = Boolean(supervisor?.pid && processAlive(supervisor.pid));
  const result = await createEncryptedBackup(config, {
    outputPath: args.output,
    keyFile: args.keyFile,
    fullRecovery: args.fullRecovery === true,
    online,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function restoreVerifyCommand() {
  if (!args.archive || !args.keyFile) throw new Error("restore-verify requires --archive and --key-file");
  const config = resolveNodeConfig();
  const { verifyEncryptedBackup } = await import("../src/backup.mjs");
  const result = await verifyEncryptedBackup(config, {
    archivePath: args.archive,
    keyFile: args.keyFile,
    targetDir: args.target,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function restoreApplyCommand() {
  if (!args.archive || !args.keyFile || !args.target) throw new Error("restore-apply requires --archive, --key-file, and --target");
  const config = resolveNodeConfig();
  const target = path.resolve(args.target);
  if (target === config.dataRoot) throw new Error("restore-apply cannot overwrite the active Site data root");
  const packageMetadata = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "projects", "core", "node", "package.json"), "utf8"));
  const { restoreEncryptedBackup } = await import("../src/backup.mjs");
  const result = await restoreEncryptedBackup({
    archivePath: args.archive,
    keyFile: args.keyFile,
    targetDataRoot: target,
    replacement: args.replacement === true,
    expectedDistributionVersion: packageMetadata.version,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function assertSupervisorStopped(config) {
  const supervisor = readSupervisor(config);
  if (process.platform === "win32" && !windowsRuntimePortsOpen(config)) return;
  if (supervisor?.pid && processAlive(supervisor.pid)) throw new Error("Stop the private Site supervisor before changing migration state");
}

function windowsRuntimePortsOpen(config) {
  const result = spawnSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("Unable to verify Windows Site runtime ports");
  const ports = new Set([config.ports.bridge, config.ports.admin, config.ports.tools, config.ports.xiaohongshu, config.gateway.port]);
  return String(result.stdout || "").split(/\r?\n/).some((line) => {
    if (!/\bLISTENING\b/.test(line)) return false;
    const match = /^\s*TCP\s+\S+:(\d+)\s+/.exec(line);
    return match && ports.has(Number(match[1]));
  });
}

function httpCheck(config, host, requestPath, expected) {
  return new Promise((resolve) => {
    const tls = gatewayUsesTls(config);
    const transport = tls ? https : http;
    const request = transport.request({
      host: tls ? host : config.gateway.host,
      port: tls ? 443 : config.gateway.port,
      path: requestPath,
      method: "HEAD",
      headers: { Host: host },
      timeout: 10_000,
    }, (response) => {
      response.resume();
      resolve({ name: `${host}${requestPath}`, ok: expected.includes(response.statusCode), status: response.statusCode, expected });
    });
    request.on("timeout", () => { request.destroy(); resolve({ name: `${host}${requestPath}`, ok: false, error: "timeout" }); });
    request.on("error", (error) => resolve({ name: `${host}${requestPath}`, ok: false, error: error.message }));
    request.end();
  });
}

function probePort(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); finish({ state: "running", port }); });
    socket.once("timeout", () => { socket.destroy(); finish({ state: "stopped", port }); });
    socket.once("error", () => finish({ state: "stopped", port }));
  });
}

function readSupervisor(config) {
  const filePath = path.join(config.runtimeDir, "supervisor.json");
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    // EPERM still proves that the process exists when another security context owns it.
    return error?.code === "EPERM";
  }
}

function run(commandName, commandArgs, cwd) {
  const command = process.platform === "win32" && commandName === "npm" ? "npm.cmd" : commandName;
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8", env: process.env, windowsHide: true });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(0, 500);
    throw new Error(`${commandName} ${commandArgs.join(" ")} failed with ${result.status}${detail ? `: ${detail}` : ""}`);
  }
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) parsed._.push(arg);
    else if (arg === "--json") parsed.json = true;
    else {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      parsed[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    }
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage:\n  private-site <command> [--data-root <path>]\n  private-site init --domain <apex> [--data-root <path>]\n  private-site prepare\n  private-site start\n  private-site daemon-start\n  private-site onboarding [--port 8842] [--cloud-url https://personal-agent.cn]\n  private-site stop\n  private-site status --json\n  private-site verify --json\n  private-site import-legacy-env --source-dir <path>\n  private-site import-legacy-data --source-dir <path> --phase <preflight|final>\n  private-site mode <preflight|active>\n  private-site identity-init [--address 10.77.0.2]\n  private-site identity-install --certificate <file> --ca <file> --edge-client-certificate <file>\n  private-site wireguard-init --edge-public-key <key> --endpoint <host:port>\n  private-site service-prepare\n  private-site extension list\n  private-site extension install --source <directory>\n  private-site extension remove --id <extension-id>\n  private-site provider list\n  private-site provider status\n  private-site provider set --kind <tunnel|token> --provider <name> [--endpoint <url>] [--credential-env <ENV_NAME>]\n  private-site backup [--output <archive>] [--key-file <key>] [--full-recovery] [--scheduled]\n  private-site restore-verify --archive <archive> --key-file <key> [--target <directory>]\n  private-site restore-apply --archive <archive> --key-file <key> --target <empty-data-root> [--replacement]\n`);
}
