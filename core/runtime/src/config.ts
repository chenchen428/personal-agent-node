import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { domainToASCII, fileURLToPath } from "node:url";
import { getSpace, initializeInstallation, installationPaths } from "./space-registry.ts";

const moduleProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const workspaceRoot = findWorkspaceRoot([moduleProjectRoot, path.dirname(path.resolve(process.argv[1] || process.cwd())), process.cwd()]);
export const projectRoot = path.join(workspaceRoot, "core", "runtime");
export const distributionPath = path.join(workspaceRoot, "registry", "site-distribution.json");
export const CONNECTION_MODES = Object.freeze(["local-only", "managed-cloud", "self-hosted-edge"]);

export function resolvePersonalAgentHome(env: NodeJS.ProcessEnv = process.env) {
  return path.resolve(env.PERSONAL_AGENT_HOME || path.join(os.homedir(), ".personal-agent"));
}

function findWorkspaceRoot(starts) {
  for (const start of starts) {
    let current = path.resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      if (fs.existsSync(path.join(current, "registry", "site-distribution.json"))
        && fs.existsSync(path.join(current, "core", "runtime"))) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return path.resolve(moduleProjectRoot, "..", "..");
}

export function resolveNodeConfig(env = process.env, options = {}) {
  const homeRoot = resolvePersonalAgentHome(env);
  const spaceContext = resolveSpaceContext(env, homeRoot);
  const installationDataRoot = spaceContext.installationDataRoot;
  const dataRoot = spaceContext.dataRoot;
  const configDir = path.join(dataRoot, "config");
  const configPath = path.join(configDir, "site.json");
  const providersPath = path.join(configDir, "providers.json");
  const envPath = path.resolve(env.PRIVATE_SITE_ENV_FILE || path.join(dataRoot, "secrets", "applications", "site.env"));
  const runtimeDir = path.join(dataRoot, "runtime");
  const logsDir = path.join(dataRoot, "logs");
  const distribution = readJson(distributionPath);
  const siteResolution = fs.existsSync(configPath) ? resolveSiteConnectionMode(configPath, configDir) : null;
  if (options.migrateSite === true && siteResolution?.changed) writeJsonAtomic(configPath, siteResolution.site, 0o600);
  const site = siteResolution?.site || null;
  const fileEnv = readEnvFile(envPath);
  const mergedEnv = { ...fileEnv, ...env };
  const providers = readProviderDocument(providersPath);
  const domain = normalizeApexDomain(mergedEnv.SITE_DOMAIN || site?.asciiDomain || "personal-agent.local");
  const routingMode = normalizeRoutingMode(mergedEnv.PERSONAL_AGENT_ROUTING_MODE || site?.routingMode || "path");
  const agentWorkspaceRoot = path.resolve(mergedEnv.PRIVATE_SITE_AGENT_WORKSPACE || path.join(dataRoot, "agent-workspace"));
  const defaultPorts = spaceContext.space?.ports || { bridge: 8788, admin: 8791, control: 8792, gateway: 8843, tools: 9955, xiaohongshu: 18060 };
  return {
    homeRoot,
    installationDataRoot,
    installationRoot: spaceContext.paths.installationRoot,
    installationRuntimeDir: spaceContext.paths.runtimeRoot,
    spacesRoot: spaceContext.paths.spacesRoot,
    space: spaceContext.space,
    dataRoot,
    mailDir: path.join(dataRoot, "mail"),
    configDir,
    configPath,
    providersPath,
    providers,
    envPath,
    runtimeDir,
    logsDir,
    distribution,
    site,
    env: mergedEnv,
    domain,
    routingMode,
    allowedHosts: normalizeHostList(mergedEnv.PERSONAL_AGENT_ALLOWED_HOSTS, [domain, spaceContext.space?.managedHost, mergedEnv.PRIVATE_SITE_LOCAL_DOMAIN || `${domain}.local`, "localhost", "127.0.0.1"]),
    agentWorkspaceRoot,
    appsDir: path.join(dataRoot, "apps", "installed"),
    appsConfigPath: path.join(configDir, "apps.json"),
    appsCompatibilityPath: path.join(configDir, "apps-compatibility.json"),
    pluginsDir: path.join(dataRoot, "plugins"),
    pluginDataDir: path.join(dataRoot, "data", "plugins"),
    extensionsDir: path.join(dataRoot, "plugins"),
    localDomain: mergedEnv.PRIVATE_SITE_LOCAL_DOMAIN || `${domain}.local`,
    gateway: {
      host: mergedEnv.PRIVATE_SITE_GATEWAY_HOST || "127.0.0.1",
      port: numberValue(mergedEnv.PRIVATE_SITE_GATEWAY_PORT, defaultPorts.gateway),
      tlsCert: mergedEnv.PRIVATE_SITE_ORIGIN_TLS_CERT || "",
      tlsKey: mergedEnv.PRIVATE_SITE_ORIGIN_TLS_KEY || "",
      tlsCa: mergedEnv.PRIVATE_SITE_ORIGIN_TLS_CA || "",
      edgeClientFingerprint: normalizeFingerprint(mergedEnv.PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT || ""),
      trustEdgeHeaders: mergedEnv.PRIVATE_SITE_TRUST_EDGE_HEADERS === "1",
    },
    ports: {
      bridge: numberValue(mergedEnv.OPEN_AGENT_BRIDGE_PORT, defaultPorts.bridge),
      admin: numberValue(mergedEnv.ADMIN_PANEL_PORT, defaultPorts.admin),
      control: numberValue(mergedEnv.PERSONAL_AGENT_CONTROL_PORT, defaultPorts.control),
      tools: numberValue(mergedEnv.LMT_TOOLS_PORT || mergedEnv.PORT, defaultPorts.tools),
      xiaohongshu: numberValue(mergedEnv.XIAOHONGSHU_CHANNEL_PORT, defaultPorts.xiaohongshu),
    },
  };
}

function resolveSpaceContext(env, homeRoot) {
  const configuredRoot = path.resolve(env.PERSONAL_AGENT_DATA_ROOT || env.PRIVATE_SITE_DATA_ROOT || path.join(homeRoot, "workspace"));
  const configuredSpaceRoot = String(env.PERSONAL_AGENT_SPACE_ROOT || "").trim();
  let installationDataRoot = configuredRoot;
  let explicitSpaceRoot = configuredSpaceRoot ? path.resolve(configuredSpaceRoot) : "";
  if (!configuredSpaceRoot && fs.existsSync(path.join(configuredRoot, "space.json"))) {
    explicitSpaceRoot = configuredRoot;
    installationDataRoot = path.dirname(path.dirname(configuredRoot));
  }
  const paths = installationPaths(installationDataRoot);
  const selector = String(env.PERSONAL_AGENT_SPACE_ID || "").trim();
  const space = getSpace(installationDataRoot, selector || undefined);
  if (selector && !space) throw new Error(`隔离空间不存在: ${selector}`);
  if (explicitSpaceRoot && space && explicitSpaceRoot !== space.root) throw new Error("隔离空间目录与注册表不一致");
  return {
    installationDataRoot,
    paths,
    space,
    dataRoot: explicitSpaceRoot || space?.root || path.join(paths.spacesRoot, "uninitialized"),
  };
}

export function initializeSite({ domain, dataRoot, spaceId, connectionMode = "local-only", distributionVersion = "0.1.0" } = {}) {
  const normalizedDomain = normalizeApexDomain(domain || process.env.SITE_DOMAIN || "personal-agent.local");
  const normalizedConnectionMode = normalizeConnectionMode(connectionMode);
  if (normalizedConnectionMode === "managed-cloud") {
    throw new Error("managed-cloud can only be activated by a completed personal-agent cloud connect flow");
  }
  const homeRoot = resolvePersonalAgentHome(process.env);
  let installationDataRoot = path.resolve(dataRoot || process.env.PERSONAL_AGENT_DATA_ROOT || process.env.PRIVATE_SITE_DATA_ROOT || path.join(homeRoot, "workspace"));
  let requestedSpaceId = spaceId;
  const directSpacePath = path.join(installationDataRoot, "space.json");
  const directSpaceDocument = fs.existsSync(directSpacePath) ? readJson(directSpacePath) : null;
  if (directSpaceDocument?.spaceId) {
    requestedSpaceId ||= directSpaceDocument.spaceId;
    installationDataRoot = path.dirname(path.dirname(installationDataRoot));
  }
  const initialized = initializeInstallation({ dataRoot: installationDataRoot });
  const selectedSpace = getSpace(installationDataRoot, requestedSpaceId || process.env.PERSONAL_AGENT_SPACE_ID || initialized.personal.id);
  if (!selectedSpace) throw new Error(`隔离空间不存在: ${requestedSpaceId || "personal"}`);
  const selectionEnv = {
    ...process.env,
    PERSONAL_AGENT_DATA_ROOT: installationDataRoot,
    PERSONAL_AGENT_SPACE_ID: selectedSpace.id,
    PERSONAL_AGENT_SPACE_ROOT: selectedSpace.root,
    PRIVATE_SITE_DATA_ROOT: selectedSpace.root,
    SITE_DOMAIN: normalizedDomain,
  };
  const config = resolveNodeConfig(selectionEnv, { migrateSite: true });
  ensureNodeDirectories(config);
  if (fs.existsSync(config.configPath)) {
    const existing = readJson(config.configPath);
    if (existing.asciiDomain !== normalizedDomain) {
      throw new Error(`Site data root already belongs to ${existing.asciiDomain}`);
    }
    ensureMailIngressSecret(config);
    return { config: resolveNodeConfig(selectionEnv), created: false };
  }
  const now = new Date().toISOString();
  const site = {
    schemaVersion: 2,
    siteId: opaqueId("site"),
    displayDomain: String(domain || normalizedDomain),
    asciiDomain: normalizedDomain,
    nodeId: opaqueId("node"),
    protocolVersion: "1.0",
    distributionVersion,
    connectionMode: normalizedConnectionMode,
    routingMode: "path",
    createdAt: now,
  };
  writeJsonAtomic(config.configPath, site, 0o600);
  fs.copyFileSync(distributionPath, path.join(config.configDir, "distribution.json"));
  ensureSecretEnv(config.envPath, {
    SITE_DOMAIN: normalizedDomain,
    OPEN_AGENT_BRIDGE_API_TOKEN: randomSecret(),
    OPEN_AGENT_BRIDGE_UPLOAD_TOKEN: randomSecret(),
    OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN: randomSecret(),
    PERSONAL_AGENT_AUTH_PASSWORD: randomSecret(),
    PERSONAL_AGENT_AUTH_COOKIE_SECRET: randomSecret(),
    ...(fs.existsSync(path.join(workspaceRoot, "core", "tools")) ? { LMT_SESSION_SECRET: randomSecret() } : {}),
  });
  return { config: resolveNodeConfig(selectionEnv), created: true };
}

export function normalizeConnectionMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (!CONNECTION_MODES.includes(mode)) {
    throw new Error(`Invalid Personal Agent connection mode: ${mode || "empty"}; expected ${CONNECTION_MODES.join(" | ")}`);
  }
  return mode;
}

export function setConnectionMode(config, mode) {
  if (!config?.configPath || !config.site) throw new Error("Personal Agent Node is not initialized");
  const connectionMode = normalizeConnectionMode(mode);
  if (connectionMode === "managed-cloud" && !hasCompletedCloudEnrollment(config.configDir)) {
    throw new Error("managed-cloud requires a completed Cloud enrollment");
  }
  const site = { ...config.site, schemaVersion: 2, connectionMode, updatedAt: new Date().toISOString() };
  delete site.edgeMode;
  writeJsonAtomic(config.configPath, site, 0o600);
  return site;
}

function resolveSiteConnectionMode(configPath, configDir) {
  const site = readJson(configPath);
  const completedCloudEnrollment = hasCompletedCloudEnrollment(configDir);
  let connectionMode;
  if (site.connectionMode !== undefined) {
    connectionMode = normalizeConnectionMode(site.connectionMode);
    if (connectionMode === "managed-cloud" && !completedCloudEnrollment) connectionMode = "local-only";
  } else {
    const legacyMode = String(site.edgeMode || "local-only").trim().toLowerCase();
    if (legacyMode === "managed") connectionMode = completedCloudEnrollment ? "managed-cloud" : "local-only";
    else if (legacyMode === "self-hosted") connectionMode = "self-hosted-edge";
    else connectionMode = normalizeConnectionMode(legacyMode);
  }
  const migrated = { ...site, schemaVersion: 2, connectionMode };
  delete migrated.edgeMode;
  return { site: migrated, changed: JSON.stringify(migrated) !== JSON.stringify(site) };
}

function hasCompletedCloudEnrollment(configDir) {
  const cloudPath = path.join(configDir, "cloud.json");
  if (!fs.existsSync(cloudPath)) return false;
  try {
    const cloud = readJson(cloudPath);
    const common = Boolean(String(cloud.cloudUrl || "").trim())
      && Boolean(String(cloud.managedHost || "").trim())
      && Boolean(String(cloud.siteId || "").trim())
      && Boolean(String(cloud.enrolledAt || "").trim());
    if (!common) return false;
    if (cloud.schemaVersion === 2 || cloud.schemaVersion === 3) {
      const endpoint = new URL(String(cloud.tunnel?.endpoint || ""));
      const secureEndpoint = endpoint.protocol === "wss:" || (endpoint.protocol === "ws:" && ["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname));
      const rotatingCredential = cloud.schemaVersion === 2 || (
        cloud.credential?.tokenType === "Bearer"
        && Boolean(String(cloud.credential?.refreshEndpoint || "").trim())
        && Boolean(String(cloud.credential?.accessExpiresAt || "").trim())
      );
      return rotatingCredential
        && cloud.tunnel?.protocol === "pa-reverse-ws-v1"
        && secureEndpoint
        && Number.isInteger(cloud.tunnel?.generation)
        && cloud.tunnel.generation > 0;
    }
    return cloud.schemaVersion === 1
      && Boolean(String(cloud.tunnel?.address || "").trim())
      && Boolean(String(cloud.tunnel?.endpoint || "").trim());
  } catch {
    return false;
  }
}

export function ensureNodeDirectories(config) {
  const directories = [
    config.dataRoot,
    config.configDir,
    config.runtimeDir,
    config.logsDir,
    path.join(config.dataRoot, "databases"),
    path.join(config.dataRoot, "databases", "bridge"),
    path.join(config.dataRoot, "databases", "agent-data"),
    path.join(config.dataRoot, "databases", "automations"),
    path.join(config.dataRoot, "databases", "tools"),
    path.join(config.dataRoot, "databases", "workspace-admin"),
    path.join(config.dataRoot, "secrets", "node-identity"),
    path.join(config.dataRoot, "secrets", "applications"),
    path.join(config.dataRoot, "channels"),
    path.join(config.dataRoot, "channels", "wechat"),
    path.join(config.dataRoot, "channels", "xiaohongshu"),
    config.appsDir,
    config.pluginsDir,
    config.pluginDataDir,
    config.mailDir,
    path.join(config.mailDir, "archive"),
    path.join(config.mailDir, "spool", "tmp"),
    path.join(config.dataRoot, "files", "inbound"),
    path.join(config.dataRoot, "files", "managed"),
    path.join(config.dataRoot, "files", "materialized"),
    path.join(config.dataRoot, "publications", "pages"),
    path.join(config.dataRoot, "publications", "private"),
    path.join(config.dataRoot, "publications", "resources"),
    path.join(config.dataRoot, "publications", "blog"),
    path.join(config.dataRoot, "publications", "docs"),
    path.join(config.dataRoot, "publications", "legacy"),
    path.join(config.dataRoot, "backups"),
    path.join(config.dataRoot, "snapshots"),
    config.agentWorkspaceRoot,
    config.extensionsDir,
  ];
  for (const directory of directories) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

export function requireRuntimeSecrets(config) {
  const required = [
    "PERSONAL_AGENT_AUTH_COOKIE_SECRET",
    "OPEN_AGENT_BRIDGE_API_TOKEN",
    "OPEN_AGENT_BRIDGE_UPLOAD_TOKEN",
    "OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN",
  ];
  if (!String(config.env.PERSONAL_AGENT_AUTH_PASSWORD || "").trim() && !fs.existsSync(path.join(config.dataRoot, "config", "local-auth.json"))) {
    required.unshift("PERSONAL_AGENT_AUTH_PASSWORD or local-auth.json");
  }
  if (fs.existsSync(path.join(workspaceRoot, "core", "tools"))) required.push("LMT_SESSION_SECRET");
  const missing = required.filter((name) => !String(config.env[name] || "").trim());
  if (gatewayUsesTls(config) && !config.gateway.edgeClientFingerprint) missing.push("PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT");
  if (missing.length) throw new Error(`Missing private Site environment values: ${missing.join(", ")}`);
}

export function buildServiceEnvironment(config) {
  const siteDomain = config.domain;
  const databasePath = path.join(config.dataRoot, "databases", "tools", "lmt-tools.sqlite");
  const codexAppServer = resolveCodexAppServer(config.env);
  const tokenProvider = config.providers?.token || { provider: "byok", endpoint: "", credentialEnv: "OPENAI_API_KEY" };
  return {
    NODE_ENV: "production",
    SITE_DOMAIN: siteDomain,
    PRIVATE_SITE_RELEASE_ROOT: workspaceRoot,
    PERSONAL_AGENT_DATA_ROOT: config.installationDataRoot,
    PERSONAL_AGENT_INSTALLATION_ROOT: config.installationRoot,
    PERSONAL_AGENT_SPACE_ID: config.space?.id || "",
    PERSONAL_AGENT_SPACE_SLUG: config.space?.slug || "",
    PERSONAL_AGENT_SPACE_KIND: config.space?.kind || "",
    PERSONAL_AGENT_SPACE_ROOT: config.dataRoot,
    PRIVATE_SITE_DATA_ROOT: config.dataRoot,
    OPEN_AGENT_BRIDGE_HOST: "127.0.0.1",
    OPEN_AGENT_BRIDGE_PORT: String(config.ports.bridge),
    OPEN_AGENT_BRIDGE_WORKSPACE_ROOT: config.agentWorkspaceRoot,
    OPEN_AGENT_BRIDGE_DATA_DIR: path.join(config.dataRoot, "databases", "bridge"),
    OPEN_AGENT_BRIDGE_PAGES_DIR: path.join(config.dataRoot, "publications", "pages"),
    OPEN_AGENT_BRIDGE_UPLOADS_DIR: path.join(config.dataRoot, "files", "managed"),
    OPEN_AGENT_BRIDGE_MATERIALIZED_FILES_DIR: path.join(config.dataRoot, "files", "materialized"),
    OPEN_AGENT_BRIDGE_AGENT_DATA_DIR: path.join(config.dataRoot, "databases", "agent-data"),
    OPEN_AGENT_BRIDGE_AGENT_DATA_DATABASE: path.join(config.dataRoot, "databases", "agent-data", "agent-data.sqlite"),
    OPEN_AGENT_BRIDGE_AUTOMATION_DATA_DIR: path.join(config.dataRoot, "databases", "automations"),
    OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: config.mailDir,
    OPEN_AGENT_BRIDGE_PRIVATE_PUBLICATIONS_DIR: path.join(config.dataRoot, "publications", "private"),
    OPEN_AGENT_BRIDGE_CONSOLE_BASE_URL: serviceBaseUrl(config, "agent"),
    OPEN_AGENT_BRIDGE_CODEX_APP_SERVER_COMMAND: codexAppServer.appServerCommand,
    OPEN_AGENT_BRIDGE_CODEX_APP_SERVER_ARGS: JSON.stringify(codexAppServer.appServerArgs),
    OPEN_AGENT_BRIDGE_PAGES_BASE_URL: serviceBaseUrl(config, "pages"),
    OPEN_AGENT_BRIDGE_API_TOKEN: config.env.OPEN_AGENT_BRIDGE_API_TOKEN,
    OPEN_AGENT_BRIDGE_UPLOAD_TOKEN: config.env.OPEN_AGENT_BRIDGE_UPLOAD_TOKEN,
    OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN: config.env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN,
    ONLINE_PAGES_UPLOAD_TOKEN: config.env.OPEN_AGENT_BRIDGE_UPLOAD_TOKEN,
    CLI_BRIDGE_DATA_DIR: path.join(config.dataRoot, "channels", "wechat"),
    WECHAT_INBOUND_ATTACHMENTS_DIR: path.join(config.dataRoot, "files", "inbound"),
    OPEN_AGENT_BRIDGE_XIAOHONGSHU_BASE_URL: `http://127.0.0.1:${config.ports.xiaohongshu}`,
    PRIVATE_SITE_XIAOHONGSHU_ENABLED: config.env.PRIVATE_SITE_XIAOHONGSHU_ENABLED === "1" ? "1" : "0",
    OPEN_AGENT_BRIDGE_SCHEDULER_TIMEZONE: config.env.OPEN_AGENT_BRIDGE_SCHEDULER_TIMEZONE || "Asia/Shanghai",
    OPEN_AGENT_BRIDGE_CHANNEL_POLL: config.env.OPEN_AGENT_BRIDGE_CHANNEL_POLL === "0" ? "0" : "1",
    OPEN_AGENT_BRIDGE_SCHEDULER: config.env.OPEN_AGENT_BRIDGE_SCHEDULER === "0" ? "0" : "1",
    PERSONAL_AGENT_AUTH_PASSWORD: config.env.PERSONAL_AGENT_AUTH_PASSWORD,
    PERSONAL_AGENT_AUTH_VERIFIER_FILE: path.join(config.dataRoot, "config", "local-auth.json"),
    PERSONAL_AGENT_AUTH_COOKIE_SECRET: config.env.PERSONAL_AGENT_AUTH_COOKIE_SECRET,
    PERSONAL_AGENT_AUTH_COOKIE_NAME: spaceCookieName(config),
    PERSONAL_AGENT_AUTH_COOKIE_HOST_ONLY: config.routingMode === "path" ? "1" : "0",
    PERSONAL_AGENT_AUTH_COOKIE_DOMAINS: config.routingMode === "path" ? "" : `${siteDomain},${config.localDomain}`,
    ADMIN_PANEL_HOST: "127.0.0.1",
    ADMIN_PANEL_PORT: String(config.ports.admin),
    ADMIN_PANEL_DATA_DIR: path.join(config.dataRoot, "databases", "workspace-admin"),
    OPEN_AGENT_BRIDGE_INTERNAL_URL: `http://127.0.0.1:${config.ports.bridge}`,
    LMT_TOOLS_PORT: String(config.ports.tools),
    LMT_UPLOADS_DIR: path.join(config.dataRoot, "publications", "resources", "lmt-tools"),
    LMT_RESOURCES_BASE_URL: serviceBaseUrl(config, "resources"),
    PORT: String(config.ports.tools),
    DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}`,
    SESSION_SECRET: config.env.LMT_SESSION_SECRET,
    NO_PROXY: config.env.NO_PROXY || "127.0.0.1,localhost,::1",
    PRIVATE_SITE_GATEWAY_HOST: config.gateway.host,
    PRIVATE_SITE_GATEWAY_PORT: String(config.gateway.port),
    PRIVATE_SITE_TRUST_EDGE_HEADERS: config.gateway.trustEdgeHeaders ? "1" : "0",
    PRIVATE_SITE_ORIGIN_TLS_CERT: config.gateway.tlsCert,
    PRIVATE_SITE_ORIGIN_TLS_KEY: config.gateway.tlsKey,
    PRIVATE_SITE_ORIGIN_TLS_CA: config.gateway.tlsCa,
    PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT: config.gateway.edgeClientFingerprint,
    PERSONAL_AGENT_TUNNEL_PROVIDER: config.providers?.tunnel?.provider || "local",
    PERSONAL_AGENT_TOKEN_PROVIDER: tokenProvider.provider,
    OPENAI_BASE_URL: tokenProvider.endpoint || config.env.OPENAI_BASE_URL || "",
    OPENAI_API_KEY: tokenProvider.credentialEnv ? config.env[tokenProvider.credentialEnv] || "" : config.env.OPENAI_API_KEY || "",
  };
}

function spaceCookieName(config) {
  const suffix = crypto.createHash("sha256").update(String(config.space?.id || config.dataRoot)).digest("hex").slice(0, 12);
  return config.routingMode === "path" ? `__Host-personal_agent_${suffix}` : `personal_agent_${suffix}`;
}

function readProviderDocument(filePath) {
  if (!fs.existsSync(filePath)) return {
    schemaVersion: 1,
    tunnel: { provider: "local", endpoint: "", credentialEnv: "" },
    token: { provider: "byok", endpoint: "", credentialEnv: "OPENAI_API_KEY" },
  };
  const value = readJson(filePath);
  if (value?.schemaVersion !== 1 || !value.tunnel?.provider || !value.token?.provider) throw new Error("Invalid providers.json");
  return value;
}

export function writeWorkerConfig(config) {
  const target = path.join(config.runtimeDir, "worker-config.json");
  const worker = {
    baseUrl: `http://127.0.0.1:${config.ports.bridge}`,
    serviceUrl: `http://127.0.0.1:${config.ports.bridge}`,
    agentCommand: "codex app-server",
    ...resolveCodexAppServer(config.env),
    agentAlias: "codex",
    workspace: config.agentWorkspaceRoot,
    workspaceProvided: true,
    workspaceName: config.domain,
    workspaces: [{
      name: config.domain,
      workspaceRoot: config.agentWorkspaceRoot,
      routingTags: [config.domain, "private-site-node", "open-agent-bridge"],
      contextSummary: "Local-first complete Private Site Node workspace.",
    }],
    pidFile: path.join(config.runtimeDir, "worker.pid.json"),
    heartbeatIntervalMs: 60_000,
    appServerApprovalPolicy: "never",
    appServerSandbox: "danger-full-access",
    appServerTransport: "stdio",
    codexSessionSync: false,
  };
  writeJsonAtomic(target, worker, 0o600);
  return target;
}

export function resolveCodexCli(env = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const nodeExecutable = options.nodeExecutable || process.execPath;
  const exists = options.exists || fs.existsSync;
  const realpath = options.realpath || fs.realpathSync;
  const commandFor = (target) => {
    let resolved = target;
    try { resolved = realpath(target); } catch {}
    return platformPath.extname(resolved).toLowerCase() === ".js"
      ? { command: nodeExecutable, prefixArgs: [target] }
      : { command: target, prefixArgs: [] };
  };
  const runWhere = options.runWhere || (() => spawnSync("where.exe", ["codex.exe"], { encoding: "utf8", windowsHide: true }));
  const listDesktopExecutables = options.listDesktopExecutables || (() => {
    const localBin = platformPath.join(env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
    let local = [];
    try {
      local = fs.readdirSync(localBin, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => platformPath.join(localBin, entry.name, "codex.exe"))
        .filter((candidate) => exists(candidate))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    } catch {}
    const where = String(runWhere()?.stdout || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    return [...local, ...where];
  });
  const configured = String(env.PRIVATE_SITE_CODEX_EXECUTABLE || "").trim();
  if (configured) {
    const target = path.resolve(configured);
    if (!exists(target)) throw new Error(`Configured Codex executable does not exist: ${target}`);
    return commandFor(target);
  }
  if (platform !== "win32") {
    const home = env.HOME || os.homedir();
    const candidates = [
      platformPath.join(home, ".npm-global", "bin", "codex"),
      platformPath.join(home, ".local", "bin", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      "/usr/bin/codex",
    ];
    const discovered = candidates.find((candidate) => exists(candidate));
    return discovered ? commandFor(discovered) : { command: "codex", prefixArgs: [] };
  }

  // The desktop Codex executable tracks the app-server protocol shipped with the
  // current app. A stale global npm installation must not shadow it on Windows.
  const desktopExecutable = listDesktopExecutables().find((value) => value && exists(value));
  if (desktopExecutable) return { command: desktopExecutable, prefixArgs: [] };

  const npmModule = platformPath.join(env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (exists(npmModule)) return { command: nodeExecutable, prefixArgs: [npmModule] };
  throw new Error("Unable to locate a Codex executable for the local Worker");
}

export function resolveCodexAppServer(env = process.env, options = {}) {
  const cli = resolveCodexCli(env, options);
  return { appServerCommand: cli.command, appServerArgs: [...cli.prefixArgs, "app-server"] };
}

export function normalizeApexDomain(value) {
  const input = String(value || "").trim().replace(/\.$/, "");
  if (!input || input.includes(":") || input.includes("/") || input.includes("*")) throw new Error(`Invalid apex domain: ${input || "empty"}`);
  const ascii = domainToASCII(input).toLowerCase();
  if (!ascii || ascii.length > 253 || !ascii.includes(".")) throw new Error(`Invalid apex domain: ${input}`);
  for (const label of ascii.split(".")) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new Error(`Invalid apex domain label: ${label}`);
  }
  return ascii;
}

export function normalizeRoutingMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode !== "path") throw new Error(`Invalid Personal Agent routing mode: ${mode || "empty"}; only path routing is supported`);
  return mode;
}

function normalizeHostList(value, defaults) {
  const values = String(value || "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return [...new Set(values.length ? values : defaults.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))];
}

function serviceBaseUrl(config, service) {
  const route = service === "agent" ? "app" : service === "pages" ? "public" : service;
  return `https://${config.domain}/${route}`;
}

export function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

export function mergeSecretEnv(filePath, incoming, allowlist = null) {
  const existing = readEnvFile(filePath);
  const allowed = allowlist ? new Set(allowlist) : null;
  const filtered = Object.fromEntries(Object.entries(incoming).filter(([key, value]) => (
    (!allowed || allowed.has(key)) && String(value || "").trim()
  )));
  writeEnvAtomic(filePath, { ...existing, ...filtered });
}

export function removeSecretEnvKeys(filePath, keys) {
  const next = readEnvFile(filePath);
  for (const key of keys || []) delete next[key];
  writeEnvAtomic(filePath, next);
}

export function ensureMailIngressSecret(config) {
  if (!config?.envPath) throw new Error("Personal Agent mail ingress requires a Site environment path");
  const existing = readEnvFile(config.envPath);
  if (String(existing.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN || "").trim()) return false;
  writeEnvAtomic(config.envPath, { ...existing, OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN: randomSecret() });
  return true;
}

export function migrateLegacyMailData(config) {
  if (!config?.dataRoot || !config?.mailDir) throw new Error("Personal Agent mail migration requires a resolved Node configuration");
  const dataRoot = path.resolve(config.dataRoot);
  const targetRoot = confinedPath(dataRoot, config.mailDir, "mail migration target");
  const legacyRoots = [
    path.join(dataRoot, "mail-ingress"),
    path.join(dataRoot, "channels", "mail"),
  ].filter((candidate) => fs.existsSync(candidate));
  if (!legacyRoots.length) return { migrated: false, copied: 0, identical: 0, sources: [], sourcesRetained: true, rollbackSafe: true };

  const targetEntries = fs.existsSync(targetRoot) ? inspectMailTree(targetRoot, targetRoot, "target") : { directories: [], files: [] };
  const targetDirectories = new Set(targetEntries.directories);
  const targetFiles = new Map(targetEntries.files.map((entry) => [entry.relative, entry.path]));
  const sourceFiles = new Map();
  const sourceDirectories = new Set();
  for (const sourceRoot of legacyRoots) {
    confinedPath(dataRoot, sourceRoot, "legacy mail source");
    const inspected = inspectMailTree(sourceRoot, sourceRoot, "legacy source");
    for (const relative of inspected.directories) sourceDirectories.add(relative);
    for (const entry of inspected.files) {
      const existing = sourceFiles.get(entry.relative);
      if (existing && !sameFileContent(existing.path, entry.path)) {
        throw new Error(`Legacy mail migration conflict between sources: ${entry.relative}`);
      }
      if (!existing) sourceFiles.set(entry.relative, entry);
    }
  }

  for (const relative of sourceDirectories) {
    if (sourceFiles.has(relative)) throw new Error(`Legacy mail migration source type conflict: ${relative}`);
    if (targetFiles.has(relative)) throw new Error(`Legacy mail migration directory conflicts with target file: ${relative}`);
  }
  let identical = 0;
  const copies = [];
  for (const [relative, source] of sourceFiles) {
    if (targetDirectories.has(relative)) throw new Error(`Legacy mail migration file conflicts with target directory: ${relative}`);
    const target = path.join(targetRoot, ...relative.split("/"));
    const existing = targetFiles.get(relative);
    if (!existing) copies.push({ ...source, target });
    else if (sameFileContent(source.path, existing)) identical += 1;
    else throw new Error(`Legacy mail migration target conflict: ${relative}`);
  }

  fs.mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(targetRoot, 0o700);
  for (const relative of [...sourceDirectories].sort((left, right) => left.split("/").length - right.split("/").length)) {
    const directory = path.join(targetRoot, ...relative.split("/"));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  for (const existing of targetFiles.values()) fs.chmodSync(existing, 0o600);
  for (const entry of copies) copyMailFileAtomic(entry.path, entry.target);
  return {
    migrated: copies.length > 0,
    copied: copies.length,
    identical,
    sources: legacyRoots.map((source) => path.relative(dataRoot, source).replaceAll("\\", "/")),
    sourcesRetained: true,
    rollbackSafe: true,
  };
}

export function writeJsonAtomic(filePath, value, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, mode); } catch {}
}

function ensureSecretEnv(filePath, defaults) {
  const existing = readEnvFile(filePath);
  writeEnvAtomic(filePath, { ...defaults, ...existing });
}

function writeEnvAtomic(filePath, values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${quoteEnv(value)}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${lines.join("\n")}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function quoteEnv(value) {
  return JSON.stringify(String(value));
}

function randomSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function confinedPath(root, candidate, label) {
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes PRIVATE_SITE_DATA_ROOT`);
  return resolved;
}

function inspectMailTree(root, current, label) {
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`${label} must be a real directory: ${root}`);
  const output = { directories: [], files: [] };
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(entryPath);
      const relative = path.relative(root, entryPath).replaceAll("\\", "/");
      if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`${label} contains an unsafe path`);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link: ${relative}`);
      if (stat.isDirectory()) {
        output.directories.push(relative);
        walk(entryPath);
      } else if (stat.isFile()) output.files.push({ relative, path: entryPath });
      else throw new Error(`${label} contains an unsupported entry: ${relative}`);
    }
  };
  walk(current);
  return output;
}

function sameFileContent(left, right) {
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  if (leftStat.size !== rightStat.size) return false;
  return crypto.createHash("sha256").update(fs.readFileSync(left)).digest("hex")
    === crypto.createHash("sha256").update(fs.readFileSync(right)).digest("hex");
}

function copyMailFileAtomic(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.migrating`;
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o600);
    // Windows FlushFileBuffers requires a handle opened with write access.
    const descriptor = fs.openSync(temporary, "r+");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    try {
      fs.linkSync(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST" || !sameFileContent(temporary, target)) throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function opaqueId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

export function gatewayUsesTls(config) {
  return Boolean(config.gateway.tlsCert && config.gateway.tlsKey && config.gateway.tlsCa);
}

function normalizeFingerprint(value) {
  const normalized = String(value || "").replaceAll(":", "").trim().toUpperCase();
  if (normalized && !/^[A-F0-9]{64}$/.test(normalized)) throw new Error("PRIVATE_SITE_EDGE_CLIENT_FINGERPRINT must be a SHA-256 certificate fingerprint");
  return normalized;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
