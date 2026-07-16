import fs from "node:fs";
import path from "node:path";
import {
  parsePersonalAppManifest,
  PERSONAL_APP_MANIFEST,
  SUPPORTED_NODE_API_MAJORS,
  type PersonalAgentAppManifest,
} from "../../apps/sdk/manifest.ts";

const reservedIds = new Set(["api", "app", "apps", "internal", "login", "logout", "setup", "update"]);
const deniedSegments = new Set(["data", "node_modules", "secrets", "src"]);
const allowedExtensions = new Set([
  ".avif", ".css", ".gif", ".html", ".ico", ".jpeg", ".jpg", ".js", ".json", ".mjs",
  ".mp3", ".mp4", ".otf", ".png", ".svg", ".ttf", ".txt", ".wasm", ".webm", ".webmanifest",
  ".webp", ".woff", ".woff2", ".xml",
]);

export type PersonalAppRecord = PersonalAgentAppManifest & {
  root: string;
  entryPath: string;
  publicRoot: string;
  compatible: boolean;
};

export type PersonalAppScan = {
  apps: PersonalAppRecord[];
  invalid: Array<{ id: string; reason: string }>;
};

export function scanPersonalApps(config): PersonalAppScan {
  if (!fs.statSync(config.appsDir, { throwIfNoEntry: false })?.isDirectory()) return { apps: [], invalid: [] };
  const apps: PersonalAppRecord[] = [];
  const invalid: Array<{ id: string; reason: string }> = [];
  for (const entry of fs.readdirSync(config.appsDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try { apps.push(readPersonalApp(config, entry.name)); }
    catch (error) { invalid.push({ id: safeReportedId(entry.name), reason: publicError(error) }); }
  }
  return { apps, invalid };
}

export function inspectPersonalApp(config, id: string): PersonalAppRecord {
  return readPersonalApp(config, normalizeAppId(id));
}

export function verifyPersonalApp(config, id: string): PersonalAppRecord {
  return inspectPersonalApp(config, id);
}

export function readPersonalAppSettings(config, { strict = false } = {}) {
  const empty = { schemaVersion: 1, defaultAppId: "" };
  if (!fs.existsSync(config.appsConfigPath)) return empty;
  try {
    const value = JSON.parse(fs.readFileSync(config.appsConfigPath, "utf8"));
    if (value?.schemaVersion !== 1 || (value.defaultAppId !== undefined && typeof value.defaultAppId !== "string")) throw new Error("Unsupported Personal App settings");
    return { ...value, schemaVersion: 1, defaultAppId: String(value.defaultAppId || "") };
  } catch (error) {
    if (strict) throw error;
    return { ...empty, invalid: true };
  }
}

export function setDefaultPersonalApp(config, id: string) {
  const app = verifyPersonalApp(config, id);
  if (!app.compatible) throw new Error(`App requires unsupported Node API ${app.requires.nodeApi}`);
  const settings = readPersonalAppSettings(config, { strict: true });
  writeJsonAtomic(config.appsConfigPath, { ...settings, schemaVersion: 1, defaultAppId: app.id });
  return resolveDefaultPersonalApp(config);
}

export function clearDefaultPersonalApp(config) {
  const settings = readPersonalAppSettings(config, { strict: true });
  writeJsonAtomic(config.appsConfigPath, { ...settings, schemaVersion: 1, defaultAppId: "" });
  return { configuredAppId: "", app: null, fallback: "official-console" };
}

export function resolveDefaultPersonalApp(config) {
  const settings = readPersonalAppSettings(config);
  if (settings.invalid) return { configuredAppId: "", app: null, fallback: "invalid-settings" };
  if (!settings.defaultAppId) return { configuredAppId: "", app: null, fallback: "official-console" };
  const scan = scanPersonalApps(config);
  const app = scan.apps.find((candidate) => candidate.id === settings.defaultAppId) || null;
  if (!app) return { configuredAppId: settings.defaultAppId, app: null, fallback: "missing-or-invalid-app" };
  if (!app.compatible) return { configuredAppId: settings.defaultAppId, app: null, fallback: "incompatible-app" };
  return { configuredAppId: settings.defaultAppId, app, fallback: "" };
}

export function writePersonalAppCompatibilityReport(config) {
  const scan = scanPersonalApps(config);
  const resolved = resolveDefaultPersonalApp(config);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidateNodeApis: [...SUPPORTED_NODE_API_MAJORS],
    compatible: scan.apps.filter((app) => app.compatible).map((app) => app.id),
    incompatible: scan.apps.filter((app) => !app.compatible).map((app) => ({
      id: app.id,
      requiredNodeApi: app.requires.nodeApi,
      candidateNodeApis: [...SUPPORTED_NODE_API_MAJORS],
    })),
    invalid: scan.invalid,
    configuredDefaultAppId: resolved.configuredAppId,
    effectiveDefaultAppId: resolved.app?.id || "",
    fallback: resolved.fallback,
  };
  writeJsonAtomic(config.appsCompatibilityPath, report);
  return report;
}

export function resolvePersonalAppAsset(config, pathname: string) {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const match = /^\/apps\/([^/]+)(?:\/(.*))?$/.exec(decoded);
  if (!match) return null;
  let app: PersonalAppRecord;
  try { app = inspectPersonalApp(config, match[1]); } catch { return null; }
  if (!app.compatible) return null;
  const relative = match[2] || "";
  if (!safePublicPath(relative)) return null;
  const requested = relative ? confined(app.publicRoot, relative) : app.entryPath;
  const direct = realFileInside(app.publicRoot, requested);
  const extension = path.extname(relative).toLowerCase();
  const filePath = direct || (!extension ? app.entryPath : "");
  if (!filePath) return null;
  const fileExtension = path.extname(filePath).toLowerCase();
  if (!allowedExtensions.has(fileExtension)) return null;
  return {
    app,
    filePath,
    cacheControl: fileExtension === ".html"
      ? "no-cache"
      : contentAddressed(path.basename(filePath)) ? "public, max-age=31536000, immutable" : "no-cache",
  };
}

export function publicPersonalApp(record: PersonalAppRecord) {
  return {
    apiVersion: record.apiVersion,
    id: record.id,
    name: record.name,
    entry: record.entry,
    requires: record.requires,
    ...(record.version ? { version: record.version } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.icon ? { icon: record.icon } : {}),
    compatible: record.compatible,
    route: record.compatible ? `/app/apps/${record.id}` : "",
    desktopRoute: record.compatible ? `/app/apps/${record.id}` : "",
    mobileRoute: record.compatible ? `/app/mobile/apps/${record.id}` : "",
    assetRoute: record.compatible ? `/apps/${record.id}/` : "",
  };
}

function readPersonalApp(config, id: string): PersonalAppRecord {
  const normalized = normalizeAppId(id);
  if (reservedIds.has(normalized)) throw new Error("App id is reserved");
  const root = confined(config.appsDir, normalized);
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error("App directory is missing or unsafe");
  const manifestPath = path.join(root, PERSONAL_APP_MANIFEST);
  const manifestStat = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink()) throw new Error(`App manifest is missing: ${PERSONAL_APP_MANIFEST}`);
  const manifest = parsePersonalAppManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  if (manifest.id !== normalized) throw new Error("App directory must match manifest id");
  const rootReal = fs.realpathSync(root);
  const entryPath = realFileInside(rootReal, confined(rootReal, manifest.entry));
  if (!entryPath) throw new Error("App entry is missing or escapes its App directory");
  const publicRoot = fs.realpathSync(path.dirname(entryPath));
  assertInside(rootReal, publicRoot);
  return { ...manifest, root: rootReal, entryPath, publicRoot, compatible: SUPPORTED_NODE_API_MAJORS.includes(manifest.requires.nodeApi) };
}

function safePublicPath(relative: string) {
  if (relative.includes("\\") || path.isAbsolute(relative)) return false;
  const segments = relative.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment.startsWith(".") || deniedSegments.has(segment.toLowerCase()))) return false;
  const base = segments.at(-1)?.toLowerCase() || "";
  if (base === PERSONAL_APP_MANIFEST || base.endsWith(".map") || /\.(?:db|log|pem|key|p12|pfx|sqlite|sqlite3)$/i.test(base)) return false;
  return true;
}

function realFileInside(root: string, candidate: string): string {
  try {
    const resolved = fs.realpathSync(candidate);
    assertInside(root, resolved);
    return fs.statSync(resolved).isFile() ? resolved : "";
  } catch { return ""; }
}

function confined(root: string, relative: string) {
  const base = path.resolve(root);
  const candidate = String(relative || "");
  if (!candidate || path.isAbsolute(candidate) || candidate.split(/[\\/]/).includes("..")) throw new Error("Unsafe App path");
  const target = path.resolve(base, candidate);
  assertInside(base, target);
  return target;
}

function assertInside(root: string, target: string) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error("App path escapes its Workspace boundary");
}

function normalizeAppId(value: string) {
  const id = String(value || "");
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id) || id.length > 96) throw new Error("Invalid App id");
  return id;
}

function safeReportedId(value: string) {
  return /^[a-z][a-z0-9.-]{0,95}$/.test(value) ? value : "invalid-app-directory";
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z]:[\\/][^\s]+|\/(?:[^\s/]+\/)+[^\s]+/g, "<local-path>").slice(0, 500);
}

function contentAddressed(fileName: string) {
  return /(?:^|[.-])[a-f0-9]{8,}(?:[.-]|$)/i.test(fileName);
}

function writeJsonAtomic(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}
