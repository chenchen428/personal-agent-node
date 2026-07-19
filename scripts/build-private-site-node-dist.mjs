#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assembleOpenCliRuntime } from "./lib/opencli-runtime.mjs";
import { pruneLocalDist } from "./prune-local-dist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadata = readJson(path.join(root, "package.json"));
const npmInvocation = resolveNpmInvocation();
const args = parseArgs(process.argv.slice(2));
const revision = sourceRevision();
const releaseId = args.releaseId || `${timestamp()}-${revision.commit.slice(0, 12)}${revision.dirty ? "-dirty" : ""}`;
const outputRoot = path.resolve(args.output || path.join(root, "dist", "personal-agent-node", releaseId));
const releasesRoot = path.join(root, "dist", "personal-agent-node");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");

await main();

async function main() {
  assertInputs();
  if (!args.skipNextBuild) execFileSync(npmInvocation.command, [...npmInvocation.prefixArgs, "run", "app:build"], { cwd: root, stdio: "inherit" });
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  copySupportFiles();
  assembleWorkspaceSeed();
  copyNextStandalone();
  copyNativeDependencies();
  await bundleCore();
  const openCliRuntime = assembleOpenCliRuntime({ workspaceRoot: root, releaseRoot: outputRoot, npmInvocation });
  writeManifest(openCliRuntime);
  writeSbom(openCliRuntime);
  normalizeShellScripts();
  writeChecksums();
  const retention = path.dirname(outputRoot) === releasesRoot
    ? pruneLocalDist(releasesRoot, { keep: 2, preserve: [outputRoot] })
    : { root: releasesRoot, keep: 2, retained: [], removed: [], skipped: "custom-output" };
  process.stdout.write(`${JSON.stringify({ ok: true, releaseId, revision: revision.commit, dirty: revision.dirty, outputRoot, files: listFiles(outputRoot).length, retention }, null, 2)}\n`);
}

function copySupportFiles() {
  for (const relative of [
    "AGENTS.md", "DESIGN.md", "README.md", "README.en.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "TRADEMARKS.md", "THIRD_PARTY_NOTICES.md",
    "package.json", ".gitignore", ".githooks", "registry", "schemas", "skills", "workflows", "docs", "scripts", "test/fixtures",
    "core/apps", "core/channels", "core/plugins", "core/runtime/contracts", "core/runtime/native", "core/runtime/README.md", "core/agent/public", "core/agent/README.md",
    "infra/edge/install-self-hosted-relay.sh",
  ]) copy(relative);
  fs.rmSync(path.join(outputRoot, "scripts", "build-private-site-node-dist.mjs"), { force: true });
  fs.rmSync(path.join(outputRoot, "core", "plugins", "runtime"), { recursive: true, force: true });
}

function assembleWorkspaceSeed() {
  copy("workspace");
  // Personal Apps are user-owned content. Never turn repository examples or
  // other source-checkout Apps into installation seeds.
  fs.rmSync(path.join(outputRoot, "workspace", "apps"), { recursive: true, force: true });
  for (const [source, target] of [
    ["skills", "workspace/skills"],
    ["workflows", "workspace/workflows"],
    ["registry", "workspace/registry"],
  ]) copyTo(source, target);
  for (const script of ["skill-tree.mjs", "skill-guard.mjs", "setup-agent-bridge.sh"]) copyTo(`scripts/${script}`, `workspace/scripts/${script}`);
  for (const directory of ["apps", "plugins", "files", "publications", "databases", "mail", "backups", "config", "secrets", "runtime", "logs", "data"]) {
    fs.mkdirSync(path.join(outputRoot, "workspace", directory), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, "workspace", directory, ".gitkeep"), "");
  }
}

function copyNextStandalone() {
  if (args.reuseAppRelease) {
    const releaseRoot = path.resolve(args.reuseAppRelease);
    const releasesRoot = path.resolve(root, "dist", "personal-agent-node");
    if (!releaseRoot.startsWith(`${releasesRoot}${path.sep}`)) throw new Error("Reusable app release must be under dist/personal-agent-node");
    const manifest = readJson(path.join(releaseRoot, "release-manifest.json"));
    if (manifest?.releaseType !== "personal-agent-node" || !fs.existsSync(path.join(releaseRoot, "core", "app", "server.js"))) throw new Error("Reusable app release is invalid");
    copyTrustedBuildDirectory(path.join(releaseRoot, "core", "app"), path.join(outputRoot, "core", "app"));
    copyTrustedBuildDirectory(path.join(releaseRoot, "node_modules"), path.join(outputRoot, "node_modules"));
    fs.copyFileSync(path.join(releaseRoot, "package.json"), path.join(outputRoot, "package.json"));
    fs.writeFileSync(path.join(outputRoot, "core", "app", "package.json"), `${JSON.stringify({ name: "@personal-agent/app-runtime", private: true, type: "module" }, null, 2)}\n`);
    return;
  }
  const standalone = path.join(root, "core", "app", ".next", "standalone");
  const staticRoot = path.join(root, "core", "app", ".next", "static");
  if (!fs.existsSync(path.join(standalone, "core", "app", "server.js"))) throw new Error("Next.js standalone server is missing");
  copyDirectory(standalone, outputRoot);
  copyDirectory(staticRoot, path.join(outputRoot, "core", "app", ".next", "static"));
  fs.writeFileSync(path.join(outputRoot, "core", "app", "package.json"), `${JSON.stringify({ name: "@personal-agent/app-runtime", private: true, type: "module" }, null, 2)}\n`);
}

function copyTrustedBuildDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyTrustedBuildDirectory(sourcePath, targetPath);
    else if (entry.isFile()) { fs.mkdirSync(path.dirname(targetPath), { recursive: true }); fs.copyFileSync(sourcePath, targetPath); fs.chmodSync(targetPath, fs.statSync(sourcePath).mode); }
  }
}

function copyNativeDependencies() {
  const imageRuntimeRoot = path.join(root, "node_modules", "@img");
  if (!fs.existsSync(imageRuntimeRoot)) throw new Error("Sharp native runtime packages are missing");
  const runtimePackages = fs.readdirSync(imageRuntimeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("sharp-"));
  if (runtimePackages.length === 0) throw new Error("Sharp native runtime package is missing for this build host");
  for (const entry of runtimePackages) {
    copyDirectory(path.join(imageRuntimeRoot, entry.name), path.join(outputRoot, "node_modules", "@img", entry.name));
  }
}

async function bundleCore() {
  const entries = [
    ["core/runtime/bin/private-site.mjs", "core/runtime/bin/private-site.mjs"],
    ["core/runtime/bin/personal-agent.mjs", "core/runtime/bin/personal-agent.mjs"],
    ["core/runtime/src/control-service.ts", "core/runtime/app/control-service.mjs"],
    ["core/runtime/src/gateway.ts", "core/runtime/app/gateway.mjs"],
    ["core/runtime/src/reverse-tunnel-entry.ts", "core/runtime/app/reverse-tunnel.mjs"],
    ["core/agent/src/server/server.ts", "core/agent/app/server.mjs"],
    ["core/agent/vendor/agent-bridge/lib/_worker-entry.mjs", "core/agent/app/worker.mjs"],
    ["core/agent/bin/pa-cli.mjs", "core/agent/bin/pa-cli.mjs"],
    ["core/control/server.ts", "core/control/server.mjs"],
    ["core/edge/bin/self-hosted-relay.mjs", "core/edge/bin/self-hosted-relay.mjs"],
    ["scripts/install-private-site-node-release.mjs", "scripts/install-private-site-node-release.mjs"],
  ];
  await Promise.all(entries.map(async ([source, target]) => {
    const outfile = path.join(outputRoot, target);
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    await build({
      entryPoints: [path.join(root, source)], outfile, absWorkingDir: root,
      bundle: true, platform: "node", target: "node22", format: "esm", treeShaking: true,
      sourcemap: false, legalComments: "none",
      banner: { js: "import { createRequire as __personalAgentCreateRequire } from 'node:module'; const require = __personalAgentCreateRequire(import.meta.url);" },
    });
    fs.chmodSync(outfile, 0o755);
  }));
}

function writeManifest(openCliRuntime) {
  const manifest = {
    schemaVersion: 2,
    releaseType: "personal-agent-node",
    releaseId,
    revision: revision.commit,
    dirty: revision.dirty,
    createdAt: new Date().toISOString(),
    distributionVersion: metadata.version,
    architecture: "next-core-workspace",
    runtime: { node: ">=22 <24", platforms: ["win32-x64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] },
    delivery: {
      homeEnvironment: "PERSONAL_AGENT_HOME",
      defaultHome: "~/.personal-agent",
      core: { ownership: "product", mutable: false, installPath: "core" },
      workspace: { ownership: "user", mutable: true, installPath: "workspace", preserveOnUninstall: true },
    },
    entrypoints: {
      personalAgent: "core/runtime/bin/personal-agent.mjs",
      node: "core/runtime/bin/private-site.mjs",
      app: "core/app/server.js",
      control: "core/control/server.mjs",
      bridge: "core/agent/app/server.mjs",
      worker: "core/agent/app/worker.mjs",
      gateway: "core/runtime/app/gateway.mjs",
      reverseTunnel: "core/runtime/app/reverse-tunnel.mjs",
      harnessCli: "core/agent/bin/pa-cli.mjs",
      mailIngest: "core/agent/bin/pa-cli.mjs",
    },
    browserExecutors: { opencli: openCliRuntime },
    pluginApi: { version: "personal-agent/v1", manifest: "core/plugins/schema/personal-agent.plugin.schema.json", installRoot: "workspace/plugins" },
    appApi: { version: "personal-agent/app-v1", nodeApiMajors: ["1"], manifest: "core/apps/schema/personal-agent.app.schema.json", installRoot: "workspace/apps", cloudRequired: false },
    harness: { owner: "workspace", supportedAgentRuntime: "codex", root: "workspace", catalog: "workspace/registry/skills.json", workflows: "workspace/workflows" },
    excluded: ["projects", "examples", "preinstalled-personal-apps", "credentials", "environment-files", "runtime-data", "customer-content"],
  };
  fs.writeFileSync(path.join(outputRoot, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeSbom(openCliRuntime) {
  const output = execFileSync(npmInvocation.command, [...npmInvocation.prefixArgs, "sbom", "--omit=dev", "--sbom-format", "cyclonedx"], { cwd: root, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  const sbom = JSON.parse(output);
  const openCliRoot = path.join(outputRoot, "core", "agent", "vendor", "opencli-runtime");
  const openCliOutput = execFileSync(npmInvocation.command, [...npmInvocation.prefixArgs, "sbom", "--omit=dev", "--sbom-format", "cyclonedx"], { cwd: openCliRoot, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });
  mergeCycloneDx(sbom, JSON.parse(openCliOutput), { name: "personal-agent:runtime", value: "browser-executor" });
  const cargo = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", path.join(root, "core", "desktop", "src-tauri", "Cargo.toml")], { cwd: root, encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }));
  const cargoRefs = new Map(cargo.packages.map((entry) => [entry.id, cargoPurl(entry)]));
  const cargoComponents = cargo.packages.map((entry) => ({
    type: entry.name === "personal-agent-desktop" ? "application" : "library",
    "bom-ref": cargoPurl(entry),
    name: entry.name,
    version: entry.version,
    purl: cargoPurl(entry),
    ...(entry.license ? { licenses: [{ expression: entry.license }] } : {}),
    ...(entry.repository ? { externalReferences: [{ type: "vcs", url: entry.repository }] } : {}),
    properties: [{ name: "personal-agent:ecosystem", value: "cargo" }],
  }));
  const existingComponents = Array.isArray(sbom.components) ? sbom.components : [];
  const existingRefs = new Set(existingComponents.map((entry) => entry["bom-ref"] || entry.purl).filter(Boolean));
  sbom.components = [...existingComponents, ...cargoComponents.filter((entry) => !existingRefs.has(entry["bom-ref"]))]
    .sort((left, right) => String(left["bom-ref"] || left.name).localeCompare(String(right["bom-ref"] || right.name)));
  const existingDependencies = Array.isArray(sbom.dependencies) ? sbom.dependencies : [];
  const dependencyRefs = new Set(existingDependencies.map((entry) => entry.ref));
  const cargoDependencies = (cargo.resolve?.nodes || []).map((node) => ({
    ref: cargoRefs.get(node.id),
    dependsOn: node.dependencies.map((id) => cargoRefs.get(id)).filter(Boolean).sort(),
  })).filter((entry) => entry.ref && !dependencyRefs.has(entry.ref));
  sbom.dependencies = [...existingDependencies, ...cargoDependencies].sort((left, right) => String(left.ref).localeCompare(String(right.ref)));
  sbom.metadata ||= {};
  sbom.metadata.properties = [
    ...(sbom.metadata.properties || []),
    { name: "personal-agent:desktop-shell", value: "tauri-2" },
    { name: "personal-agent:opencli-runtime", value: `${openCliRuntime.package}@${openCliRuntime.version}` },
  ];
  fs.writeFileSync(path.join(outputRoot, "SBOM.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
}

function mergeCycloneDx(target, addition, property) {
  const additionRoot = addition.metadata?.component;
  if (!additionRoot?.["bom-ref"]) throw new Error("OpenCLI SBOM root component is missing");
  additionRoot.properties = [...(additionRoot.properties || []), property];
  const components = new Map((target.components || []).map((entry) => [entry["bom-ref"] || entry.purl, entry]));
  for (const entry of [additionRoot, ...(addition.components || [])]) {
    const key = entry["bom-ref"] || entry.purl;
    if (key && !components.has(key)) components.set(key, entry);
  }
  target.components = [...components.values()].sort((left, right) => String(left["bom-ref"] || left.name).localeCompare(String(right["bom-ref"] || right.name)));

  const dependencies = new Map((target.dependencies || []).map((entry) => [entry.ref, { ...entry, dependsOn: [...(entry.dependsOn || [])] }]));
  for (const entry of addition.dependencies || []) {
    const current = dependencies.get(entry.ref) || { ref: entry.ref, dependsOn: [] };
    current.dependsOn = [...new Set([...(current.dependsOn || []), ...(entry.dependsOn || [])])].sort();
    dependencies.set(entry.ref, current);
  }
  const targetRootRef = target.metadata?.component?.["bom-ref"];
  if (targetRootRef) {
    const rootDependency = dependencies.get(targetRootRef) || { ref: targetRootRef, dependsOn: [] };
    rootDependency.dependsOn = [...new Set([...(rootDependency.dependsOn || []), additionRoot["bom-ref"]])].sort();
    dependencies.set(targetRootRef, rootDependency);
  }
  target.dependencies = [...dependencies.values()].sort((left, right) => String(left.ref).localeCompare(String(right.ref)));
}

function cargoPurl(entry) { return `pkg:cargo/${encodeURIComponent(entry.name)}@${entry.version}`; }

function writeChecksums() {
  const lines = listFiles(outputRoot)
    .map((file) => path.relative(outputRoot, file).replaceAll("\\", "/"))
    .filter((relative) => relative !== "SHA256SUMS")
    .map((relative) => `${sha256(path.join(outputRoot, relative))}  ${relative}`);
  fs.writeFileSync(path.join(outputRoot, "SHA256SUMS"), `${lines.join("\n")}\n`);
}

function copy(relative) { copyTo(relative, relative); }
function copyTo(sourceRelative, targetRelative) {
  const source = path.join(root, sourceRelative);
  if (!fs.existsSync(source)) throw new Error(`Missing release input: ${sourceRelative}`);
  const target = path.join(outputRoot, targetRelative);
  if (fs.statSync(source).isDirectory()) copyDirectory(source, target);
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (safePath(source)) fs.copyFileSync(source, target);
  }
}

function copyDirectory(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    if (!safePath(sourcePath)) continue;
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
    else if (entry.isFile()) { fs.mkdirSync(path.dirname(targetPath), { recursive: true }); fs.copyFileSync(sourcePath, targetPath); fs.chmodSync(targetPath, fs.statSync(sourcePath).mode); }
  }
}

function safePath(candidate) {
  const relative = path.relative(root, candidate).replaceAll("\\", "/");
  const parts = relative.split("/");
  const base = parts.at(-1) || "";
  if (parts.includes(".git") || parts.includes("secrets") || parts.includes(".local") || relative === "dist" || relative.startsWith("dist/")) return false;
  if ([".DS_Store", "auth.json", "config.toml"].includes(base) || base === ".env" || base.startsWith(".env.")) return false;
  return !/\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|db-wal|db-shm|log)$/i.test(base);
}

function normalizeShellScripts() {
  for (const file of listFiles(outputRoot)) if (path.extname(file).toLowerCase() === ".sh") fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

function listFiles(directory) {
  const files = [];
  const walk = (current) => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const target = path.join(current, entry.name); if (entry.isDirectory()) walk(target); else if (entry.isFile()) files.push(target); } };
  walk(directory);
  return files.sort();
}

function assertInputs() {
  for (const relative of ["core/app/next.config.ts", "core/runtime/bin/private-site.mjs", "core/agent/src/server/server.ts", "core/control/server.ts", "workspace/AGENTS.md", "registry/delivery.json"]) {
    if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing release input: ${relative}`);
  }
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function resolveNpmInvocation() {
  if (process.platform !== "win32") return { command: "npm", prefixArgs: [] };
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.statSync(npmCli, { throwIfNoEntry: false })?.isFile()) throw new Error(`Unable to locate npm CLI: ${npmCli}`);
  return { command: process.execPath, prefixArgs: [npmCli] };
}
function sourceRevision() {
  try { return { commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) }; }
  catch { return { commit: "unknown", dirty: true }; }
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function timestamp() { return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--release-id") result.releaseId = argv[++index];
    else if (argv[index] === "--output") result.output = argv[++index];
    else if (argv[index] === "--skip-next-build") result.skipNextBuild = true;
    else if (argv[index] === "--reuse-app-release") result.reuseAppRelease = argv[++index];
  }
  return result;
}
