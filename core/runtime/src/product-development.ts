import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { workspaceRoot } from "./config.ts";
import { operationError } from "./operations.ts";

const WRITABLE_PERMISSIONS = new Set(["WRITE", "MAINTAIN", "ADMIN"]);

export function readProductDevelopmentContract(root = workspaceRoot) {
  const file = path.join(root, "registry", "product-development.json");
  let contract;
  try { contract = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw operationError("REGISTRY_UNAVAILABLE", "Product development registry is unavailable", 7); }
  if (contract?.schemaVersion !== 1
    || contract.mode !== "autonomous"
    || contract.visibility !== "private"
    || contract.confirmationPolicy !== "never"
    || contract.cloneFailurePolicy !== "stop"
    || contract.immutableRuntimePath !== "core/current"
    || !WRITABLE_PERMISSIONS.has(String(contract.requiredPermission || ""))
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(contract.repository || ""))
    || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(String(contract.url || ""))
    || contract.url.toLowerCase() !== `https://github.com/${contract.repository}.git`.toLowerCase()
    || contract.checkout?.relativePath !== "projects/personal-agent"
    || contract.checkout?.recurseSubmodules !== true) {
    throw operationError("REGISTRY_INVALID", "Product development registry is invalid", 7);
  }
  return contract;
}

export function productDevelopmentStatus({ config, contract = readProductDevelopmentContract(), run = spawnSync } = {}) {
  const checkoutPath = resolveCheckoutPath(config, contract);
  const tools = {
    git: probe(run, "git", ["--version"]),
    gh: probe(run, "gh", ["--version"]),
  };
  if (!tools.git) return publicStatus({ contract, checkoutPath, tools, ready: false, blocker: "GIT_UNAVAILABLE" });
  if (!tools.gh) return publicStatus({ contract, checkoutPath, tools, ready: false, blocker: "GH_UNAVAILABLE" });
  const auth = run("gh", ["auth", "status", "--hostname", "github.com"], commandOptions());
  if (auth.status !== 0) return publicStatus({ contract, checkoutPath, tools, authenticated: false, ready: false, blocker: "GITHUB_AUTH_REQUIRED" });
  const repository = inspectRepository(run, contract.repository);
  if (!repository.ok) return publicStatus({ contract, checkoutPath, tools, authenticated: true, ready: false, blocker: repository.blocker });
  const checkout = inspectCheckout(run, checkoutPath, contract.repository);
  return publicStatus({
    contract,
    checkoutPath,
    tools,
    authenticated: true,
    repository: repository.value,
    checkout,
    ready: repository.value.writable && checkout.valid,
    canEnsure: repository.value.writable && (!checkout.exists || checkout.valid),
    blocker: repository.value.writable ? checkout.exists && !checkout.valid ? "CHECKOUT_CONFLICT" : "" : "GITHUB_PERMISSION_REQUIRED",
  });
}

export function ensureProductDevelopment({ config, contract = readProductDevelopmentContract(), run = spawnSync, now = () => new Date() } = {}) {
  const status = productDevelopmentStatus({ config, contract, run });
  if (!status.tools.git) throw operationError("GIT_UNAVAILABLE", "Git is required for Personal Agent product development", 7);
  if (!status.tools.gh) throw operationError("GH_UNAVAILABLE", "GitHub CLI is required for Personal Agent product development", 7);
  if (!status.authenticated) throw operationError("GITHUB_AUTH_REQUIRED", "GitHub CLI is not authenticated", 5);
  if (!status.repository) throw operationError(status.blocker || "GITHUB_REPOSITORY_UNAVAILABLE", "The registered private Personal Agent repository is unavailable", 5);
  if (!status.repository?.writable) throw operationError("GITHUB_PERMISSION_REQUIRED", "The active GitHub account does not have write access to the private Personal Agent repository", 5);
  if (status.checkout.exists) {
    if (!status.checkout.valid) throw operationError("CHECKOUT_CONFLICT", "The configured product development path is not the registered Personal Agent repository", 4);
    requireCommand(run, "git", ["-C", status.checkoutPath, "submodule", "update", "--init", "--recursive"], "SUBMODULE_FAILED", "Personal Agent submodule initialization failed");
    verifySubmodules(run, status.checkoutPath);
    verifyCheckoutFiles(status.checkoutPath);
    const bridge = ensureCodexSkillBridge(status.checkoutPath);
    const result = { ...status, ready: true, reused: true, bridge, checkedOutAt: now().toISOString() };
    persistState(config, result);
    return result;
  }

  const parent = path.dirname(status.checkoutPath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(parent, `.personal-agent-clone-${process.pid}-${crypto.randomUUID()}`);
  assertTemporaryPath(parent, temporary);
  try {
    requireCommand(
      run,
      "gh",
      ["repo", "clone", contract.repository, temporary, "--", "--recurse-submodules"],
      "CLONE_FAILED",
      "Cloning the private Personal Agent repository failed",
    );
    const cloned = inspectCheckout(run, temporary, contract.repository);
    if (!cloned.valid) throw operationError("CLONE_FAILED", "The cloned repository origin does not match the registered Personal Agent repository", 7);
    verifySubmodules(run, temporary);
    verifyCheckoutFiles(temporary);
    if (fs.existsSync(status.checkoutPath)) throw operationError("CHECKOUT_CONFLICT", "The product development path was created concurrently", 4);
    fs.renameSync(temporary, status.checkoutPath);
    const bridge = ensureCodexSkillBridge(status.checkoutPath);
    const result = {
      ...status,
      checkout: inspectCheckout(run, status.checkoutPath, contract.repository),
      ready: true,
      reused: false,
      bridge,
      checkedOutAt: now().toISOString(),
    };
    persistState(config, result);
    return result;
  } catch (error) {
    if (isTemporaryChild(parent, temporary)) fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function inspectRepository(run, repository) {
  const result = run("gh", ["repo", "view", repository, "--json", "nameWithOwner,visibility,viewerPermission,url,defaultBranchRef"], commandOptions());
  if (result.status !== 0) return { ok: false, blocker: "GITHUB_REPOSITORY_UNAVAILABLE" };
  try {
    const value = JSON.parse(String(result.stdout || "{}"));
    if (String(value.nameWithOwner || "").toLowerCase() !== repository.toLowerCase() || value.visibility !== "PRIVATE") {
      return { ok: false, blocker: "GITHUB_REPOSITORY_INVALID" };
    }
    return {
      ok: true,
      value: {
        nameWithOwner: value.nameWithOwner,
        visibility: value.visibility,
        viewerPermission: value.viewerPermission || "",
        writable: WRITABLE_PERMISSIONS.has(value.viewerPermission),
        url: value.url || `https://github.com/${repository}`,
        defaultBranch: value.defaultBranchRef?.name || "main",
      },
    };
  } catch {
    return { ok: false, blocker: "GITHUB_REPOSITORY_INVALID" };
  }
}

function inspectCheckout(run, checkoutPath, repository) {
  if (!fs.existsSync(checkoutPath)) return { exists: false, valid: false, repository: "", dirty: false };
  if (!fs.statSync(checkoutPath).isDirectory()) return { exists: true, valid: false, repository: "", dirty: false };
  const inside = run("git", ["-C", checkoutPath, "rev-parse", "--is-inside-work-tree"], commandOptions());
  const remote = run("git", ["-C", checkoutPath, "remote", "get-url", "origin"], commandOptions());
  const normalized = normalizeGitHubRepository(remote.status === 0 ? remote.stdout : "");
  const dirty = run("git", ["-C", checkoutPath, "status", "--porcelain"], commandOptions());
  return {
    exists: true,
    valid: inside.status === 0 && String(inside.stdout || "").trim() === "true" && normalized.toLowerCase() === repository.toLowerCase(),
    repository: normalized,
    dirty: dirty.status === 0 && Boolean(String(dirty.stdout || "").trim()),
  };
}

function resolveCheckoutPath(config, contract) {
  if (!config?.agentWorkspaceRoot || !path.isAbsolute(config.agentWorkspaceRoot)) {
    throw operationError("NOT_INITIALIZED", "Personal Agent product development requires an initialized Space workspace", 3);
  }
  const workspace = path.resolve(config.agentWorkspaceRoot);
  const checkout = path.resolve(workspace, ...String(contract.checkout.relativePath).split("/"));
  if (checkout === workspace || !checkout.startsWith(`${workspace}${path.sep}`)) {
    throw operationError("REGISTRY_INVALID", "Product development checkout escapes the Agent workspace", 7);
  }
  return checkout;
}

function verifyCheckoutFiles(checkoutPath) {
  for (const relative of ["AGENTS.md", "registry/projects.json", "projects/cloud", "projects/personal-agent-node"]) {
    if (!fs.existsSync(path.join(checkoutPath, ...relative.split("/")))) {
      throw operationError("CLONE_FAILED", `The Personal Agent checkout is incomplete: ${relative}`, 7);
    }
  }
}

function ensureCodexSkillBridge(checkoutPath) {
  const source = path.join(checkoutPath, "skills");
  if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) return { ready: false, reason: "skills-missing" };
  const directory = path.join(checkoutPath, ".codex");
  const target = path.join(directory, "skills");
  fs.mkdirSync(directory, { recursive: true });
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing) {
    let matches = false;
    try { matches = fs.realpathSync(target) === fs.realpathSync(source); } catch {}
    if (!matches) throw operationError("CHECKOUT_CONFLICT", "The product checkout .codex/skills path conflicts with the registered skills bridge", 4);
    return { ready: true, created: false };
  }
  fs.symlinkSync(process.platform === "win32" ? source : "../skills", target, process.platform === "win32" ? "junction" : "dir");
  return { ready: true, created: true };
}

function verifySubmodules(run, checkoutPath) {
  const submodules = requireCommand(run, "git", ["-C", checkoutPath, "submodule", "status", "--recursive"], "SUBMODULE_FAILED", "Personal Agent submodule verification failed");
  if (String(submodules.stdout || "").split(/\r?\n/).some((line) => /^[-+U]/.test(line))) {
    throw operationError("SUBMODULE_FAILED", "Personal Agent submodules are not pinned and initialized", 7);
  }
}

function persistState(config, result) {
  const file = path.join(config.dataRoot, "runtime", "product-development.json");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const value = {
    schemaVersion: 1,
    repository: result.repository.nameWithOwner,
    checkoutPath: result.checkoutPath,
    ready: result.ready,
    reused: result.reused,
    dirty: result.checkout.dirty,
    checkedOutAt: result.checkedOutAt,
  };
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  try { fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
}

function publicStatus({ contract, checkoutPath, tools, authenticated = false, repository = null, checkout = { exists: false, valid: false, repository: "", dirty: false }, ready, canEnsure = false, blocker = "" }) {
  return {
    schemaVersion: 1,
    mode: contract.mode,
    confirmationPolicy: contract.confirmationPolicy,
    failurePolicy: contract.cloneFailurePolicy,
    immutableRuntimePath: contract.immutableRuntimePath,
    repository,
    checkoutPath,
    tools,
    authenticated,
    checkout,
    ready: Boolean(ready),
    canEnsure: Boolean(canEnsure),
    blocker,
  };
}

function normalizeGitHubRepository(value) {
  const text = String(value || "").trim().replace(/\.git$/i, "");
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/i.exec(text);
  return match?.[1] || "";
}

function probe(run, command, args) {
  try { return run(command, args, commandOptions()).status === 0; } catch { return false; }
}

function requireCommand(run, command, args, code, message) {
  let result;
  try { result = run(command, args, commandOptions()); }
  catch { throw operationError(code, message, 7); }
  if (result.status !== 0) throw operationError(code, message, 7);
  return result;
}

function commandOptions() {
  return { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 };
}

function assertTemporaryPath(parent, temporary) {
  if (!isTemporaryChild(parent, temporary)) throw operationError("INVALID_ARGUMENT", "Unsafe temporary checkout path", 2);
}

function isTemporaryChild(parent, temporary) {
  const resolvedParent = path.resolve(parent);
  const resolved = path.resolve(temporary);
  return resolved.startsWith(`${resolvedParent}${path.sep}.personal-agent-clone-`) && path.dirname(resolved) === resolvedParent;
}

export const productDevelopmentInternals = { normalizeGitHubRepository, resolveCheckoutPath };
