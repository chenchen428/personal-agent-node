#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { harnessLinks, verifyHarnessLinks } from "./harness-links.mjs";

const requestedReleaseRoot = path.resolve(process.argv[2] || "");
if (!requestedReleaseRoot || !fs.existsSync(requestedReleaseRoot)) throw new Error("Usage: verify-private-site-node-dist.mjs <release-root>");
// macOS exposes /tmp and os.tmpdir() through aliases of /private/tmp and
// /private/var/folders. Relative symlink targets are only valid when both
// operands use the same filesystem namespace.
const releaseRoot = fs.realpathSync(requestedReleaseRoot);
const manifest = readJson("release-manifest.json");

await main();

async function main() {
  verifyLayout();
  verifyChecksums();
  verifySecurityBoundary();
  verifyProjectOwnership();
  verifyHarness();
  const mailTransportBoundary = verifyMailTransportBoundary();
  const expandBundledCommandName = await verifyCommandRegistry();
  verifyEntrypoints(expandBundledCommandName);
  const releasePreparation = verifyPackagedPreparation();
  const { localMail, webConversation } = await verifyMailArtifact(mailTransportBoundary);
  await verifyPlatformAdapters();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    releaseId: manifest.releaseId,
    revision: manifest.revision,
    harnessOwner: manifest.harness.owner,
    skills: fs.readdirSync(at("skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length,
    releasePreparation,
    localMail,
    webConversation,
  }, null, 2)}\n`);
}

function verifyPackagedPreparation() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-packaged-prepare-")));
  const dataRoot = path.join(root, "data");
  const freshDataRoot = path.join(root, "fresh-data");
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const freshBinDir = path.join(root, "fresh-bin");
  const legacyMail = path.join(dataRoot, "mail-ingress", "archive", "2026-07-13", "legacy.eml");
  try {
    fs.mkdirSync(path.join(dataRoot, "config"), { recursive: true });
    fs.mkdirSync(path.join(dataRoot, "secrets", "applications"), { recursive: true });
    fs.mkdirSync(path.dirname(legacyMail), { recursive: true });
    fs.writeFileSync(path.join(dataRoot, "config", "site.json"), `${JSON.stringify({ schemaVersion: 1, siteId: "site_beta10", nodeId: "node_beta10", asciiDomain: "upgrade-fixture.example", displayDomain: "upgrade-fixture.example", edgeMode: "local-only", routingMode: "path" }, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(dataRoot, "secrets", "applications", "site.env"), `SITE_DOMAIN="upgrade-fixture.example"\n`, { mode: 0o600 });
    fs.writeFileSync(legacyMail, "Subject: beta10 upgrade fixture\r\n\r\nlegacy local mail", { mode: 0o600 });
    fs.mkdirSync(installRoot, { recursive: true });
    fs.symlinkSync(process.platform === "win32" ? releaseRoot : path.relative(installRoot, releaseRoot), path.join(installRoot, "current"), process.platform === "win32" ? "junction" : "dir");
    assert(fs.existsSync(path.join(installRoot, "current", "release-manifest.json")), "Packaged release fixture current pointer is invalid");
    const environment = {
      ...process.env,
      PRIVATE_SITE_DATA_ROOT: dataRoot,
      PRIVATE_SITE_INSTALL_ROOT: installRoot,
      PRIVATE_SITE_CLI_BIN: binDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    };
    const prepare = spawnSync(process.execPath, [at(manifest.entrypoints.node), "prepare"], { env: environment, encoding: "utf8", timeout: 60_000 });
    assert(prepare.status === 0, `Packaged release prepare failed: ${String(prepare.stderr || "").trim()}`);
    const prepared = JSON.parse(prepare.stdout);
    assert(prepared.mailMigration?.copied === 1 && prepared.mailMigration?.sourcesRetained === true && prepared.mailMigration?.rollbackSafe === true, "Packaged release did not safely migrate beta mail");
    const migratedSite = readJsonAbsolute(path.join(dataRoot, "config", "site.json"));
    assert(migratedSite.schemaVersion === 2 && migratedSite.connectionMode === "local-only" && !("edgeMode" in migratedSite), "Packaged release did not explicitly migrate Site state");
    const envText = fs.readFileSync(path.join(dataRoot, "secrets", "applications", "site.env"), "utf8");
    assert(/^OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN=/m.test(envText), "Packaged release did not provision the upgrade mail token");
    const migratedMail = path.join(dataRoot, "mail", "archive", "2026-07-13", "legacy.eml");
    assert(fs.existsSync(legacyMail) && fs.existsSync(migratedMail) && fs.readFileSync(migratedMail).equals(fs.readFileSync(legacyMail)), "Packaged release mail migration is not rollback-safe");
    const status = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), "mail", "status", "--json", "--data-root", dataRoot], { env: environment, encoding: "utf8", timeout: 30_000 });
    const statusBody = status.status === 0 ? JSON.parse(status.stdout) : null;
    assert(statusBody?.result?.mail?.ingress?.ready === true && statusBody.result.mail.ingress.followsCurrent === true, "Packaged release prepare did not install a valid current-following mail shim");
    const repeated = spawnSync(process.execPath, [at(manifest.entrypoints.node), "prepare"], { env: environment, encoding: "utf8", timeout: 60_000 });
    assert(repeated.status === 0 && JSON.parse(repeated.stdout).mailMigration?.copied === 0, "Packaged release prepare is not idempotent");
    const freshEnvironment = {
      ...process.env,
      PRIVATE_SITE_DATA_ROOT: freshDataRoot,
      PRIVATE_SITE_INSTALL_ROOT: installRoot,
      PRIVATE_SITE_CLI_BIN: freshBinDir,
      PATH: `${freshBinDir}${path.delimiter}${process.env.PATH || ""}`,
    };
    const freshPrepare = spawnSync(process.execPath, [at(manifest.entrypoints.node), "prepare"], { env: freshEnvironment, encoding: "utf8", timeout: 60_000 });
    assert(freshPrepare.status === 0 && JSON.parse(freshPrepare.stdout).prepared === true, `Fresh packaged release prepare failed: ${String(freshPrepare.stderr || "").trim()}`);
    const freshEnvText = fs.readFileSync(path.join(freshDataRoot, "secrets", "applications", "site.env"), "utf8");
    assert(/^OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN=/m.test(freshEnvText), "Fresh packaged release prepare did not provision the mail token");
    const freshInit = spawnSync(process.execPath, [at(manifest.entrypoints.node), "init", "--domain", "fresh-fixture.example", "--data-root", freshDataRoot], { env: freshEnvironment, encoding: "utf8", timeout: 30_000 });
    assert(freshInit.status === 0, `Fresh packaged release initialization failed: ${String(freshInit.stderr || "").trim()}`);
    const freshStatus = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), "mail", "status", "--json", "--data-root", freshDataRoot], { env: freshEnvironment, encoding: "utf8", timeout: 30_000 });
    assert(freshStatus.status === 0 && JSON.parse(freshStatus.stdout).result?.mail?.ingress?.ready === true, "Fresh packaged release did not retain valid prepared mail state");
    return { explicitPrepare: true, freshPrepared: true, upgradeTokenProvisioned: true, stableShims: true, legacyMailMigrated: true, rollbackSourceRetained: true, idempotent: true };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function verifyMailTransportBoundary() {
  const forbiddenPorts = new Set([25, 465, 587, 993]);
  const packagePaths = [
    "package.json",
    "projects/core/node/package.json",
    "projects/core/open-agent-bridge/package.json",
    "projects/edge/package.json",
  ].filter((relative) => fs.existsSync(at(relative)));
  for (const relative of packagePaths) {
    const metadata = readJson(relative);
    const dependencies = Object.keys({ ...(metadata.dependencies || {}), ...(metadata.optionalDependencies || {}) });
    for (const dependency of dependencies) {
      assert(!/^(?:smtp-server|imapflow|haraka|mailin|postal)$/i.test(dependency), `Node release bundles a raw mail server dependency: ${relative} -> ${dependency}`);
    }
  }

  const distribution = readJson("registry/site-distribution.json");
  for (const service of distribution.services || []) {
    assert(!forbiddenPorts.has(Number(service.port)), `Node service registry exposes a raw mail port: ${service.port}`);
  }
  const routeRegistry = readJson("registry/routes.json");
  const routeText = JSON.stringify(routeRegistry);
  assert(!/smtp|imaps?/i.test(routeText), "Node route registry contains a managed raw mail route");

  const scanRoots = [
    "projects/core/node",
    "projects/core/open-agent-bridge",
    "projects/edge",
  ].filter((relative) => fs.existsSync(at(relative)));
  const runtimeFiles = scanRoots.flatMap((relative) => listFiles(at(relative)))
    .filter((file) => /\.(?:js|mjs|cjs|ts|conf)$/i.test(file));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(releaseRoot, file).replaceAll("\\", "/");
    assert(!/(?:from\s*["']smtp-server["']|require\(\s*["']smtp-server["']\s*\)|new\s+SMTPServer\b|from\s*["']imapflow["'])/i.test(source), `Node runtime contains a bundled SMTP/IMAP server: ${relative}`);
    assert(!/(?:\.listen\s*\(\s*(?:25|465|587|993)\b|\blisten\s+(?:25|465|587|993)\b)/i.test(source), `Node runtime listens on a raw mail port: ${relative}`);
  }
  return {
    bundledSmtpAbsent: true,
    managedRawSmtpTunnelAbsent: true,
    managedImapsTunnelAbsent: true,
    evidence: {
      packageManifestsScanned: packagePaths.length,
      runtimeFilesScanned: runtimeFiles.length,
      forbiddenPorts: [...forbiddenPorts],
      routeRegistryScanned: true,
    },
  };
}

function verifyLayout() {
  assert(manifest.releaseType === "private-site-node", "Invalid Node release type");
  assert(manifest.dirty === false, "Production Node release must be built from a clean worktree");
  assert(manifest.harness?.owner === "node", "Harness execution owner must be the user Node");
  assert(manifest.harness?.supportedAgentRuntime === "codex", "Node release must declare Codex as its supported Agent runtime");
  assert(manifest.harness?.developmentWorkspace === "full-git-clone", "Node release must preserve the full-clone evolution contract");
  assert(manifest.profile === "universal", "Node release profile is invalid");
  assert(manifest.entrypoints?.personalAgent === "projects/core/node/bin/personal-agent.mjs", "Node release must declare the public personal-agent entrypoint");
  assert(manifest.entrypoints?.mailIngest === "projects/core/open-agent-bridge/bin/oab-mail-ingest.mjs", "Node release must declare the local MTA mail-ingest entrypoint");
  assert(manifest.ownership?.edge?.length === 5, "Edge ownership must stay limited to the transport plane");
  for (const relative of [
    "AGENTS.md",
    "README.md",
    "README.en.md",
    "CLAUDE.md",
    ".gitignore",
    "release-manifest.json",
    "SHA256SUMS",
    "SBOM.cdx.json",
    "scripts/workspace-doctor.mjs",
    "scripts/verify-behavior-baselines.mjs",
    "scripts/project-guard.mjs",
    "scripts/skill-guard.mjs",
    "scripts/skill-tree.mjs",
    "scripts/lib/command-registry-contract.mjs",
    "scripts/setup-agent-bridge.sh",
    "scripts/install-from-github-release.mjs",
    "scripts/release-download.mjs",
    "scripts/install-hooks.sh",
    ".githooks/pre-commit",
    "package.json",
    "test/fixtures/skill-cases/personal-agent-local/case.json",
    "test/fixtures/skill-cases/content-workbench/report-input.json",
    "projects/core/node/bin/personal-agent.mjs",
    "projects/core/node/bin/private-site.mjs",
    "projects/core/node/src/command-surface.mjs",
    "projects/core/node/src/backup-scheduler.mjs",
    "projects/core/node/src/cli-shims.mjs",
    "projects/core/node/src/mail.mjs",
    "projects/core/node/src/cloud-enrollment.mjs",
    "projects/core/node/src/control-service.mjs",
    "projects/core/node/src/operations.mjs",
    "projects/core/node/src/release-pruning.mjs",
    "projects/core/node/src/platform-service.mjs",
    "projects/core/node/src/platform-wireguard.mjs",
    "projects/core/node/src/extensions.mjs",
    "projects/core/open-agent-bridge/app/server.mjs",
    "projects/core/open-agent-bridge/app/worker.mjs",
    "projects/core/open-agent-bridge/app/template-worker.mjs",
    "projects/core/open-agent-bridge/bin/oab.mjs",
    "projects/core/open-agent-bridge/bin/oab-mail-ingest.mjs",
    "projects/core/admin-panel/server.mjs",
    "scripts/install-private-site-node-release.mjs",
    "scripts/personal-agent-command.mjs",
    "scripts/deploy-private-site-node.mjs",
    "registry/skills.json",
    "registry/capabilities.json",
    "registry/routes.json",
    "registry/extensions.json",
    "registry/commands.json",
    "schemas/personal-agent/capabilities.schema.json",
    "schemas/personal-agent/commands.schema.json",
    "schemas/personal-agent/operations.schema.json",
    "registry/behavior-baselines.json",
    "docs/adr/0001-node-product-boundary-freeze.md",
    "test/fixtures/baseline-cases/release-installation/case.json",
    "test/fixtures/baseline-cases/authenticated-login/case.json",
    "test/fixtures/baseline-cases/agent-conversation/case.json",
    "test/fixtures/baseline-cases/wechat-conversation-channel/case.json",
    "test/fixtures/baseline-cases/xiaohongshu-managed-platform/case.json",
    "test/fixtures/baseline-cases/pages-publication/case.json",
    "test/fixtures/baseline-cases/encrypted-backup-restore/case.json",
    "test/fixtures/baseline-cases/previous-release-rollback/case.json",
    "registry/site-distribution.json",
    "skills/personal-agent/SKILL.md",
    "skills/personal-agent/references/acceptance.md",
    "test/fixtures/skill-cases/personal-agent-acceptance/case.json",
    "test/fixtures/skill-cases/personal-agent-acceptance/expected.json",
    "skills/content-workbench/scripts/render-report.mjs",
    "skills/deep-research/SKILL.md",
    "skills/knowledge-capture/SKILL.md",
    "skills/content-workbench/SKILL.md",
    "skills/visual-content/SKILL.md",
    "skills/media-toolkit/SKILL.md",
    "workflows/project-iteration.md",
    "workflows/local-mail.md",
    "workflows/examples/postfix-personal-agent.pipe.example",
    ".local/files",
  ]) assert(fs.existsSync(at(relative)), `Node release is missing ${relative}`);
  assert(!fs.existsSync(at("projects/personal")), "Public Node release must not contain personal projects");
}

function verifyChecksums() {
  for (const line of fs.readFileSync(at("SHA256SUMS"), "utf8").trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    assert(match, `Invalid checksum line: ${line}`);
    const file = path.resolve(releaseRoot, match[2]);
    assert(file.startsWith(`${releaseRoot}${path.sep}`) && fs.statSync(file).isFile(), `Unsafe checksum path: ${match[2]}`);
    assert(sha256(file) === match[1], `Checksum mismatch: ${match[2]}`);
  }
}

function verifySecurityBoundary() {
  for (const file of listFiles(releaseRoot)) {
    const relative = path.relative(releaseRoot, file).replaceAll("\\", "/");
    const parts = relative.split("/");
    const base = parts.at(-1) || "";
    assert(!parts.includes("secrets"), `Secret directory leaked into Node release: ${relative}`);
    assert(base !== "auth.json" && base !== "config.toml", `Credential file leaked into Node release: ${relative}`);
    assert(base !== ".env" && !base.startsWith(".env."), `Environment file leaked into Node release: ${relative}`);
    assert(!/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|db-wal|db-shm)$/i.test(base), `Private runtime file leaked into Node release: ${relative}`);
    assert(!["deploy-open-agent-bridge.sh", "install-open-agent-bridge-release.sh", "verify-open-agent-bridge-server.sh"].includes(base), `Legacy ECS application deployment leaked into Node release: ${relative}`);
  }
}

function verifyProjectOwnership() {
  const registry = readJson("registry/projects.json");
  for (const project of registry.projects) {
    if (["personal-agent-node", "private-site-edge"].includes(project.name)) continue;
    const runtime = project.runtime || {};
    assert(runtime.managedBy === "private-site-node" || runtime.type === "static", `${project.name} is not owned by the Node supervisor`);
    assert(!runtime.systemd && !runtime.workerSystemd, `${project.name} declares a component-level systemd unit`);
    const serialized = JSON.stringify(runtime);
    assert(!serialized.includes("/opt/personal-agent.local") && !serialized.includes("/var/lib/personal-agent.local") && !serialized.includes("/etc/personal-agent.local"), `${project.name} contains legacy ECS application paths`);
  }
}

function verifyHarness() {
  const catalog = readJson("registry/skills.json");
  const skillNames = (catalog.skills || []).map((skill) => skill.name || skill.id).filter(Boolean);
  assert(skillNames.length > 0, "Skill catalog is empty");
  for (const name of skillNames) assert(fs.existsSync(at("skills", name, "SKILL.md")), `Cataloged skill is missing: ${name}`);
  verifyHarnessLinks(releaseRoot);
  assert(harnessLinks.length === 5, "Harness link contract is incomplete");
  for (const bridge of manifest.harness.compatibilityBridges) for (const name of skillNames) assert(fs.existsSync(at(bridge, name, "SKILL.md")), `${bridge} is missing ${name}`);
  const server = fs.readFileSync(at("projects/core/open-agent-bridge/app/server.mjs"), "utf8");
  const worker = fs.readFileSync(at("projects/core/open-agent-bridge/app/worker.mjs"), "utf8");
  assert(server.includes("worker/hook/completed"), "Bridge bundle is missing Harness completion hooks");
  assert(server.includes("worker/hook/created"), "Bridge bundle is missing Harness creation hooks");
  assert(worker.includes("appServerCommand"), "Worker bundle is missing local Codex app-server support");
  assert(worker.includes("codexSessionSync"), "Worker bundle is missing local Codex session synchronization");
  assert(server.includes("data-status"), "Bridge bundle is missing channel status markers");
  assert(server.includes("data-detail"), "Bridge bundle is missing channel detail markers");
}

async function verifyCommandRegistry() {
  const [{ validateCommandRegistry }, { HANDLED_COMMAND_KEYS, expandCommandName }] = await Promise.all([
    import(pathToFileURL(at("scripts/lib/command-registry-contract.mjs"))),
    import(pathToFileURL(at("projects/core/node/src/command-surface.mjs"))),
  ]);
  const registry = readJson("registry/commands.json");
  const schema = readJson("schemas/personal-agent/commands.schema.json");
  const capabilities = readJson("registry/capabilities.json");
  const capabilityIds = new Set(capabilities.capabilities.map((entry) => entry.id));
  const result = validateCommandRegistry({ registry, schema, capabilityIds, handledCommandKeys: HANDLED_COMMAND_KEYS });
  assert(result.ok, `Bundled command registry contract failed: ${result.errors.join("; ")}`);
  return expandCommandName;
}

function verifyEntrypoints(expandBundledCommandName) {
  for (const relative of Object.values(manifest.entrypoints)) {
    const result = spawnSync(process.execPath, ["--check", at(relative)], { encoding: "utf8" });
    assert(result.status === 0, `${relative} failed node --check: ${String(result.stderr || "").trim()}`);
  }
  for (const expectation of [
    { args: ["help", "--json"], visibility: "implemented", groups: ["implemented"] },
    { args: ["help", "--preview", "--json"], visibility: "preview", groups: ["implemented", "preview"] },
    { args: ["help", "--all", "--json"], visibility: "all", groups: ["implemented", "preview", "planned"] },
  ]) {
    const help = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), ...expectation.args], { encoding: "utf8", timeout: 30_000 });
    assert(help.status === 0, `Bundled Harness CLI failed (${expectation.args.join(" ")}): ${String(help.stderr || "").trim()}`);
    const body = JSON.parse(help.stdout);
    assert(body.ok === true && body.result?.visibility === expectation.visibility, `Bundled Harness CLI returned the wrong help visibility: ${expectation.visibility}`);
    assert(JSON.stringify(Object.keys(body.result.commandGroups)) === JSON.stringify(expectation.groups), `Bundled Harness CLI exposed the wrong command groups: ${expectation.visibility}`);
  }
  const plannedLeaves = readJson("registry/commands.json").commands
    .filter((entry) => entry.implementationStatus === "planned")
    .flatMap((entry) => expandBundledCommandName(entry.name));
  assert(plannedLeaves.length > 0, "Bundled command registry has no planned leaves to verify");
  for (const command of plannedLeaves) {
    for (const optIn of [[], ["--preview"]]) {
      const result = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), ...command.split(" "), ...optIn, "--json"], { encoding: "utf8", timeout: 30_000 });
      assert(result.status === 7, `Planned command did not fail closed: ${command} ${optIn.join(" ")}`);
      const error = JSON.parse(result.stderr);
      assert(error.error?.code === "CAPABILITY_UNAVAILABLE", `Planned command returned the wrong error: ${command} ${optIn.join(" ")}`);
    }
  }
  const supervisor = fs.readFileSync(at("projects/core/node/src/supervisor.mjs"), "utf8");
  assert(supervisor.includes("windowsHide: true"), "Supervisor must hide Windows child processes");
  assert(!supervisor.includes('"--import", "tsx"'), "Supervisor must not fall back to a development Bridge server");
  assert(!supervisor.includes('".next", "standalone"'), "Supervisor must not run from a development Next.js directory");
}

async function verifyMailArtifact(mailTransportBoundary) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "personal-agent-mail-artifact-")));
  const dataRoot = path.join(root, "data");
  const mailDir = path.join(dataRoot, "mail");
  const installRoot = path.join(root, "install");
  const binDir = path.join(root, "bin");
  const port = await availablePort();
  let output = "";
  const [{ initializeSite }, { prepareBridgeCliShims, bridgeCliInvocation }, backup, { createPrivateSiteGateway }] = await Promise.all([
    import(pathToFileURL(at("projects/core/node/src/config.mjs"))),
    import(pathToFileURL(at("projects/core/node/src/cli-shims.mjs"))),
    import(pathToFileURL(at("projects/core/node/src/backup.mjs"))),
    import(pathToFileURL(at("projects/core/node/src/gateway.mjs"))),
  ]);
  const initialized = initializeSite({ domain: "release-fixture.example", dataRoot, distributionVersion: manifest.distributionVersion });
  const apiToken = initialized.config.env.OPEN_AGENT_BRIDGE_API_TOKEN;
  const ingestToken = initialized.config.env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN;
  fs.mkdirSync(installRoot, { recursive: true });
  fs.symlinkSync(
    process.platform === "win32" ? releaseRoot : path.relative(installRoot, releaseRoot),
    path.join(installRoot, "current"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert(fs.existsSync(path.join(installRoot, "current", "release-manifest.json")), "Packaged mail fixture current pointer is invalid");
  const shimConfig = { ...initialized.config, ports: { ...initialized.config.ports, bridge: port } };
  const shimStatus = prepareBridgeCliShims(shimConfig, {
    installRoot,
    binDir,
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}` },
  });
  assert(shimStatus.mailIngest.ready && shimStatus.mailIngest.followsCurrent, "Packaged mail ingest shim does not follow the active release");
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    PRIVATE_SITE_DATA_ROOT: dataRoot,
    OPEN_AGENT_BRIDGE_HOST: "127.0.0.1",
    OPEN_AGENT_BRIDGE_PORT: String(port),
    OPEN_AGENT_BRIDGE_DATA_DIR: path.join(dataRoot, "databases", "bridge"),
    OPEN_AGENT_BRIDGE_AGENT_DATA_DIR: path.join(dataRoot, "databases", "agent-data"),
    OPEN_AGENT_BRIDGE_AUTOMATION_DATA_DIR: path.join(dataRoot, "databases", "automations"),
    OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: mailDir,
    OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${port}`,
    OPEN_AGENT_BRIDGE_API_TOKEN: apiToken,
    OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN: ingestToken,
    PRIVATE_SITE_INSTALL_ROOT: installRoot,
    PRIVATE_SITE_CLI_BIN: binDir,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    PERSONAL_AGENT_AUTH_PASSWORD: "artifact-mail-password",
    PERSONAL_AGENT_AUTH_COOKIE_SECRET: "artifact-mail-cookie-secret-with-enough-length",
    OPEN_AGENT_BRIDGE_CHANNEL_POLL: "0",
    OPEN_AGENT_BRIDGE_SCHEDULER: "0",
  };
  const child = spawn(process.execPath, [at(manifest.entrypoints.bridge)], {
    cwd: path.dirname(at(manifest.entrypoints.bridge)),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  let gateway = null;
  try {
    await waitForHttp(`http://127.0.0.1:${port}/health`, child, () => output);
    gateway = createPrivateSiteGateway({ config: {
      ...initialized.config,
      ports: { ...initialized.config.ports, bridge: port },
      gateway: { ...initialized.config.gateway, host: "127.0.0.1", port: 0 },
    } }).server;
    await new Promise((resolve, reject) => {
      gateway.once("error", reject);
      gateway.listen(0, "127.0.0.1", resolve);
    });
    const gatewayPort = gateway.address().port;
    const gatewayHeaders = { host: initialized.config.domain };
    const raw = Buffer.from([
      "From: Release Fixture <sender@example.test>",
      "To: bills@example.site",
      "Subject: Release artifact mail smoke",
      "Message-ID: <release-artifact-mail@example.test>",
      "Authentication-Results: trusted-mta.example; dmarc=pass; spf=pass; dkim=pass",
      "X-Spam-Status: Yes",
      "Content-Type: multipart/mixed; boundary=release-smoke",
      "",
      "--release-smoke",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Bundled EML ingress is operational.",
      "--release-smoke",
      "Content-Type: text/plain; name=receipt.txt",
      "Content-Disposition: attachment; filename=receipt.txt",
      "",
      "local attachment fixture",
      "--release-smoke--",
    ].join("\r\n"));
    const invocation = bridgeCliInvocation(shimStatus.mailIngest.commandPath, ["--recipient", "bills@example.site", "--sender", "sender@example.test"], { env: environment });
    const ingested = spawnSync(invocation.command, invocation.args, {
      cwd: path.dirname(shimStatus.mailIngest.commandPath),
      env: environment,
      input: raw,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert(ingested.status === 0, `Bundled mail ingest failed: ${String(ingested.stderr || ingested.stdout).trim()}`);
    const receipt = JSON.parse(ingested.stdout);
    assert(receipt.ok === true && /^[a-f0-9]{64}$/.test(receipt.sha256 || ""), "Bundled mail ingest returned an invalid receipt");
    const archivePath = path.join(mailDir, "archive", new Date().toISOString().slice(0, 10), `${receipt.sha256}.eml`);
    assert(fs.existsSync(archivePath), "Bundled mail ingest did not archive EML under PRIVATE_SITE_DATA_ROOT/mail");
    assert(fs.readFileSync(archivePath).equals(raw), "Bundled mail ingest changed the archived EML");
    const events = await fetch(`http://127.0.0.1:${port}/api/agent-automations/events?sourceId=src_mail_agent`, { headers: { authorization: `Bearer ${apiToken}` } });
    const body = await events.json();
    assert(events.ok && body.events?.some((event) => event.id === receipt.eventId), "Bundled mail ingest did not create an automation event");
    const event = body.events.find((candidate) => candidate.id === receipt.eventId);
    assert(path.resolve(event.payload?.rawPath || "") === path.resolve(archivePath), "Mail event does not reference the local archived EML");
    assert(event.payload?.attachments?.some((attachment) => attachment.name === "receipt.txt"), "Bundled mail ingest did not retain local attachment metadata");

    const oldMailPath = await fetch(`http://127.0.0.1:${gatewayPort}/mail`, { headers: gatewayHeaders, redirect: "manual" });
    assert(oldMailPath.status === 404, "Gateway still exposes the legacy /mail path");
    const unauthorizedMail = await fetch(`http://127.0.0.1:${gatewayPort}/app/mail`, { headers: { ...gatewayHeaders, accept: "text/html" }, redirect: "manual" });
    assert(unauthorizedMail.status === 302 && /^\/login\?return_to=/.test(unauthorizedMail.headers.get("location") || ""), "Bundled /app/mail is not authentication protected");
    const protectedMail = await fetch(`http://127.0.0.1:${gatewayPort}/app/mail?message=${encodeURIComponent(receipt.eventId)}`, { headers: { ...gatewayHeaders, authorization: `Bearer ${apiToken}` } });
    const protectedHtml = await protectedMail.text();
    assert(protectedMail.ok && protectedHtml.includes("receipt.txt"), "Authenticated mail reader did not render the ingested attachment");
    assert(!protectedHtml.includes(archivePath), "Authenticated mail reader exposed a local archive path");
    const attachment = await fetch(`http://127.0.0.1:${gatewayPort}/app/mail/messages/${encodeURIComponent(receipt.eventId)}/attachments/0`, { headers: { ...gatewayHeaders, authorization: `Bearer ${apiToken}` } });
    assert(attachment.ok && (await attachment.text()).includes("local attachment fixture"), "Authenticated mail reader did not serve the local attachment");

    const unauthorizedChat = await fetch(`http://127.0.0.1:${gatewayPort}/app/chat`, { headers: { ...gatewayHeaders, accept: "text/html" }, redirect: "manual" });
    assert(unauthorizedChat.status === 302 && /^\/login\?return_to=/.test(unauthorizedChat.headers.get("location") || ""), "Bundled local Web conversation is not authentication protected");
    const chatPage = await fetch(`http://127.0.0.1:${gatewayPort}/app/chat`, { headers: { ...gatewayHeaders, authorization: `Bearer ${apiToken}` } });
    const chatHtml = await chatPage.text();
    assert(chatPage.ok && /api\/chat\/sessions\?/.test(chatHtml), "Bundled local Web conversation page is not operational");
    const createdSessionResponse = await fetch(`http://127.0.0.1:${gatewayPort}/api/chat/bridge/sessions`, {
      method: "POST",
      headers: { ...gatewayHeaders, authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "new", title: "Release Web conversation smoke", taskDescription: "Artifact-local conversation" }),
    });
    const createdSession = await createdSessionResponse.json();
    assert(createdSessionResponse.ok && createdSession.session?.id, "Bundled local Web conversation could not create a session");
    const conversationFixture = "release-local-web-conversation-fixture";
    const actionResponse = await fetch(`http://127.0.0.1:${gatewayPort}/api/chat/bridge/sessions/${encodeURIComponent(createdSession.session.id)}/actions`, {
      method: "POST",
      headers: { ...gatewayHeaders, authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "send", content: conversationFixture }),
    });
    const action = await actionResponse.json();
    assert(actionResponse.ok && action.command?.id && action.session?.id === createdSession.session.id, "Bundled local Web conversation did not persist input");
    const conversationPage = await fetch(`http://127.0.0.1:${gatewayPort}/app/chat/session/${encodeURIComponent(createdSession.session.id)}/live`, { headers: { ...gatewayHeaders, authorization: `Bearer ${apiToken}` } });
    assert(conversationPage.ok && (await conversationPage.text()).includes(conversationFixture), "Bundled local Web conversation did not render persisted input");

    if (gateway?.listening) await new Promise((resolve) => gateway.close(resolve));
    gateway = null;
    await stopChild(child);
    const stateBeforeReadOnlyCommands = snapshotTree(dataRoot);
    const cliEnvironment = { ...environment, PRIVATE_SITE_DATA_ROOT: dataRoot };
    const status = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), "mail", "status", "--json", "--data-root", dataRoot], { env: cliEnvironment, encoding: "utf8", timeout: 30_000 });
    assert(status.status === 0, `Bundled mail status failed: ${String(status.stderr || "").trim()}`);
    const statusBody = JSON.parse(status.stdout);
    assert(statusBody.result?.mail?.ingress?.ready === true, "Bundled mail status did not observe the installed current-following shim");
    assert(!status.stdout.includes(apiToken) && !status.stdout.includes(ingestToken), "Bundled mail status exposed a token");
    assert(JSON.stringify(snapshotTree(dataRoot)) === JSON.stringify(stateBeforeReadOnlyCommands), "Bundled R0 mail status rewrote Site state");
    const doctor = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), "doctor", "--json", "--data-root", dataRoot], { env: cliEnvironment, encoding: "utf8", timeout: 30_000 });
    assert(doctor.status === 0 && JSON.parse(doctor.stdout).result?.healthy === true, `Bundled doctor failed: ${String(doctor.stderr || "").trim()}`);
    assert(JSON.stringify(snapshotTree(dataRoot)) === JSON.stringify(stateBeforeReadOnlyCommands), "Bundled R0 doctor rewrote Site state");
    const blockedPlan = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), "mail", "plan", "--json", "--data-root", dataRoot], { env: cliEnvironment, encoding: "utf8", timeout: 30_000 });
    assert(blockedPlan.status === 7 && JSON.parse(blockedPlan.stderr).error?.code === "CAPABILITY_UNAVAILABLE", "Bundled mail plan executed without preview opt-in");
    const previewPlan = spawnSync(process.execPath, [at(manifest.entrypoints.personalAgent), "mail", "plan", "--preview", "--json", "--data-root", dataRoot], { env: cliEnvironment, encoding: "utf8", timeout: 30_000 });
    assert(previewPlan.status === 0, `Bundled preview mail plan failed: ${String(previewPlan.stderr || "").trim()}`);
    const planBody = JSON.parse(previewPlan.stdout);
    assert(planBody.result?.plan?.mutates === false && planBody.result?.plan?.smtpServerBundled === false, "Bundled mail plan crossed the user-managed MTA boundary");
    assert(planBody.warnings?.some((warning) => warning.code === "PREVIEW_COMMAND"), "Bundled preview mail plan omitted its preview warning");
    assert(JSON.stringify(snapshotTree(dataRoot)) === JSON.stringify(stateBeforeReadOnlyCommands), "Bundled preview mail plan rewrote Site state");

    const archive = path.join(root, "mail-backup.psb");
    const keyFile = path.join(root, "mail-backup.key");
    const restored = path.join(root, "restored");
    await backup.createEncryptedBackup(initialized.config, { outputPath: archive, keyFile });
    await backup.verifyEncryptedBackup(initialized.config, { archivePath: archive, keyFile, targetDir: restored });
    assert(fs.readFileSync(path.join(restored, "mail", path.relative(mailDir, archivePath))).equals(raw), "Regular backup/restore did not retain local mail");

    return {
      localMail: {
        mtaUserManaged: true,
        bundledSmtpAbsent: mailTransportBoundary.bundledSmtpAbsent,
        ingestShimInstalled: true,
        realEmlIngested: true,
        messageLocalOnly: true,
        attachmentsLocalOnly: true,
        backupRestorePassed: true,
        appMailAuthenticated: true,
        managedRawSmtpTunnelAbsent: mailTransportBoundary.managedRawSmtpTunnelAbsent,
        managedImapsTunnelAbsent: mailTransportBoundary.managedImapsTunnelAbsent,
        statusReadOnly: true,
        planPreviewOnly: true,
        transportBoundaryEvidence: mailTransportBoundary.evidence,
      },
      webConversation: {
        releaseAssetRuntime: false,
        route: "/app/chat",
        authenticated: true,
        uniquePrompt: false,
        realAgentRuntime: false,
        sameSessionAgentReply: false,
        wechatRequired: false,
      },
    };
  } finally {
    if (gateway?.listening) await new Promise((resolve) => gateway.close(resolve));
    await stopChild(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  if (await exitsWithin(exited, 5_000)) return;
  if (process.platform === "win32") {
    const terminated = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    if (terminated.status === 0 || !processExists(child.pid)) return;
    throw new Error(`Bundled Bridge taskkill failed with ${terminated.status}`);
  }
  child.kill("SIGKILL");
  if (!await exitsWithin(exited, 5_000)) throw new Error("Bundled Bridge did not stop after forced termination");
}

function processExists(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function exitsWithin(exited, timeoutMilliseconds) {
  let timer;
  try {
    return await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMilliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function snapshotTree(root) {
  const entries = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replaceAll("\\", "/");
      const stat = fs.lstatSync(target);
      if (entry.isDirectory()) {
        entries.push({ path: relative, type: "directory", mode: stat.mode & 0o777 });
        walk(target);
      } else if (entry.isFile()) {
        entries.push({ path: relative, type: "file", mode: stat.mode & 0o777, sha256: sha256(target) });
      } else entries.push({ path: relative, type: "other" });
    }
  };
  walk(root);
  return entries;
}

async function waitForHttp(url, child, getOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Bundled Bridge exited during mail smoke: ${getOutput()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Bundled Bridge did not become ready for mail smoke: ${getOutput()}`);
}

async function verifyPlatformAdapters() {
  const module = await import(pathToFileURL(at("projects/core/node/src/platform-service.mjs")));
  const wireGuard = await import(pathToFileURL(at("projects/core/node/src/platform-wireguard.mjs")));
  const config = { domain: "example.site", dataRoot: "/tmp/private-site", logsDir: "/tmp/private-site/logs" };
  assert(module.renderLaunchdService(config, { cliPath: "/opt/private-site/node.mjs" }).includes("KeepAlive"), "launchd adapter is invalid");
  assert(module.renderSystemdUserService(config, { cliPath: "/opt/private-site/node.mjs" }).includes("Restart=on-failure"), "systemd adapter is invalid");
  const windows = await import(pathToFileURL(at("projects/core/node/src/windows-service.mjs")));
  const windowsTask = windows.renderWindowsScheduledTask(config, { cliPath: "C:\\private-site\\node.mjs", userId: "EXAMPLE\\owner" });
  assert(windowsTask.includes("InteractiveToken"), "Windows user task adapter is invalid");
  assert(windowsTask.includes("<Hidden>true</Hidden>"), "Windows user task must be hidden");
  for (const platform of ["win32", "darwin", "linux"]) assert(wireGuard.wireGuardLifecycle("/tmp/private-site.conf", platform).installCommand, `WireGuard adapter is missing for ${platform}`);
}

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(at(...parts), "utf8"));
}

function readJsonAbsolute(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function at(...parts) {
  return path.join(releaseRoot, ...parts);
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function findFile(directory, name) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return target;
    if (entry.isDirectory()) {
      const match = findFile(target, name);
      if (match) return match;
    }
  }
  return null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
