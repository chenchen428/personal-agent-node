import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildServiceEnvironment, ensureNodeDirectories, requireRuntimeSecrets, resolveNodeConfig, workspaceRoot, writeJsonAtomic, writeWorkerConfig } from "./config.ts";
import { extensionComponentSpecs } from "./extensions.ts";
import { startBackupScheduler } from "./backup-scheduler.ts";

export async function runSupervisor({ config = resolveNodeConfig(), logger = console, parentPid = 0 } = {}) {
  ensureNodeDirectories(config);
  requireRuntimeSecrets(config);
  const environment = { ...process.env, ...buildServiceEnvironment(config) };
  const workerConfig = writeWorkerConfig(config);
  const components = componentSpecs(config, workerConfig);
  const children = new Map();
  let stopping = false;
  let backupScheduler = null;
  let parentMonitor = null;
  const ownerPid = Number(parentPid || 0);
  if (parentPid && (!Number.isInteger(ownerPid) || ownerPid <= 0 || ownerPid === process.pid)) throw new Error("Invalid desktop parent PID");

  writeJsonAtomic(path.join(config.runtimeDir, "supervisor.json"), {
    pid: process.pid,
    status: "starting",
    siteId: config.site?.siteId || "",
    nodeId: config.site?.nodeId || "",
    startedAt: new Date().toISOString(),
  });

  const startComponent = async (spec) => {
    if (spec.waitFor) await waitForPort("127.0.0.1", spec.waitFor, 30_000);
    const logPath = path.join(config.logsDir, `${spec.name}.log`);
    const output = fs.openSync(logPath, "a");
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...environment, ...spec.env },
      windowsHide: true,
      shell: spec.shell === true,
      stdio: ["ignore", output, output],
    });
    children.set(spec.name, { child, spec, logPath, output });
    logger.log(`[private-site-node] ${spec.name} started pid=${child.pid}`);
    child.once("exit", (code, signal) => {
      try { fs.closeSync(output); } catch {}
      children.delete(spec.name);
      logger.error(`[private-site-node] ${spec.name} exited code=${code ?? ""} signal=${signal ?? ""}`);
      if (!stopping) setTimeout(() => startComponent(spec).catch((error) => logger.error(`[private-site-node] ${spec.name} restart failed: ${error.message}`)), 2000).unref?.();
    });
    if (spec.port && !await waitForPort(spec.host || "127.0.0.1", spec.port, 30_000)) throw new Error(`${spec.name} did not listen on ${spec.host || "127.0.0.1"}:${spec.port}; see ${logPath}`);
  };

  try {
    for (const spec of components) await startComponent(spec);
    backupScheduler = startBackupScheduler(config, { logger });
    writeJsonAtomic(path.join(config.runtimeDir, "supervisor.json"), {
      pid: process.pid,
      status: "running",
      siteId: config.site?.siteId || "",
      nodeId: config.site?.nodeId || "",
      startedAt: new Date().toISOString(),
      backupScheduler: { enabled: backupScheduler.enabled, intervalHours: backupScheduler.intervalHours, retentionCount: backupScheduler.retentionCount },
      components: Object.fromEntries([...children.entries()].map(([name, entry]) => [name, { pid: entry.child.pid, logPath: entry.logPath }])),
    });
  } catch (error) {
    stopping = true;
    if (parentMonitor) clearInterval(parentMonitor);
    await stopChildren(children);
    throw error;
  }

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    backupScheduler?.stop();
    logger.log("[private-site-node] stopping");
    await stopChildren(children);
    writeJsonAtomic(path.join(config.runtimeDir, "supervisor.json"), { pid: process.pid, status: "stopped", stoppedAt: new Date().toISOString() });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (ownerPid > 0) {
    parentMonitor = setInterval(() => {
      if (!processAlive(ownerPid)) void stop();
    }, 250);
    parentMonitor.unref?.();
  }
  await new Promise(() => {});
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function componentSpecs(config, workerConfig) {
  const node = process.execPath;
  const bridgeRoot = path.join(workspaceRoot, "core", "agent");
  const toolsRoot = path.join(workspaceRoot, "core", "tools");
  const bridgeServer = executable(node, path.join(bridgeRoot, "app", "server.mjs"), path.join(bridgeRoot, "src", "server", "server.ts"));
  const bridgeWorker = executable(node, path.join(bridgeRoot, "app", "worker.mjs"), path.join(bridgeRoot, "vendor", "agent-bridge", "lib", "_worker-entry.mjs"));
  const controlSocket = executable(node, path.join(workspaceRoot, "core", "runtime", "app", "control-service.mjs"), path.join(workspaceRoot, "core", "runtime", "src", "control-service.ts"));
  const controlApi = executable(node, path.join(workspaceRoot, "core", "control", "server.mjs"), path.join(workspaceRoot, "core", "control", "server.ts"));
  const gateway = executable(node, path.join(workspaceRoot, "core", "runtime", "app", "gateway.mjs"), path.join(workspaceRoot, "core", "runtime", "src", "gateway.ts"));
  const reverseTunnel = executable(node, path.join(workspaceRoot, "core", "runtime", "app", "reverse-tunnel.mjs"), path.join(workspaceRoot, "core", "runtime", "src", "reverse-tunnel-entry.ts"));
  const app = nextApplication(node, config);
  const toolsStandaloneRoot = toolsRoot;
  const components = [
    {
      name: "personal-agent-control",
      ...controlSocket,
      cwd: workspaceRoot,
      env: {},
    },
    {
      name: "open-agent-bridge",
      ...bridgeServer,
      cwd: bridgeRoot,
      port: config.ports.bridge,
      env: {},
    },
    {
      name: "open-agent-bridge-worker",
      ...bridgeWorker,
      args: [...bridgeWorker.args, "--config", workerConfig],
      cwd: bridgeRoot,
      waitFor: config.ports.bridge,
      env: {},
    },
    {
      name: "personal-agent-control-api",
      ...controlApi,
      cwd: path.join(workspaceRoot, "core", "control"),
      port: config.ports.control,
      waitFor: config.ports.bridge,
      env: { PERSONAL_AGENT_CONTROL_PORT: String(config.ports.control) },
    },
    {
      name: "personal-agent-app",
      ...app,
      cwd: app.cwd,
      port: config.ports.admin,
      waitFor: config.ports.control,
      env: {
        HOSTNAME: "127.0.0.1",
        PORT: String(config.ports.admin),
        PERSONAL_AGENT_CONTROL_URL: `http://127.0.0.1:${config.ports.control}`,
      },
    },
    {
      name: "private-site-gateway",
      ...gateway,
      cwd: workspaceRoot,
      port: config.gateway.port,
      host: config.gateway.host,
      waitFor: config.ports.admin,
      env: {},
    },
  ];
  components.push({
    name: "personal-agent-tunnel",
    ...reverseTunnel,
    cwd: workspaceRoot,
    waitFor: config.gateway.port,
    env: {},
  });
  if (fs.existsSync(path.join(toolsStandaloneRoot, "server.js"))) {
    components.splice(3, 0, {
      name: "lmt-tools",
      command: node,
      args: [path.join(toolsStandaloneRoot, "server.js")],
      cwd: toolsStandaloneRoot,
      port: config.ports.tools,
      env: { HOSTNAME: "127.0.0.1" },
    });
  }
  components.splice(components.length - 1, 0, ...extensionComponentSpecs(config));
  if (config.env.PRIVATE_SITE_XIAOHONGSHU_ENABLED === "1") {
    const channelRoot = path.join(config.dataRoot, "channels", "xiaohongshu");
    const executable = path.join(config.dataRoot, "runtime", "xiaohongshu", "xiaohongshu-mcp.exe");
    const browser = config.env.PRIVATE_SITE_BROWSER_BIN || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    for (const directory of ["home", "cache", "config", "tmp"]) fs.mkdirSync(path.join(channelRoot, directory), { recursive: true });
    components.splice(4, 0, {
      name: "xiaohongshu-channel",
      command: executable,
      args: ["-headless=true", "-bin", browser, "-port", `127.0.0.1:${config.ports.xiaohongshu}`],
      cwd: channelRoot,
      port: config.ports.xiaohongshu,
      env: {
        HOME: path.join(channelRoot, "home"),
        XDG_CACHE_HOME: path.join(channelRoot, "cache"),
        XDG_CONFIG_HOME: path.join(channelRoot, "config"),
        TMPDIR: path.join(channelRoot, "tmp"),
        COOKIES_PATH: path.join(channelRoot, "cookies.json"),
        ROD_BROWSER_BIN: browser,
      },
    });
  }
  return components;
}

function executable(node, compiled, source) {
  if (fs.existsSync(compiled)) return { command: node, args: [compiled] };
  if (fs.existsSync(source)) return { command: node, args: ["--import", "tsx", source] };
  throw new Error(`Runtime entrypoint is missing: ${compiled}`);
}

function nextApplication(node, config) {
  const packaged = path.join(workspaceRoot, "core", "app", "server.js");
  if (fs.existsSync(packaged)) return { command: node, args: [packaged], cwd: path.dirname(packaged) };
  const nextCli = path.join(workspaceRoot, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextCli)) throw new Error("Next.js runtime is missing");
  return { command: node, args: [nextCli, "start", "core/app", "--hostname", "127.0.0.1", "--port", String(config.ports.admin)], cwd: workspaceRoot };
}

async function stopChildren(children) {
  const entries = [...children.values()].reverse();
  for (const { child } of entries) {
    if (!child.killed) {
      try { child.kill("SIGTERM"); } catch {}
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const { child, output } of entries) {
    if (!child.killed) {
      try { child.kill("SIGKILL"); } catch {}
    }
    try { fs.closeSync(output); } catch {}
  }
  children.clear();
}

function waitForPort(host, port, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const attempt = () => {
      if (settled) return;
      const socket = net.createConnection({ host, port });
      socket.setTimeout(500);
      let attemptDone = false;
      socket.once("connect", () => {
        if (attemptDone) return;
        attemptDone = true;
        socket.destroy();
        finish(true);
      });
      const retry = () => {
        if (attemptDone || settled) return;
        attemptDone = true;
        socket.destroy();
        if (Date.now() - started >= timeoutMs) finish(false);
        else setTimeout(attempt, 200);
      };
      socket.once("timeout", retry);
      socket.once("error", retry);
    };
    attempt();
  });
}
