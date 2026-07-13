import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildServiceEnvironment, ensureNodeDirectories, requireRuntimeSecrets, resolveNodeConfig, workspaceRoot, writeJsonAtomic, writeWorkerConfig } from "./config.mjs";
import { extensionComponentSpecs } from "./extensions.mjs";
import { startBackupScheduler } from "./backup-scheduler.mjs";

export async function runSupervisor({ config = resolveNodeConfig(), logger = console } = {}) {
  ensureNodeDirectories(config);
  requireRuntimeSecrets(config);
  const environment = { ...process.env, ...buildServiceEnvironment(config) };
  const workerConfig = writeWorkerConfig(config);
  const components = componentSpecs(config, workerConfig);
  const children = new Map();
  let stopping = false;
  let backupScheduler = null;

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
  await new Promise(() => {});
}

export function componentSpecs(config, workerConfig) {
  const node = process.execPath;
  const bridgeRoot = path.join(workspaceRoot, "projects", "core", "open-agent-bridge");
  const toolsRoot = path.join(workspaceRoot, "projects", "personal", "lmt_tools");
  const bundledBridgeServer = path.join(bridgeRoot, "app", "server.mjs");
  const bundledBridgeWorker = path.join(bridgeRoot, "app", "worker.mjs");
  const toolsStandaloneRoot = toolsRoot;
  for (const entrypoint of [bundledBridgeServer, bundledBridgeWorker, path.join(workspaceRoot, "projects", "core", "admin-panel", "server.mjs")]) {
    if (!fs.existsSync(entrypoint)) throw new Error(`Packaged runtime entrypoint is missing: ${entrypoint}`);
  }
  const components = [
    {
      name: "open-agent-bridge",
      command: node,
      args: [bundledBridgeServer],
      cwd: bridgeRoot,
      port: config.ports.bridge,
      env: {},
    },
    {
      name: "open-agent-bridge-worker",
      command: node,
      args: [bundledBridgeWorker, "--config", workerConfig],
      cwd: bridgeRoot,
      waitFor: config.ports.bridge,
      env: {},
    },
    {
      name: "workspace-admin-panel",
      command: node,
      args: [path.join(workspaceRoot, "projects", "core", "admin-panel", "server.mjs")],
      cwd: path.join(workspaceRoot, "projects", "core", "admin-panel"),
      port: config.ports.admin,
      waitFor: config.ports.bridge,
      env: {},
    },
    {
      name: "private-site-gateway",
      command: node,
      args: [path.join(workspaceRoot, "projects", "core", "node", "src", "gateway.mjs")],
      cwd: workspaceRoot,
      port: config.gateway.port,
      host: config.gateway.host,
      waitFor: config.ports.bridge,
      env: {},
    },
  ];
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
