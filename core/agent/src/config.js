import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = rootDir;
const workspaceRoot = path.resolve(projectDir, "..", "..");
loadEnvFile(path.join(projectDir, ".env"));

const resolvedWorkspaceRoot = path.resolve(process.env.OPEN_AGENT_BRIDGE_WORKSPACE_ROOT || workspaceRoot);
const personalAgentHome = path.resolve(process.env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"));
const siteDataRoot = path.resolve(process.env.PRIVATE_SITE_DATA_ROOT || path.join(personalAgentHome, "workspace"));
const defaultDataDir = path.join(siteDataRoot, "databases", "bridge");
const resolvedDataDir = path.resolve(process.env.OPEN_AGENT_BRIDGE_DATA_DIR || defaultDataDir);
const resolvedMailIngressDir = path.resolve(process.env.OPEN_AGENT_BRIDGE_MAIL_DATA_DIR || path.join(siteDataRoot, "mail"));
const resolvedInboundAttachmentsDir = path.resolve(
  process.env.WECHAT_INBOUND_ATTACHMENTS_DIR || path.join(siteDataRoot, "files", "inbound"),
);
const defaultMigrationRoots = [
  path.join(resolvedWorkspaceRoot, "workspace", "publications"),
  path.join(resolvedDataDir, "uploads"),
  resolvedInboundAttachmentsDir,
];

export const config = {
  host: process.env.OPEN_AGENT_BRIDGE_HOST || "127.0.0.1",
  port: Number.parseInt(process.env.OPEN_AGENT_BRIDGE_PORT || "8788", 10),
  spaceId: String(process.env.PERSONAL_AGENT_SPACE_ID || "").trim(),
  spaceSlug: String(process.env.PERSONAL_AGENT_SPACE_SLUG || "").trim(),
  spaceKind: String(process.env.PERSONAL_AGENT_SPACE_KIND || "").trim(),
  rootDir,
  projectDir,
  workspaceRoot: resolvedWorkspaceRoot,
  siteDataRoot,
  appsDir: path.join(siteDataRoot, "apps", "installed"),
  agentAuthorizationFile: path.join(siteDataRoot, "config", "agent-authorization.json"),
  dailyTokenLimitFile: path.join(siteDataRoot, "config", "daily-token-limit.json"),
  codexRuntimeSettingsFile: path.join(siteDataRoot, "config", "codex-runtime-settings.json"),
  dataDir: resolvedDataDir,
  publicDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_PUBLIC_DIR || path.join(projectDir, "public")),
  pagesDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_PAGES_DIR || path.join(resolvedDataDir, "pages")),
  uploadsDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_UPLOADS_DIR || path.join(resolvedDataDir, "uploads")),
  materializedFilesDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_MATERIALIZED_FILES_DIR || path.join(resolvedDataDir, "materialized")),
  agentDataDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_AGENT_DATA_DIR || path.join(resolvedDataDir, "data")),
  agentDataDatabasePath: path.resolve(process.env.OPEN_AGENT_BRIDGE_AGENT_DATA_DATABASE || path.join(resolvedDataDir, "data", "agent-data.sqlite")),
  automationDataDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_AUTOMATION_DATA_DIR || path.join(resolvedDataDir, "automations")),
  privatePublicationsDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_PRIVATE_PUBLICATIONS_DIR || path.join(resolvedDataDir, "private-publications")),
  releaseNotesDir: path.resolve(process.env.OPEN_AGENT_BRIDGE_RELEASE_NOTES_DIR || path.join(siteDataRoot, "release-notes")),
  mailIngressDir: resolvedMailIngressDir,
  migrationRoots: String(process.env.OPEN_AGENT_BRIDGE_MIGRATION_ROOTS || defaultMigrationRoots.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value)),
  inboundAttachmentsDir: resolvedInboundAttachmentsDir,
  maxUploadBytes: Number.parseInt(process.env.OPEN_AGENT_BRIDGE_MAX_UPLOAD_BYTES || "10485760", 10),
  consoleBaseUrl: (process.env.OPEN_AGENT_BRIDGE_CONSOLE_BASE_URL || "https://personal-agent.local/agent").replace(/\/+$/, ""),
  pagesBaseUrl: (process.env.OPEN_AGENT_BRIDGE_PAGES_BASE_URL || "https://personal-agent.local/pages").replace(/\/+$/, ""),
  externalAccess: () => resolveExternalAccess({
    dataRoot: siteDataRoot,
    consoleBaseUrl: process.env.OPEN_AGENT_BRIDGE_CONSOLE_BASE_URL || "https://personal-agent.local/app",
  }),
  uploadToken: process.env.OPEN_AGENT_BRIDGE_UPLOAD_TOKEN || process.env.ONLINE_PAGES_UPLOAD_TOKEN || "",
  apiToken: process.env.OPEN_AGENT_BRIDGE_API_TOKEN || "",
  mailIngestToken: process.env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN || "",
  xiaohongshuBaseUrl: (process.env.OPEN_AGENT_BRIDGE_XIAOHONGSHU_BASE_URL || "http://127.0.0.1:18060").replace(/\/+$/, ""),
  openCliCommand: process.env.PERSONAL_AGENT_OPENCLI_CLI || "",
  personalAuth: {
    password: process.env.PERSONAL_AGENT_AUTH_PASSWORD || "",
    cookieSecret: process.env.PERSONAL_AGENT_AUTH_COOKIE_SECRET || (process.env.NODE_ENV === "production" ? "" : "personal-agent-local-auth-secret"),
    cookieName: process.env.PERSONAL_AGENT_AUTH_COOKIE_NAME || "__Host-personal_agent",
    ttlSeconds: Number.parseInt(process.env.PERSONAL_AGENT_AUTH_TTL_SECONDS || "31536000", 10),
    cookieHostOnly: process.env.PERSONAL_AGENT_AUTH_COOKIE_HOST_ONLY !== "0",
    cookieDomains: String(process.env.PERSONAL_AGENT_AUTH_COOKIE_DOMAINS || "personal-agent.local,personal-agent.local")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    setupBootstrapFile: path.join(siteDataRoot, "runtime", "setup", "bootstrap.json"),
    verifierFile: process.env.PERSONAL_AGENT_AUTH_VERIFIER_FILE || path.join(siteDataRoot, "config", "local-auth.json"),
  },
  codexCommand: process.env.OPEN_AGENT_BRIDGE_CODEX_COMMAND || "codex",
  codexAppServerCommand: process.env.OPEN_AGENT_BRIDGE_CODEX_APP_SERVER_COMMAND || "",
  codexAppServerArgs: jsonStringArray(process.env.OPEN_AGENT_BRIDGE_CODEX_APP_SERVER_ARGS),
  codexApprovalPolicy: process.env.OPEN_AGENT_BRIDGE_CODEX_APPROVAL_POLICY || "on-request",
  codexSandbox: process.env.OPEN_AGENT_BRIDGE_CODEX_SANDBOX || "workspace-write",
  codexModel: process.env.OPEN_AGENT_BRIDGE_CODEX_MODEL || "",
  codexReasoningEffort: process.env.OPEN_AGENT_BRIDGE_CODEX_REASONING_EFFORT || "",
  channelPollEnabled: process.env.OPEN_AGENT_BRIDGE_CHANNEL_POLL !== "0",
  schedulerEnabled: process.env.OPEN_AGENT_BRIDGE_SCHEDULER !== "0",
  schedulerTimezone: process.env.OPEN_AGENT_BRIDGE_SCHEDULER_TIMEZONE || "Asia/Shanghai",
  automationAgentConcurrency: boundedInteger(process.env.OPEN_AGENT_BRIDGE_AUTOMATION_AGENT_CONCURRENCY || "3", 1, 10, 3),
  automationQueueLimit: boundedInteger(process.env.OPEN_AGENT_BRIDGE_AUTOMATION_QUEUE_LIMIT || "50", 10, 500, 50),
  mailProtection: {
    senderDailyLimit: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_SENDER_DAILY_LIMIT || "12", 1, 200, 12),
    trustedSenderDailyLimit: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_TRUSTED_SENDER_DAILY_LIMIT || "30", 1, 500, 30),
    domainDailyLimit: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_DOMAIN_DAILY_LIMIT || "60", 1, 2_000, 60),
    globalDailyLimit: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_GLOBAL_DAILY_LIMIT || "150", 1, 10_000, 150),
    autoTrustSafeCount: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_AUTO_TRUST_SAFE_COUNT || "8", 3, 100, 8),
    autoBlockViolationCount: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MAIL_AUTO_BLOCK_VIOLATION_COUNT || "3", 2, 20, 3),
  },
  longTaskProgressIntervalMs: progressIntervalMs(process.env.OPEN_AGENT_BRIDGE_PROGRESS_INTERVAL_MS || "300000"),
  attachmentBatchQuietMs: boundedMilliseconds(process.env.OPEN_AGENT_BRIDGE_ATTACHMENT_BATCH_QUIET_MS || "8000", 1000, 30000, 8000),
  attachmentBatchMaxWaitMs: boundedMilliseconds(process.env.OPEN_AGENT_BRIDGE_ATTACHMENT_BATCH_MAX_WAIT_MS || "30000", 5000, 120000, 30000),
  historyRetentionDays: boundedInteger(process.env.OPEN_AGENT_BRIDGE_HISTORY_RETENTION_DAYS || "30", 7, 365, 30),
  managedFileRetentionDays: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MANAGED_FILE_RETENTION_DAYS || process.env.OPEN_AGENT_BRIDGE_PRIVATE_FILE_RETENTION_DAYS || "30", 1, 365, 30),
  materializedFileTtlDays: boundedInteger(process.env.OPEN_AGENT_BRIDGE_MATERIALIZED_FILE_TTL_DAYS || "7", 1, 365, 7),
  historyCleanupIntervalMs: boundedMilliseconds(process.env.OPEN_AGENT_BRIDGE_HISTORY_CLEANUP_INTERVAL_MS || "86400000", 3600000, 604800000, 86400000),
  sessionPageSize: Number.parseInt(process.env.OPEN_AGENT_BRIDGE_SESSION_PAGE_SIZE || "20", 10),
  instanceId: process.env.OPEN_AGENT_BRIDGE_INSTANCE_ID || `${os.hostname()}-${process.pid}`,
};

export function resolveExternalAccess({ dataRoot = siteDataRoot, consoleBaseUrl = "", now = new Date() } = {}) {
  const site = readJson(path.join(dataRoot, "config", "site.json"));
  const mode = String(site?.connectionMode || "local-only");
  if (mode === "local-only") return { ready: false, reason: "local-only", origin: "" };
  const cloud = readJson(path.join(dataRoot, "config", "cloud.json"));
  const host = mode === "managed-cloud" ? String(cloud?.managedHost || "") : hostnameFromBase(consoleBaseUrl);
  if (!host) return { ready: false, reason: "not-configured", origin: "" };
  if (mode === "managed-cloud") {
    const state = readJson(path.join(dataRoot, "runtime", "reverse-tunnel.json"));
    const lastPongAt = Date.parse(String(state?.lastPongAt || ""));
    const heartbeatMs = Number(cloud?.tunnel?.heartbeatSeconds || 20) * 3000;
    if (state?.state !== "ready" || !Number.isFinite(lastPongAt) || now.getTime() - lastPongAt > heartbeatMs) {
      const recoveryState = ["degraded", "refreshing", "authorizing", "reauth_required"].includes(state?.state) ? state.state : "tunnel-offline";
      return { ready: false, reason: recoveryState, origin: "" };
    }
  }
  return { ready: true, reason: "ready", origin: `https://${host}` };
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function hostnameFromBase(value) {
  try { return new URL(String(value || "")).hostname; } catch { return ""; }
}

export function ensureRuntimeDirs() {
  for (const dir of [config.dataDir, config.publicDir, config.pagesDir, config.uploadsDir, config.materializedFilesDir, config.agentDataDir, config.automationDataDir, config.privatePublicationsDir, config.releaseNotesDir, config.mailIngressDir, config.inboundAttachmentsDir, config.appsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim());
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function unquoteEnvValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function progressIntervalMs(value) {
  const parsed = Number.parseInt(value, 10);
  if (parsed === 0) return 0;
  if (!Number.isFinite(parsed)) return 60000;
  return Math.min(Math.max(parsed, 60000), 3600000);
}

function boundedMilliseconds(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function jsonStringArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}
