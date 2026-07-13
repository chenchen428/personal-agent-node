#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { pruneLocalDist } from "./prune-local-dist.mjs";
import { materializeHarnessLinks } from "./harness-links.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspacePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const distribution = JSON.parse(fs.readFileSync(path.join(root, "registry", "node-distribution.json"), "utf8"));
const profileName = args.profile || "universal";
const profile = distribution.profiles[profileName];
if (!profile) throw new Error(`Unknown Node distribution profile: ${profileName}`);
const includedExtensionIds = new Set(profile.extensions || []);
const revision = sourceRevision();
const releaseId = args.releaseId || `${timestamp()}-${revision.commit.slice(0, 12)}${revision.dirty ? "-dirty" : ""}`;
const outputRoot = path.resolve(args.output || path.join(root, "dist", "private-site-node", releaseId));
const releasesRoot = path.join(root, "dist", "private-site-node");
const bridgeSource = path.join(root, "projects", "core", "open-agent-bridge");
const requireFromBridge = createRequire(path.join(bridgeSource, "package.json"));
const { build } = requireFromBridge("esbuild");

await main();

async function main() {
  assertInputs();
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  copyRuntimeInputs();
  await bundleNodeApplications();
  materializeHarnessBridges();
  writeRuntimePackages();
  normalizeShellScripts();
  writeManifest();
  writeChecksums();
  const retention = path.dirname(outputRoot) === releasesRoot
    ? pruneLocalDist(releasesRoot, { keep: 2, preserve: [outputRoot] })
    : { root: releasesRoot, keep: 2, retained: [], removed: [], skipped: "custom-output" };

  process.stdout.write(`${JSON.stringify({
    ok: true,
    releaseId,
    revision: revision.commit,
    dirty: revision.dirty,
    outputRoot,
    files: listFiles(outputRoot).length,
    retention,
  }, null, 2)}\n`);
}

function copyRuntimeInputs() {
  for (const relative of [
    "projects/core/node/bin",
    "projects/core/node/src",
    "projects/core/node/package.json",
    "projects/core/node/README.md",
    "skills",
    "workflows",
    "registry",
    "schemas/private-site",
    "schemas/personal-agent",
    "scripts",
    "docs",
    "test/fixtures",
    ".githooks",
    ".gitignore",
    "package.json",
    "AGENTS.md",
    "README.md",
    "LICENSE",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "TRADEMARKS.md",
    "THIRD_PARTY_NOTICES.md",
  ]) copy(relative);
  copyNodeProductionDependencies();
  copy("projects/core/admin-panel");
  copy("projects/core/channels");
  writeProfileRegistries();
  fs.mkdirSync(path.join(outputRoot, "projects", "core", "open-agent-bridge", "app"), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, "projects", "core", "open-agent-bridge", "bin"), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, "projects", "core", "open-agent-bridge", "public", "pages"), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, "projects", "core", "open-agent-bridge", "public", "uploads"), { recursive: true });
  fs.mkdirSync(path.join(outputRoot, ".local", "files"), { recursive: true });
}

async function bundleNodeApplications() {
  const entries = [
    [path.join(bridgeSource, "src", "server", "server.ts"), path.join(outputRoot, "projects", "core", "open-agent-bridge", "app", "server.mjs")],
    [path.join(bridgeSource, "vendor", "agent-bridge", "lib", "_worker-entry.mjs"), path.join(outputRoot, "projects", "core", "open-agent-bridge", "app", "worker.mjs")],
    [path.join(bridgeSource, "src", "automation", "template-worker.mjs"), path.join(outputRoot, "projects", "core", "open-agent-bridge", "app", "template-worker.mjs")],
    [path.join(bridgeSource, "bin", "oab.mjs"), path.join(outputRoot, "projects", "core", "open-agent-bridge", "bin", "oab.mjs")],
    [path.join(root, "projects", "core", "admin-panel", "server.mjs"), path.join(outputRoot, "projects", "core", "admin-panel", "server.mjs")],
  ];
  await Promise.all(entries.map(([entryPoint, outfile]) => build({
    entryPoints: [entryPoint],
    outfile,
    absWorkingDir: root,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    treeShaking: true,
    sourcemap: false,
    legalComments: "none",
    banner: { js: "import { createRequire as __privateSiteCreateRequire } from 'node:module'; const require = __privateSiteCreateRequire(import.meta.url);" },
  })));
  for (const [, filePath] of entries) fs.chmodSync(filePath, 0o755);
}

function materializeHarnessBridges() {
  materializeHarnessLinks(outputRoot);
}

function writeRuntimePackages() {
  const bridgePackage = JSON.parse(fs.readFileSync(path.join(bridgeSource, "package.json"), "utf8"));
  fs.writeFileSync(path.join(outputRoot, "projects", "core", "open-agent-bridge", "package.json"), `${JSON.stringify({
    name: bridgePackage.name,
    version: bridgePackage.version,
    private: true,
    type: "module",
    bin: { "open-abg": "bin/oab.mjs", oab: "bin/oab.mjs" },
    scripts: { start: "node app/server.mjs", worker: "node app/worker.mjs" },
    engines: { node: ">=22 <24" },
  }, null, 2)}\n`);
}

function writeManifest() {
  const entrypoints = {
    personalAgent: "projects/core/node/bin/personal-agent.mjs",
    node: "projects/core/node/bin/private-site.mjs",
    bridge: "projects/core/open-agent-bridge/app/server.mjs",
    worker: "projects/core/open-agent-bridge/app/worker.mjs",
    harnessCli: "projects/core/open-agent-bridge/bin/oab.mjs",
    admin: "projects/core/admin-panel/server.mjs",
  };
  const manifest = {
    schemaVersion: 1,
    releaseType: "private-site-node",
    releaseId,
    revision: revision.commit,
    dirty: revision.dirty,
    createdAt: new Date().toISOString(),
    protocolVersion: "1.0",
    distributionVersion: workspacePackage.version,
    profile: profileName,
    extensions: [...includedExtensionIds],
    runtime: { node: ">=22 <24", platforms: ["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] },
    ownership: {
      node: ["agent", "codex-app-server", "harness", "worker", "skills", "workflows", "channels", "private-data", "files", "publications", "backups"],
      edge: ["https-entry", "acme", "wireguard-relay", "origin-mtls", "routing-metadata"],
    },
    entrypoints,
    harness: {
      owner: "node",
      supportedAgentRuntime: "codex",
      developmentWorkspace: "full-git-clone",
      compatibilityBridges: [".agents/skills", ".codex/skills", ".claude/skills", ".cursor/skills"],
      catalog: "registry/skills.json",
      workflows: "workflows",
      sessionState: "PRIVATE_SITE_DATA_ROOT/databases/bridge",
    },
    excluded: ["secrets", "environment-files", "runtime-data", "development-servers", "platform-specific-channel-binaries"],
  };
  fs.writeFileSync(path.join(outputRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const sbom = execFileSync("npm", ["sbom", "--omit=dev", "--sbom-format", "cyclonedx"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(outputRoot, "SBOM.cdx.json"), `${JSON.stringify(JSON.parse(sbom), null, 2)}\n`);
}

function writeChecksums() {
  const lines = listFiles(outputRoot)
    .map((file) => path.relative(outputRoot, file).replaceAll("\\", "/"))
    .filter((relative) => relative !== "SHA256SUMS")
    .map((relative) => `${sha256(path.join(outputRoot, relative))}  ${relative}`);
  fs.writeFileSync(path.join(outputRoot, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

function copy(relative) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing Node release input: ${relative}`);
  const target = path.join(outputRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, preserveTimestamps: true, filter: safePath });
}

function copyNodeProductionDependencies() {
  const targetRoot = path.join(outputRoot, "projects", "core", "node", "node_modules");
  for (const name of ["eventemitter3", "follow-redirects", "http-proxy", "mime-db", "mime-types", "requires-port"]) {
    const source = path.join(root, "node_modules", name);
    if (!fs.existsSync(source)) throw new Error(`Missing installed Node production dependency: ${name}`);
    fs.cpSync(source, path.join(targetRoot, name), { recursive: true, preserveTimestamps: true, filter: safePath });
  }
}

function writeProfileRegistries() {
  const extensionProjects = distribution.extensions
    .filter((extension) => includedExtensionIds.has(extension.id))
    .map((extension) => extension.project);
  const allowed = new Set([...distribution.core.projects, ...extensionProjects]);
  const projectsPath = path.join(outputRoot, "registry", "projects.json");
  const projects = JSON.parse(fs.readFileSync(projectsPath, "utf8"));
  projects.projects = projects.projects.filter((project) => allowed.has(project.name));
  fs.writeFileSync(projectsPath, `${JSON.stringify(projects, null, 2)}\n`);
  const adminPath = path.join(outputRoot, "registry", "admin-panel.json");
  const admin = JSON.parse(fs.readFileSync(adminPath, "utf8"));
  admin.title = profileName === "universal" ? "Private Site Node" : admin.title;
  admin.projects = admin.projects.filter((project) => allowed.has(project.name));
  fs.writeFileSync(adminPath, `${JSON.stringify(admin, null, 2)}\n`);
}

function safePath(candidate) {
  const relative = path.relative(root, candidate).replaceAll("\\", "/");
  const parts = relative.split("/");
  const base = parts.at(-1) || "";
  if (parts.includes(".git") || parts.includes("secrets") || parts.includes(".local")) return false;
  if (base === ".DS_Store" || base === "auth.json" || base === "config.toml") return false;
  if (base === ".env" || base.startsWith(".env.")) return false;
  if (/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|db-wal|db-shm)$/i.test(base)) return false;
  return true;
}

function normalizeShellScripts() {
  for (const file of listFiles(outputRoot)) {
    if (path.extname(file).toLowerCase() !== ".sh") continue;
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  }
}

function copyTreeDereferenced(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) copyTreeDereferenced(path.join(source, entry), path.join(target, entry));
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, stat.mode);
  }
}

function listFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  walk(directory);
  return files.sort();
}

function assertInputs() {
  for (const relative of [
    "infra/node/AGENTS.md",
    "projects/core/node/bin/private-site.mjs",
    "projects/core/open-agent-bridge/src/server/server.ts",
    "projects/core/open-agent-bridge/vendor/agent-bridge/lib/_worker-entry.mjs",
    "registry/skills.json",
  ]) if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing Node release input: ${relative}`);
}

function sourceRevision() {
  try {
    return {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()),
    };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release-id") result.releaseId = argv[++index];
    else if (argv[index] === "--output") result.output = argv[++index];
    else if (argv[index] === "--profile") result.profile = argv[++index];
  }
  return result;
}
