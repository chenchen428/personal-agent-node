import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const FORBIDDEN_SOURCE = [
  /\bimport\s*(?:\(|\{|'|"|[A-Za-z_$])/,
  /\brequire\s*\(/,
  /\bprocess\b/,
  /\bglobalThis\b/,
  /\b(?:eval|Function)\s*\(/,
  /\b(?:fetch|WebSocket|XMLHttpRequest)\b/,
  /\b(?:child_process|node:fs|node:net|node:http|node:https|node:dgram|node:tls)\b/,
];

export class TemplateRuntime {
  constructor({ dataDir, timeoutMs = 15_000, maxOutputBytes = 5 * 1024 * 1024, autoDisableAfter = 3 } = {}) {
    this.dataDir = path.resolve(dataDir || process.cwd());
    this.templatesDir = path.join(this.dataDir, "templates");
    this.workDir = path.join(this.dataDir, "work");
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.autoDisableAfter = Math.max(Number(autoDisableAfter) || 3, 1);
    this.runnerPath = fileURLToPath(new URL("./template-worker.mjs", import.meta.url));
    fs.mkdirSync(this.templatesDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.workDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.templatesDir, 0o700);
    fs.chmodSync(this.workDir, 0o700);
  }

  install({ id, name, purpose = "", sourceFingerprint = "", source, version } = {}) {
    const templateId = String(id || `tpl_${crypto.randomBytes(8).toString("hex")}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(templateId)) throw new Error("invalid template id");
    const code = String(source || "").trim();
    if (!code) throw new Error("template source is required");
    validateTemplateSource(code);
    const nextVersion = Math.max(Number(version || this.nextVersion(templateId)), 1);
    const versionDir = path.join(this.templatesDir, templateId, `v${nextVersion}`);
    if (fs.existsSync(versionDir)) throw new Error("template version already exists");
    fs.mkdirSync(versionDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(versionDir), 0o700);
    fs.chmodSync(versionDir, 0o700);
    const sourcePath = path.join(versionDir, "parse.mjs");
    fs.writeFileSync(sourcePath, `${code}\n`, { encoding: "utf8", mode: 0o600 });
    const sha256 = crypto.createHash("sha256").update(code).digest("hex");
    const manifest = {
      id: templateId,
      name: String(name || templateId),
      purpose: String(purpose),
      sourceFingerprint: String(sourceFingerprint),
      runtime: "javascript-esm",
      version: nextVersion,
      status: "active",
      sha256,
      sourcePath,
      installedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(versionDir, "template.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const state = this.writeState(templateId, {
      version: nextVersion,
      status: "active",
      consecutiveFailures: 0,
      successCount: 0,
      failureCount: 0,
      reason: "installed",
    });
    return { ...manifest, state };
  }

  async run(id, input, { version } = {}) {
    const manifest = this.get(id, version);
    const runId = `trun_${crypto.randomBytes(10).toString("hex")}`;
    const runDir = path.join(this.workDir, runId);
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
    const inputPath = path.join(runDir, "input.json");
    const outputPath = path.join(runDir, "output.json");
    fs.writeFileSync(inputPath, `${JSON.stringify(input ?? null)}\n`, { mode: 0o600 });
    const runnerPath = permissionPath(this.runnerPath);
    const sourcePath = permissionPath(manifest.sourcePath);
    const resolvedInputPath = permissionPath(inputPath);
    const resolvedOutputPath = permissionPath(outputPath);
    const readPermissions = [runnerPath, sourcePath, resolvedInputPath]
      .map((filePath) => `--allow-fs-read=${permissionPath(filePath)}`);
    const args = [
      "--experimental-permission",
      ...readPermissions,
      `--allow-fs-write=${resolvedOutputPath}`,
      runnerPath,
      sourcePath,
      resolvedInputPath,
      resolvedOutputPath,
    ];
    try {
      await execFilePromise(process.execPath, args, { timeout: this.timeoutMs, maxBuffer: 256 * 1024 });
      const stat = fs.statSync(outputPath);
      if (stat.size > this.maxOutputBytes) throw new Error("template output exceeds limit");
      const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      const state = this.recordOutcome(manifest.id, manifest.version, { succeeded: true });
      return { runId, templateId: manifest.id, version: manifest.version, output, state };
    } catch (error) {
      const state = this.recordOutcome(manifest.id, manifest.version, { succeeded: false, error });
      if (error && typeof error === "object") error.templateState = state;
      throw error;
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
    }
  }

  get(id, version) {
    const templateId = String(id || "");
    if (!/^[a-zA-Z0-9_-]+$/.test(templateId)) throw new Error("invalid template id");
    let selectedVersion = Number(version || 0);
    if (!selectedVersion) {
      const state = this.status(templateId);
      if (state.status !== "active") throw new Error(`template is ${state.status}: ${state.reason || "disabled"}`);
      selectedVersion = Number(state.version || 0);
    }
    const manifestPath = path.join(this.templatesDir, templateId, `v${selectedVersion}`, "template.json");
    if (!fs.existsSync(manifestPath)) throw new Error("template version not found");
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  }

  nextVersion(id) {
    const templateId = normalizeTemplateId(id);
    const directory = path.join(this.templatesDir, templateId);
    if (!fs.existsSync(directory)) return 1;
    const versions = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
      .map((entry) => Number(entry.name.slice(1)));
    return versions.length ? Math.max(...versions) + 1 : 1;
  }

  status(id) {
    const templateId = normalizeTemplateId(id);
    const activePath = this.statePath(templateId);
    if (!fs.existsSync(activePath)) throw new Error("template not found");
    const state = JSON.parse(fs.readFileSync(activePath, "utf8"));
    return {
      version: Number(state.version || 0),
      status: state.status === "disabled" ? "disabled" : "active",
      consecutiveFailures: Number(state.consecutiveFailures || 0),
      successCount: Number(state.successCount || 0),
      failureCount: Number(state.failureCount || 0),
      reason: String(state.reason || ""),
      updatedAt: String(state.updatedAt || ""),
    };
  }

  activate(id, version, { reason = "activated" } = {}) {
    const templateId = normalizeTemplateId(id);
    const selectedVersion = Number(version || this.status(templateId).version);
    const manifest = this.get(templateId, selectedVersion);
    const current = safeStatus(this, templateId);
    const state = this.writeState(templateId, {
      version: manifest.version,
      status: "active",
      consecutiveFailures: 0,
      successCount: current?.successCount || 0,
      failureCount: current?.failureCount || 0,
      reason,
    });
    return { ...manifest, state };
  }

  rollback(id, version, { reason = "rollback" } = {}) {
    if (!Number.isInteger(Number(version)) || Number(version) < 1) throw new Error("rollback version is required");
    return this.activate(id, Number(version), { reason });
  }

  disable(id, { reason = "disabled by Agent" } = {}) {
    const templateId = normalizeTemplateId(id);
    const current = this.status(templateId);
    return this.writeState(templateId, { ...current, status: "disabled", reason });
  }

  recordOutcome(id, version, { succeeded, error } = {}) {
    const templateId = normalizeTemplateId(id);
    const current = safeStatus(this, templateId);
    if (!current || Number(current.version) !== Number(version)) return current;
    const consecutiveFailures = succeeded ? 0 : current.consecutiveFailures + 1;
    const disabled = !succeeded && consecutiveFailures >= this.autoDisableAfter;
    return this.writeState(templateId, {
      ...current,
      status: disabled ? "disabled" : current.status,
      consecutiveFailures,
      successCount: current.successCount + (succeeded ? 1 : 0),
      failureCount: current.failureCount + (succeeded ? 0 : 1),
      reason: disabled
        ? `auto-disabled after ${consecutiveFailures} consecutive failures: ${error instanceof Error ? error.message : String(error || "failure")}`.slice(0, 500)
        : succeeded ? "last run succeeded" : `last run failed: ${error instanceof Error ? error.message : String(error || "failure")}`.slice(0, 500),
    });
  }

  statePath(id) {
    return path.join(this.templatesDir, id, "active.json");
  }

  writeState(id, input) {
    const state = { ...input, updatedAt: new Date().toISOString() };
    const target = this.statePath(id);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
    return this.status(id);
  }
}

function permissionPath(value) {
  const target = path.resolve(value);
  if (fs.existsSync(target)) return fs.realpathSync(target);
  return path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
}

function normalizeTemplateId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("invalid template id");
  return id;
}

function safeStatus(runtime, id) {
  try { return runtime.status(id); }
  catch { return null; }
}

export function validateTemplateSource(source) {
  for (const pattern of FORBIDDEN_SOURCE) if (pattern.test(source)) throw new Error(`template source contains forbidden capability: ${pattern}`);
  if (!/export\s+default\s+(?:async\s+)?function\b/.test(source)) throw new Error("template must export a default function");
  return true;
}

function execFilePromise(executable, args, options) {
  return new Promise((resolve, reject) => execFile(executable, args, options, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(String(stderr || stdout || error.message).trim()));
      return;
    }
    resolve({ stdout, stderr });
  }));
}
