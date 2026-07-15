import fs from "node:fs";
import path from "node:path";
import { parsePluginManifest, type PersonalAgentPluginManifest } from "../sdk/manifest.ts";

export type PluginState = "enabled" | "disabled";

export type PluginRecord = PersonalAgentPluginManifest & {
  root: string;
  manifestPath: string;
  dataDir: string;
  state: PluginState;
};

export type PluginStoreConfig = {
  pluginsDir: string;
  pluginDataDir?: string;
  coreVersion?: string;
};

const manifestName = "personal-agent.plugin.json";
const stateName = ".personal-agent-state.json";

export function listPlugins(config: PluginStoreConfig): PluginRecord[] {
  if (!fs.existsSync(config.pluginsDir)) return [];
  return fs.readdirSync(config.pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readPlugin(config, entry.name))
    .filter((entry): entry is PluginRecord => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function installPlugin(config: PluginStoreConfig, sourceDir: string): PluginRecord {
  const source = path.resolve(sourceDir || "");
  const manifest = readManifest(path.join(source, manifestName));
  assertCompatible(manifest.compatibility.core, config.coreVersion || "0.1.0");
  verifyEntrypoints(source, manifest);
  const target = confined(config.pluginsDir, manifest.id);
  const temporary = `${target}.${process.pid}.tmp`;
  if (fs.existsSync(target)) throw new Error(`Plugin already exists: ${manifest.id}`);
  fs.mkdirSync(config.pluginsDir, { recursive: true, mode: 0o700 });
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.cpSync(source, temporary, { recursive: true, filter: safePluginPath });
  writeJson(path.join(temporary, stateName), { schemaVersion: 1, state: "enabled" });
  fs.renameSync(temporary, target);
  return requirePlugin(config, manifest.id);
}

export function setPluginState(config: PluginStoreConfig, id: string, state: PluginState): PluginRecord {
  const plugin = requirePlugin(config, id);
  writeJson(path.join(plugin.root, stateName), { schemaVersion: 1, state });
  return requirePlugin(config, id);
}

export function removePlugin(config: PluginStoreConfig, id: string): { id: string; removed: true } {
  const plugin = requirePlugin(config, id);
  fs.rmSync(plugin.root, { recursive: true, force: true });
  return { id: plugin.id, removed: true };
}

export function verifyPlugin(config: PluginStoreConfig, id: string): PluginRecord {
  const plugin = requirePlugin(config, id);
  assertCompatible(plugin.compatibility.core, config.coreVersion || "0.1.0");
  verifyEntrypoints(plugin.root, plugin);
  return plugin;
}

export function pluginComponentSpecs(config: PluginStoreConfig) {
  return listPlugins(config).flatMap((plugin) => {
    if (plugin.state !== "enabled") return [];
    const contributions = [
      ...(plugin.contributes.workers || []).map((entry) => ({ kind: "worker", ...entry })),
      ...(plugin.contributes.channels || []).map((entry) => ({ kind: "channel", ...entry })),
      ...(plugin.contributes.schedules || []).map((entry) => ({ kind: "schedule", ...entry })),
    ];
    if (contributions.length) fs.mkdirSync(plugin.dataDir, { recursive: true, mode: 0o700 });
    return contributions.map((entry) => ({
      name: `plugin-${plugin.id}-${entry.id}`,
      command: process.execPath,
      args: [confined(plugin.root, entry.entry)],
      cwd: plugin.root,
      env: {
        PERSONAL_AGENT_PLUGIN_ID: plugin.id,
        PERSONAL_AGENT_PLUGIN_DATA_DIR: plugin.dataDir,
        PERSONAL_AGENT_PLUGIN_PERMISSIONS: plugin.permissions.join(","),
        PERSONAL_AGENT_PLUGIN_CONTRIBUTION: entry.kind,
      },
      pluginId: plugin.id,
    }));
  });
}

function readPlugin(config: PluginStoreConfig, directoryName: string): PluginRecord | null {
  const root = confined(config.pluginsDir, directoryName);
  const manifestPath = path.join(root, manifestName);
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = readManifest(manifestPath);
  if (manifest.id !== directoryName) throw new Error(`Plugin directory must match manifest id: ${manifest.id}`);
  const state = readState(path.join(root, stateName));
  const dataDir = confined(config.pluginDataDir || path.join(path.dirname(config.pluginsDir), "data", "plugins"), manifest.id);
  return { ...manifest, root, manifestPath, dataDir, state };
}

function requirePlugin(config: PluginStoreConfig, id: string): PluginRecord {
  const normalized = normalizeId(id);
  const plugin = readPlugin(config, normalized);
  if (!plugin) throw new Error(`Plugin is not installed: ${normalized}`);
  return plugin;
}

function readManifest(filePath: string): PersonalAgentPluginManifest {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) throw new Error(`Plugin manifest is missing: ${manifestName}`);
  return parsePluginManifest(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function readState(filePath: string): PluginState {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value.state === "disabled" ? "disabled" : "enabled";
  } catch {
    return "enabled";
  }
}

function verifyEntrypoints(root: string, manifest: PersonalAgentPluginManifest) {
  const entries = [
    ...(manifest.contributes.tools || []), ...(manifest.contributes.workers || []),
    ...(manifest.contributes.channels || []), ...(manifest.contributes.schedules || []),
  ];
  for (const entry of entries) {
    const target = confined(root, entry.entry);
    if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) throw new Error(`Plugin entrypoint is missing: ${entry.id}`);
  }
}

function assertCompatible(range: string, version: string) {
  if (range === "*" || range === version) return;
  const major = version.split(".")[0];
  if (range === `^${major}.0.0` || range === `${major}.x`) return;
  throw new Error(`Plugin requires incompatible Core version: ${range}`);
}

function confined(root: string, relative: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, normalizeIdOrPath(relative));
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Plugin path escapes its Workspace boundary");
  return target;
}

function normalizeId(value: string): string {
  const id = String(value || "");
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/.test(id)) throw new Error(`Invalid plugin id: ${id}`);
  return id;
}

function normalizeIdOrPath(value: string): string {
  const candidate = String(value || "");
  if (!candidate || path.isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) throw new Error("Unsafe plugin path");
  return candidate;
}

function safePluginPath(candidate: string): boolean {
  const parts = path.resolve(candidate).split(path.sep);
  const base = parts.at(-1) || "";
  if (parts.includes(".git") || parts.includes("node_modules") || parts.includes("secrets") || base.startsWith(".env")) return false;
  return !/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|log)$/i.test(base);
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
