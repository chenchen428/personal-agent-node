import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SOURCE_RELATIVE = path.join("core", "agent", "vendor", "opencli-runtime");
const REQUIRED_SOURCE_FILES = ["package.json", "package-lock.json", "runtime.json", "README.md"];

export function assembleOpenCliRuntime({ workspaceRoot, releaseRoot, npmInvocation, execute = execFileSync, stdio = "inherit" }) {
  const sourceRoot = path.join(workspaceRoot, SOURCE_RELATIVE);
  const targetRoot = path.join(releaseRoot, SOURCE_RELATIVE);
  const descriptor = readDescriptor(sourceRoot);
  validateLock(path.join(sourceRoot, "package-lock.json"), descriptor);

  fs.mkdirSync(targetRoot, { recursive: true });
  for (const name of REQUIRED_SOURCE_FILES) fs.copyFileSync(path.join(sourceRoot, name), path.join(targetRoot, name));
  execute(
    npmInvocation.command,
    [...npmInvocation.prefixArgs, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: targetRoot, stdio },
  );
  fs.rmSync(path.join(targetRoot, "node_modules", ".bin"), { recursive: true, force: true });

  verifyOpenCliRuntime({ releaseRoot, descriptor });
  return {
    package: descriptor.package,
    version: descriptor.version,
    license: descriptor.license,
    entrypoint: descriptor.entrypoint,
    bundled: true,
    installScripts: false,
    browserBridge: descriptor.browserBridge,
  };
}

export function verifyOpenCliRuntime({ releaseRoot, descriptor = readDescriptor(path.join(releaseRoot, SOURCE_RELATIVE)) }) {
  const entrypoint = releasePath(releaseRoot, descriptor.entrypoint);
  const packageRoot = path.join(releaseRoot, SOURCE_RELATIVE, "node_modules", "@jackwener", "opencli");
  const installed = readJson(path.join(packageRoot, "package.json"));
  if (installed.name !== descriptor.package || installed.version !== descriptor.version) {
    throw new Error(`Bundled OpenCLI version mismatch: expected ${descriptor.package}@${descriptor.version}`);
  }
  if (installed.license !== descriptor.license) throw new Error(`Bundled OpenCLI license mismatch: expected ${descriptor.license}`);
  if (!fs.statSync(entrypoint, { throwIfNoEntry: false })?.isFile()) throw new Error("Bundled OpenCLI entrypoint is missing");
  if (!fs.statSync(path.join(packageRoot, "LICENSE"), { throwIfNoEntry: false })?.isFile()) throw new Error("Bundled OpenCLI license file is missing");
  assertNoSymlinks(path.join(releaseRoot, SOURCE_RELATIVE));
  return { descriptor, entrypoint, packageRoot };
}

export function readOpenCliRuntimeDescriptor(workspaceRoot) {
  return readDescriptor(path.join(workspaceRoot, SOURCE_RELATIVE));
}

function readDescriptor(directory) {
  const descriptor = readJson(path.join(directory, "runtime.json"));
  if (descriptor.schemaVersion !== 1 || descriptor.package !== "@jackwener/opencli" || !/^\d+\.\d+\.\d+$/.test(descriptor.version)) {
    throw new Error("Invalid OpenCLI runtime descriptor");
  }
  if (descriptor.installScripts !== false || descriptor.license !== "Apache-2.0") throw new Error("OpenCLI runtime policy is invalid");
  if (descriptor.browserBridge?.bundled !== false || descriptor.browserBridge?.userConfirmationRequired !== true) {
    throw new Error("OpenCLI Browser Bridge must remain an explicit user-granted permission");
  }
  const extensionId = String(descriptor.browserBridge.extensionId || "");
  const installUrl = new URL(String(descriptor.browserBridge.installUrl || ""));
  if (!/^[a-p]{32}$/.test(extensionId) || installUrl.protocol !== "https:" || installUrl.hostname !== "chromewebstore.google.com" || !installUrl.pathname.endsWith(`/${extensionId}`)) {
    throw new Error("OpenCLI Browser Bridge distribution is invalid");
  }
  releasePath(".", descriptor.entrypoint);
  return descriptor;
}

function validateLock(file, descriptor) {
  const lock = readJson(file);
  const root = lock.packages?.[""];
  const installed = lock.packages?.[`node_modules/${descriptor.package}`];
  if (lock.lockfileVersion !== 3 || root?.dependencies?.[descriptor.package] !== descriptor.version || installed?.version !== descriptor.version) {
    throw new Error("OpenCLI package lock does not match the runtime descriptor");
  }
  for (const entry of Object.values(lock.packages || {})) {
    if (entry?.resolved && !String(entry.resolved).startsWith("https://registry.npmjs.org/")) {
      throw new Error(`OpenCLI package lock uses an unapproved registry: ${entry.resolved}`);
    }
  }
}

function releasePath(root, relative) {
  const normalized = String(relative || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) throw new Error("Unsafe OpenCLI runtime path");
  return path.join(root, ...normalized.split("/"));
}

function assertNoSymlinks(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Bundled OpenCLI runtime contains a symbolic link: ${entry.name}`);
    if (entry.isDirectory()) assertNoSymlinks(path.join(directory, entry.name));
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
