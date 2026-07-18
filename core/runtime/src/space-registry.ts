import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as Database } from "node:sqlite";

const require = createRequire(import.meta.url);

export const SPACE_SCHEMA_VERSION = 1;
export const RESERVED_SPACE_SLUGS = new Set([
  "admin", "agent", "api", "assets", "blog", "demo", "docs", "download", "mail", "pages", "personal", "resources", "sg", "sgtools", "smtp", "status", "support", "tjcds", "token", "tools", "usercontent", "www",
]);

export type SpaceKind = "personal" | "user";
export type SpaceState = "stopped" | "running" | "degraded" | "deleting" | "deleted";

export type SpacePorts = {
  bridge: number;
  admin: number;
  control: number;
  gateway: number;
  tools: number;
  xiaohongshu: number;
};

export type SpaceRecord = {
  id: string;
  slug: string;
  displayName: string;
  kind: SpaceKind;
  state: SpaceState;
  desiredState: "running" | "stopped";
  root: string;
  runtimeGeneration: number;
  ports: SpacePorts;
  managedHost: string;
  agentMail: string;
  createdAt: string;
  deletedAt: string | null;
};

export type InstallationRecord = {
  schemaVersion: number;
  installationId: string;
  createdAt: string;
};

const SPACE_DIRECTORIES = [
  "config",
  "secrets/local-auth",
  "secrets/node-identity",
  "secrets/cloud",
  "secrets/providers",
  "secrets/applications",
  "secrets/connections",
  "secrets/mail",
  "secrets/backup",
  "runtime/pids",
  "runtime/sockets",
  "runtime/locks",
  "runtime/state",
  "runtime/tmp",
  "databases/agent",
  "databases/agent-data",
  "databases/bridge",
  "databases/activity",
  "databases/automations",
  "databases/data",
  "databases/mail",
  "databases/pages",
  "databases/connections",
  "databases/apps",
  "databases/usage",
  "databases/tools",
  "databases/workspace-admin",
  "agent-workspace/files",
  "agent-workspace/artifacts",
  "agent-workspace/scratch",
  "channels/wechat",
  "channels/dingtalk",
  "channels/xiaohongshu",
  "channels/other",
  "connections/browser-profiles",
  "connections/provider-state",
  "connections/downloads",
  "mail/spool/tmp",
  "mail/spool/new",
  "mail/spool/retry",
  "mail/spool/dead",
  "mail/attachments",
  "mail/archive",
  "files/inbound",
  "files/managed",
  "files/materialized",
  "files/exports",
  "exports",
  "pages/drafts",
  "pages/assets",
  "pages/previews",
  "publications/staging",
  "publications/releases",
  "publications/private",
  "publications/pages",
  "publications/resources",
  "publications/blog",
  "publications/docs",
  "publications/legacy",
  "apps/installed",
  "apps/data",
  "plugins/enabled",
  "plugins/data",
  "data/plugins",
  "indexes/activity",
  "indexes/data",
  "indexes/mail",
  "indexes/pages",
  "logs",
  "snapshots",
  "backups",
] as const;

export function installationPaths(dataRoot: string) {
  const root = path.resolve(dataRoot);
  const installationRoot = path.join(root, "installation");
  return {
    root,
    installationRoot,
    installationFile: path.join(installationRoot, "installation.json"),
    registryFile: path.join(installationRoot, "spaces.sqlite"),
    runtimeRoot: path.join(installationRoot, "runtime"),
    spacesRoot: path.join(root, "spaces"),
  };
}

export function initializeInstallation({ dataRoot, now = new Date() }: { dataRoot: string; now?: Date }) {
  const paths = installationPaths(dataRoot);
  ensureRealDirectory(paths.root);
  const installationDirectories = [
    paths.installationRoot,
    paths.runtimeRoot,
    path.join(paths.runtimeRoot, "supervisor"),
    path.join(paths.runtimeRoot, "sockets"),
    path.join(paths.runtimeRoot, "locks"),
    path.join(paths.runtimeRoot, "ports"),
    path.join(paths.installationRoot, "logs"),
    path.join(paths.installationRoot, "updates"),
    path.join(paths.installationRoot, "cache"),
    paths.spacesRoot,
  ];
  for (const directory of installationDirectories) ensureRealDirectory(directory);

  let installation = readJson<InstallationRecord>(paths.installationFile);
  if (!installation) {
    installation = { schemaVersion: SPACE_SCHEMA_VERSION, installationId: opaqueId("ins"), createdAt: now.toISOString() };
    writeJsonAtomic(paths.installationFile, installation);
  }
  if (installation.schemaVersion !== SPACE_SCHEMA_VERSION || !/^ins_[A-Za-z0-9_-]+$/.test(installation.installationId)) {
    throw new Error("Invalid Personal Agent installation identity");
  }

  const database = openRegistry(paths.registryFile);
  try {
    let personal = database.prepare("SELECT * FROM spaces WHERE kind='personal' AND state<>'deleted'").get() as Record<string, unknown> | undefined;
    if (!personal) {
      personal = rowFromRecord(createSpaceRecord(database, paths, {
        kind: "personal",
        slug: "personal",
        displayName: "个人隔离空间",
        now,
      }));
    }
    return { installation, personal: mapRow(personal), paths };
  } finally {
    database.close();
  }
}

export function listSpaces(dataRoot: string, { includeDeleted = false } = {}) {
  const paths = installationPaths(dataRoot);
  if (!fs.existsSync(paths.registryFile)) return [];
  const database = openRegistry(paths.registryFile);
  try {
    const rows = database.prepare(`SELECT * FROM spaces ${includeDeleted ? "" : "WHERE state<>'deleted'"} ORDER BY kind='personal' DESC, created_at ASC`).all() as Record<string, unknown>[];
    return rows.map(mapRow);
  } finally {
    database.close();
  }
}

export function getSpace(dataRoot: string, selector: string | undefined = undefined) {
  const spaces = listSpaces(dataRoot);
  if (!spaces.length) return null;
  const requested = String(selector || "").trim();
  if (!requested) return spaces.find((space) => space.kind === "personal") || null;
  return spaces.find((space) => space.id === requested || space.slug === requested) || null;
}

export function createSpace({ dataRoot, slug, displayName, now = new Date() }: { dataRoot: string; slug: string; displayName: string; now?: Date }) {
  const paths = installationPaths(dataRoot);
  if (!fs.existsSync(paths.registryFile)) initializeInstallation({ dataRoot, now });
  const normalizedSlug = validateSpaceSlug(slug);
  const normalizedName = validateDisplayName(displayName);
  const database = openRegistry(paths.registryFile);
  try {
    const existing = database.prepare("SELECT id FROM spaces WHERE slug=?").get(normalizedSlug);
    if (existing) throw Object.assign(new Error("这个隔离空间标识已被使用，删除后也不会重新分配"), { code: "SPACE_SLUG_UNAVAILABLE" });
    return createSpaceRecord(database, paths, { kind: "user", slug: normalizedSlug, displayName: normalizedName, now });
  } finally {
    database.close();
  }
}

export function setSpaceDesiredState(dataRoot: string, selector: string, desiredState: "running" | "stopped") {
  const paths = installationPaths(dataRoot);
  const database = openRegistry(paths.registryFile);
  try {
    const space = requireSpaceRow(database, selector);
    database.prepare("UPDATE spaces SET desired_state=?,runtime_generation=runtime_generation+1 WHERE id=?").run(desiredState, space.id);
    return mapRow(database.prepare("SELECT * FROM spaces WHERE id=?").get(space.id) as Record<string, unknown>);
  } finally {
    database.close();
  }
}

export function updateSpaceRuntimeState(dataRoot: string, selector: string, state: Exclude<SpaceState, "deleting" | "deleted">) {
  const paths = installationPaths(dataRoot);
  const database = openRegistry(paths.registryFile);
  try {
    const space = requireSpaceRow(database, selector);
    database.prepare("UPDATE spaces SET state=? WHERE id=?").run(state, space.id);
    return mapRow(database.prepare("SELECT * FROM spaces WHERE id=?").get(space.id) as Record<string, unknown>);
  } finally {
    database.close();
  }
}

export function updateSpaceBinding({ dataRoot, selector, userSlug, platformDomain = "personal-agent.cn" }: { dataRoot: string; selector: string; userSlug: string; platformDomain?: string }) {
  const normalizedUser = validateUserSlug(userSlug);
  const paths = installationPaths(dataRoot);
  const database = openRegistry(paths.registryFile);
  try {
    const row = requireSpaceRow(database, selector);
    const label = row.kind === "personal" ? normalizedUser : `${row.slug}--${normalizedUser}`;
    if (Buffer.byteLength(label, "ascii") > 63) throw new Error("完整隔离空间域名标签不能超过 63 字节");
    const managedHost = `${label}.${normalizePlatformDomain(platformDomain)}`;
    const agentMail = `agent@${managedHost}`;
    database.prepare("UPDATE spaces SET managed_host=?,agent_mail=? WHERE id=?").run(managedHost, agentMail, row.id);
    return mapRow(database.prepare("SELECT * FROM spaces WHERE id=?").get(row.id) as Record<string, unknown>);
  } finally {
    database.close();
  }
}

export function setSpaceManagedIdentity({ dataRoot, selector, managedHost }: { dataRoot: string; selector: string; managedHost: string }) {
  const normalizedHost = String(managedHost || "").trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(normalizedHost) || !normalizedHost.includes(".")) throw new Error("隔离空间托管域名无效");
  const label = normalizedHost.split(".")[0];
  const paths = installationPaths(dataRoot);
  const database = openRegistry(paths.registryFile);
  try {
    const row = requireSpaceRow(database, selector);
    if (row.kind === "personal" ? label.includes("--") : !label.startsWith(`${row.slug}--`)) {
      throw new Error("托管域名与隔离空间身份不匹配");
    }
    const agentMail = `agent@${normalizedHost}`;
    database.prepare("UPDATE spaces SET managed_host=?,agent_mail=? WHERE id=?").run(normalizedHost, agentMail, row.id);
    return mapRow(database.prepare("SELECT * FROM spaces WHERE id=?").get(row.id) as Record<string, unknown>);
  } finally {
    database.close();
  }
}

export function deleteSpace(dataRoot: string, selector: string, { now = new Date() }: { now?: Date } = {}) {
  const paths = installationPaths(dataRoot);
  const database = openRegistry(paths.registryFile);
  try {
    const row = requireSpaceRow(database, selector);
    if (row.kind === "personal") throw Object.assign(new Error("个人隔离空间不能删除"), { code: "PERSONAL_SPACE_REQUIRED" });
    database.prepare("UPDATE spaces SET state='deleting',desired_state='stopped',runtime_generation=runtime_generation+1 WHERE id=?").run(row.id);
    fs.rmSync(confinedSpaceRoot(paths, String(row.root_path)), { recursive: true, force: true });
    database.prepare("UPDATE spaces SET state='deleted',deleted_at=? WHERE id=?").run(now.toISOString(), row.id);
    return mapRow(database.prepare("SELECT * FROM spaces WHERE id=?").get(row.id) as Record<string, unknown>);
  } finally {
    database.close();
  }
}

export function validateSpaceSlug(value: string) {
  const slug = String(value || "").trim();
  if (slug.length < 3 || slug.length > 28) throw new Error("隔离空间标识必须为 3–28 个字符");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) throw new Error("隔离空间标识只能使用小写字母、数字和内部单连字符");
  if (slug.includes("--")) throw new Error("隔离空间标识不能包含连续两个连字符（--）");
  if (RESERVED_SPACE_SLUGS.has(slug)) throw new Error("该隔离空间标识为系统保留值");
  return slug;
}

export function validateUserSlug(value: string) {
  const slug = String(value || "").trim();
  if (slug.length < 3 || slug.length > 28) throw new Error("用户标识必须为 3–28 个字符");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.includes("--")) {
    throw new Error("用户标识只能使用小写字母、数字和内部单连字符，且不能包含 --");
  }
  return slug;
}

function createSpaceRecord(database: Database, paths: ReturnType<typeof installationPaths>, input: { kind: SpaceKind; slug: string; displayName: string; now: Date }) {
  const id = opaqueId("sp");
  const slot = nextPortSlot(database, input.kind);
  const allocatedPorts = portsForSlot(slot);
  const root = path.join(paths.spacesRoot, id);
  const candidate = path.join(paths.spacesRoot, `.creating-${id}`);
  const createdAt = input.now.toISOString();
  try {
    ensureRealDirectory(candidate);
    for (const relative of SPACE_DIRECTORIES) ensureRealDirectory(path.join(candidate, relative));
    writeJsonAtomic(path.join(candidate, "space.json"), {
      schemaVersion: SPACE_SCHEMA_VERSION,
      spaceId: id,
      spaceSlug: input.slug,
      displayName: input.displayName,
      kind: input.kind,
      allocatedPorts,
      createdAt,
    });
    fs.renameSync(candidate, root);
    database.prepare(`INSERT INTO spaces(
      id,slug,display_name,kind,state,desired_state,root_path,runtime_generation,port_slot,allocated_ports,managed_host,agent_mail,created_at,deleted_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`).run(
      id, input.slug, input.displayName, input.kind, "stopped", "running", root, 1, slot, JSON.stringify(allocatedPorts), "", "", createdAt,
    );
    return mapRow(database.prepare("SELECT * FROM spaces WHERE id=?").get(id) as Record<string, unknown>);
  } catch (error) {
    fs.rmSync(candidate, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function openRegistry(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  // Node 22 labels its built-in SQLite API experimental. The registry is an
  // internal implementation detail, so do not let that runtime warning corrupt
  // the CLI's machine-readable stderr contract.
  process.env.NODE_NO_WARNINGS = "1";
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS spaces(
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('personal','user')),
      state TEXT NOT NULL CHECK(state IN ('stopped','running','degraded','deleting','deleted')),
      desired_state TEXT NOT NULL CHECK(desired_state IN ('running','stopped')),
      root_path TEXT NOT NULL UNIQUE,
      runtime_generation INTEGER NOT NULL,
      port_slot INTEGER NOT NULL UNIQUE,
      allocated_ports TEXT NOT NULL,
      managed_host TEXT NOT NULL,
      agent_mail TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_personal_space ON spaces(kind) WHERE kind='personal';
  `);
  return database;
}

function requireSpaceRow(database: Database, selector: string) {
  const row = database.prepare("SELECT * FROM spaces WHERE (id=? OR slug=?) AND state<>'deleted'").get(selector, selector) as Record<string, unknown> | undefined;
  if (!row) throw Object.assign(new Error("隔离空间不存在"), { code: "SPACE_NOT_FOUND" });
  return row;
}

function nextPortSlot(database: Database, kind: SpaceKind) {
  if (kind === "personal") return 0;
  const row = database.prepare("SELECT COALESCE(MAX(port_slot),0) AS value FROM spaces").get() as { value: number };
  return Number(row.value) + 1;
}

export function portsForSlot(slot: number): SpacePorts {
  if (!Number.isInteger(slot) || slot < 0 || slot > 500) throw new Error("Invalid Space port slot");
  const offset = slot * 20;
  return {
    bridge: 8788 + offset,
    admin: 8791 + offset,
    control: 8792 + offset,
    gateway: 8843 + offset,
    tools: 9955 + offset,
    xiaohongshu: 18060 + offset,
  };
}

function mapRow(row: Record<string, unknown>): SpaceRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    displayName: String(row.display_name),
    kind: String(row.kind) as SpaceKind,
    state: String(row.state) as SpaceState,
    desiredState: String(row.desired_state) as "running" | "stopped",
    root: path.resolve(String(row.root_path)),
    runtimeGeneration: Number(row.runtime_generation),
    ports: JSON.parse(String(row.allocated_ports)) as SpacePorts,
    managedHost: String(row.managed_host || ""),
    agentMail: String(row.agent_mail || ""),
    createdAt: String(row.created_at),
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  };
}

function rowFromRecord(record: SpaceRecord) {
  return {
    id: record.id,
    slug: record.slug,
    display_name: record.displayName,
    kind: record.kind,
    state: record.state,
    desired_state: record.desiredState,
    root_path: record.root,
    runtime_generation: record.runtimeGeneration,
    allocated_ports: JSON.stringify(record.ports),
    managed_host: record.managedHost,
    agent_mail: record.agentMail,
    created_at: record.createdAt,
    deleted_at: record.deletedAt,
  };
}

function validateDisplayName(value: string) {
  const name = String(value || "").trim();
  if (!name || [...name].length > 30 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error("隔离空间名称必须为 1–30 个可见字符");
  return name;
}

function confinedSpaceRoot(paths: ReturnType<typeof installationPaths>, candidate: string) {
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(`${paths.spacesRoot}${path.sep}`)) throw new Error("隔离空间目录逃逸安装数据根");
  return resolved;
}

function ensureRealDirectory(directory: string) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`隔离空间路径必须是真实目录: ${directory}`);
  try { fs.chmodSync(directory, 0o700); } catch {}
}

function normalizePlatformDomain(value: string) {
  const domain = String(value || "").trim().toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes(".")) throw new Error("平台域名无效");
  return domain;
}

function opaqueId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(16).toString("base64url")}`;
}

function readJson<T>(filePath: string): T | null {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")) as T; } catch { return null; }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}
