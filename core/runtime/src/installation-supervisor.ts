import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { initializeSite, workspaceRoot, writeJsonAtomic } from "./config.ts";
import {
  initializeInstallation,
  installationPaths,
  listSpaces,
  updateSpaceRuntimeState,
  type SpaceRecord,
} from "./space-registry.ts";

type ChildEntry = {
  child: ReturnType<typeof spawn>;
  output: number;
  generation: number;
  logPath: string;
};

export function resolveSpaceInitializationDomain(space: SpaceRecord) {
  try {
    const site = JSON.parse(fs.readFileSync(path.join(space.root, "config", "site.json"), "utf8"));
    const initializedHost = String(site?.asciiDomain || site?.displayDomain || "").trim();
    if (initializedHost) return initializedHost;
  } catch {}
  const managedHost = String(space.managedHost || "").trim();
  if (managedHost) return managedHost;
  return "personal-agent.local";
}

export async function runInstallationSupervisor({
  dataRoot,
  logger = console,
  parentPid = 0,
  entrypoint = fileURLToPath(new URL("../bin/private-site.mjs", import.meta.url)),
  reconcileIntervalMs = 1_000,
} = {}) {
  const requestedRoot = String(dataRoot || "").trim();
  if (!requestedRoot) throw new Error("安装级 Supervisor 需要数据根目录");
  const resolvedRoot = path.resolve(requestedRoot);
  const { installation, paths } = initializeInstallation({ dataRoot: resolvedRoot });
  const children = new Map<string, ChildEntry>();
  const ownerPid = Number(parentPid || 0);
  if (parentPid && (!Number.isInteger(ownerPid) || ownerPid <= 0 || ownerPid === process.pid)) throw new Error("Invalid desktop parent PID");
  let stopping = false;
  let reconciling = false;

  const writeStatus = (status: string) => writeJsonAtomic(path.join(paths.runtimeRoot, "supervisor.json"), {
    pid: process.pid,
    status,
    installationId: installation.installationId,
    dataRoot: resolvedRoot,
    releaseRoot: workspaceRoot,
    updatedAt: new Date().toISOString(),
    spaces: Object.fromEntries([...children.entries()].map(([spaceId, entry]) => [spaceId, {
      pid: entry.child.pid,
      generation: entry.generation,
      logPath: entry.logPath,
    }])),
  });

  const stopChild = async (spaceId: string, entry: ChildEntry) => {
    if (!entry.child.killed) {
      try { entry.child.kill("SIGTERM"); } catch {}
    }
    await waitForExit(entry.child, 5_000);
    if (entry.child.exitCode === null) {
      try { entry.child.kill("SIGKILL"); } catch {}
    }
    try { fs.closeSync(entry.output); } catch {}
    children.delete(spaceId);
    updateSpaceRuntimeState(resolvedRoot, spaceId, "stopped");
  };

  const startChild = (space: SpaceRecord) => {
    const domain = resolveSpaceInitializationDomain(space);
    initializeSite({ domain, dataRoot: resolvedRoot, spaceId: space.id });
    const logPath = path.join(paths.installationRoot, "logs", `${space.id}.log`);
    const output = fs.openSync(logPath, "a");
    const child = spawn(process.execPath, [entrypoint, "start-space", "--space-id", space.id, "--data-root", resolvedRoot, "--parent-pid", String(process.pid)], {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ["ignore", output, output],
      env: {
        ...process.env,
        PERSONAL_AGENT_DATA_ROOT: resolvedRoot,
        PERSONAL_AGENT_SPACE_ID: space.id,
        PERSONAL_AGENT_SPACE_ROOT: space.root,
        PRIVATE_SITE_DATA_ROOT: space.root,
      },
    });
    const entry = { child, output, generation: space.runtimeGeneration, logPath };
    children.set(space.id, entry);
    logger.log(`[personal-agent] 隔离空间 ${space.slug} 正在启动 pid=${child.pid}`);
    child.once("exit", (code, signal) => {
      try { fs.closeSync(output); } catch {}
      const current = children.get(space.id);
      if (current?.child === child) children.delete(space.id);
      if (!stopping) {
        const latest = listSpaces(resolvedRoot).find((candidate) => candidate.id === space.id);
        updateSpaceRuntimeState(resolvedRoot, space.id, latest?.desiredState === "running" ? "degraded" : "stopped");
        logger.error(`[personal-agent] 隔离空间 ${space.slug} 已退出 code=${code ?? ""} signal=${signal ?? ""}`);
      }
      writeStatus(stopping ? "stopping" : "running");
    });
  };

  const reconcile = async () => {
    if (stopping || reconciling) return;
    reconciling = true;
    try {
      const spaces = listSpaces(resolvedRoot);
      for (const space of spaces) {
        const running = children.get(space.id);
        if (space.desiredState === "stopped" && running) await stopChild(space.id, running);
        else if (space.desiredState === "running" && running && running.generation !== space.runtimeGeneration) {
          await stopChild(space.id, running);
          startChild(space);
        } else if (space.desiredState === "running" && !running) startChild(space);
      }
      writeStatus("running");
    } finally {
      reconciling = false;
    }
  };

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(reconcileTimer);
    if (parentTimer) clearInterval(parentTimer);
    writeStatus("stopping");
    for (const [spaceId, entry] of [...children.entries()]) await stopChild(spaceId, entry);
    writeStatus("stopped");
    process.exit(0);
  };

  writeStatus("starting");
  await reconcile();
  const reconcileTimer = setInterval(() => void reconcile().catch((error) => logger.error(`[personal-agent] 隔离空间调度失败: ${error.message}`)), reconcileIntervalMs);
  const parentTimer = ownerPid > 0 ? setInterval(() => {
    if (!processAlive(ownerPid)) void stop();
  }, 250) : null;
  parentTimer?.unref?.();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
}

function processAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
