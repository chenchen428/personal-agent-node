import fs from "node:fs";
import path from "node:path";

export function listExtensions(config) {
  if (!fs.existsSync(config.extensionsDir)) return [];
  return fs.readdirSync(config.extensionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readExtension(config, entry.name))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function extensionComponentSpecs(config) {
  return listExtensions(config)
    .filter((extension) => extension.enabled !== false)
    .map((extension) => ({
      name: `extension-${extension.id}`,
      command: process.execPath,
      args: [extension.entrypointPath, ...(extension.args || [])],
      cwd: extension.root,
      port: extension.port || undefined,
      host: extension.host || "127.0.0.1",
      waitFor: extension.waitFor || undefined,
      env: extension.env || {},
      extensionId: extension.id,
      hostKey: extension.hostKey || "",
    }));
}

export function installExtension(config, sourceDir) {
  const source = path.resolve(sourceDir || "");
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(source, "private-site-extension.json"), "utf8")));
  const target = path.join(config.extensionsDir, manifest.id);
  const temporary = `${target}.${process.pid}.tmp`;
  if (fs.existsSync(target)) throw new Error(`Extension already exists: ${manifest.id}`);
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.cpSync(source, temporary, { recursive: true, filter: safeExtensionPath });
  fs.renameSync(temporary, target);
  return readExtension(config, manifest.id);
}

export function removeExtension(config, id) {
  const normalized = normalizeId(id);
  const target = path.join(config.extensionsDir, normalized);
  if (!fs.existsSync(target)) throw new Error(`Extension is not installed: ${normalized}`);
  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true, id: normalized, removed: true };
}

function readExtension(config, directoryName) {
  const root = path.join(config.extensionsDir, directoryName);
  const manifestPath = path.join(root, "private-site-extension.json");
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  if (manifest.id !== directoryName) throw new Error(`Extension directory must match manifest id: ${manifest.id}`);
  const entrypointPath = path.resolve(root, manifest.entrypoint);
  if (!entrypointPath.startsWith(`${root}${path.sep}`) || !fs.statSync(entrypointPath).isFile()) {
    throw new Error(`Extension entrypoint is unsafe or missing: ${manifest.id}`);
  }
  return { ...manifest, root, manifestPath, entrypointPath };
}

function validateManifest(input) {
  if (input?.schemaVersion !== 1) throw new Error("Extension schemaVersion must be 1");
  const id = normalizeId(input.id);
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(String(input.version || ""))) throw new Error(`Invalid extension version: ${id}`);
  if (!String(input.entrypoint || "").endsWith(".mjs")) throw new Error(`Extension entrypoint must be an .mjs file: ${id}`);
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)) throw new Error(`Invalid extension port: ${id}`);
  if (input.host && input.host !== "127.0.0.1") throw new Error(`Extensions must bind to loopback: ${id}`);
  const env = Object.fromEntries(Object.entries(input.env || {}).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || typeof value !== "string") throw new Error(`Invalid extension environment: ${id}`);
    return [key, value];
  }));
  return { ...input, id, env, args: Array.isArray(input.args) ? input.args.map(String) : [] };
}

function normalizeId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error(`Invalid extension id: ${id}`);
  return id;
}

function safeExtensionPath(candidate) {
  const parts = path.resolve(candidate).split(path.sep);
  const base = parts.at(-1) || "";
  if (parts.includes(".git") || parts.includes("node_modules") || parts.includes("secrets") || base.startsWith(".env")) return false;
  if (/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db)$/i.test(base)) return false;
  return true;
}
