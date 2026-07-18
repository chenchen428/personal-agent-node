import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRegistryPath = resolveConnectionRegistryPath();

export function resolveConnectionRegistryPath(moduleFile = fileURLToPath(import.meta.url)) {
  let directory = path.dirname(path.resolve(moduleFile));
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(directory, "registry", "connections.json");
    if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("connection registry is missing from the release root");
}

export function readConnectionRegistry(registryPath = defaultRegistryPath) {
  const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.connections)) throw new Error("unsupported connection registry");
  const ids = new Set();
  const accessModes = new Set(["account", "browser", "local"]);
  const supportedPlatforms = new Set(["win32", "darwin", "linux"]);
  for (const connection of parsed.connections) {
    if (!/^[a-z][a-z0-9-]*$/.test(String(connection.id || "")) || ids.has(connection.id)) throw new Error("invalid or duplicate connection id");
    if (!accessModes.has(connection.accessMode)) throw new Error(`invalid connection access mode: ${connection.id}`);
    if (connection.platforms !== undefined && (!Array.isArray(connection.platforms) || connection.platforms.length === 0 || new Set(connection.platforms).size !== connection.platforms.length || connection.platforms.some((platform) => !supportedPlatforms.has(platform)))) throw new Error(`invalid connection platforms: ${connection.id}`);
    if (connection.skillName && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(connection.skillName)) throw new Error(`invalid connection skill name: ${connection.id}`);
    if (!connection.cli?.command || !Array.isArray(connection.cli.operations) || !connection.skillDescription || !connection.skillReference) throw new Error(`incomplete connection contract: ${connection.id}`);
    ids.add(connection.id);
  }
  return parsed;
}

export function buildConnectionCatalog({ registry = readConnectionRegistry(), statuses = {}, registryPath = defaultRegistryPath, platform = process.platform } = {}) {
  return registry.connections.filter((definition) => !definition.platforms || definition.platforms.includes(platform)).map((definition) => {
    const dynamic = statuses[definition.id] || {};
    const state = String(dynamic.state || (definition.defaultConnected ? "connected" : "needs_setup"));
    return {
      ...definition,
      state,
      statusLabel: dynamic.statusLabel || defaultStatusLabel(state),
      primaryAction: dynamic.primaryAction || definition.primaryAction,
      tone: toneForState(state),
      runtime: mergeRuntime(definition.runtime, dynamic.runtime),
      details: dynamic.details || {},
      setup: dynamic.setup || undefined,
      error: dynamic.error || undefined,
      skill: {
        name: definition.skillName || registry.skill.name,
        reference: definition.skillReference,
        description: definition.skillDescription,
        document: readConnectorDocument(definition.skillReference, registryPath),
      },
    };
  });
}

function readConnectorDocument(reference, registryPath) {
  const releaseRoot = path.dirname(path.dirname(path.resolve(registryPath)));
  const connectorRoot = path.resolve(releaseRoot, "skills", "personal-agent", "references", "connectors");
  const target = path.resolve(releaseRoot, reference);
  if (target !== connectorRoot && !target.startsWith(`${connectorRoot}${path.sep}`)) throw new Error("connection skill reference escapes connector directory");
  if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) throw new Error(`connection skill reference is missing: ${reference}`);
  return fs.readFileSync(target, "utf8");
}

export function inspectConnection(id, options = {}) {
  return buildConnectionCatalog(options).find((connection) => connection.id === id) || null;
}

function mergeRuntime(declared = [], dynamic = []) {
  const values = new Map(declared.map((item) => [item.label, item]));
  for (const item of dynamic || []) values.set(item.label, item);
  return [...values.values()];
}

function defaultStatusLabel(state) {
  if (["connected", "ready", "logged_in"].includes(state)) return "已连接";
  if (["offline", "error", "missing"].includes(state)) return "不可用";
  return "待连接";
}

function toneForState(state) {
  if (["connected", "ready", "logged_in"].includes(state)) return "success";
  if (["offline", "error", "missing"].includes(state)) return "danger";
  return "warning";
}
