#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { harnessLinks, verifyHarnessLinks } from "./harness-links.mjs";

const releaseRoot = path.resolve(process.argv[2] || "");
if (!releaseRoot || !fs.existsSync(releaseRoot)) throw new Error("Usage: verify-private-site-node-dist.mjs <release-root>");
const manifest = readJson("release-manifest.json");

await main();

async function main() {
  verifyLayout();
  verifyChecksums();
  verifySecurityBoundary();
  verifyProjectOwnership();
  verifyHarness();
  const expandBundledCommandName = await verifyCommandRegistry();
  verifyEntrypoints(expandBundledCommandName);
  await verifyPlatformAdapters();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    releaseId: manifest.releaseId,
    revision: manifest.revision,
    harnessOwner: manifest.harness.owner,
    skills: fs.readdirSync(at("skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length,
  }, null, 2)}\n`);
}

function verifyLayout() {
  assert(manifest.releaseType === "private-site-node", "Invalid Node release type");
  assert(manifest.dirty === false, "Production Node release must be built from a clean worktree");
  assert(manifest.harness?.owner === "node", "Harness execution owner must be the user Node");
  assert(manifest.harness?.supportedAgentRuntime === "codex", "Node release must declare Codex as its supported Agent runtime");
  assert(manifest.harness?.developmentWorkspace === "full-git-clone", "Node release must preserve the full-clone evolution contract");
  assert(manifest.profile === "universal", "Node release profile is invalid");
  assert(manifest.entrypoints?.personalAgent === "projects/core/node/bin/personal-agent.mjs", "Node release must declare the public personal-agent entrypoint");
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
