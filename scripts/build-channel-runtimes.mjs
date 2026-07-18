#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = path.resolve(path.dirname(scriptPath), "..");

export async function buildChannelRuntimes({ releaseRoot, cacheRoot = path.join(workspaceRoot, ".local", "runtime-cache") }) {
  if (!releaseRoot) throw new Error("releaseRoot is required");
  fs.mkdirSync(cacheRoot, { recursive: true });

  const egressManifest = readJson(path.join(workspaceRoot, "projects", "core", "channels", "egress", "runtime.json"));
  const xhsManifest = readJson(path.join(workspaceRoot, "projects", "core", "channels", "xiaohongshu", "runtime.json"));
  const egressRoot = path.join(releaseRoot, "projects", "core", "channels", "egress");
  const xhsRoot = path.join(releaseRoot, "projects", "core", "channels", "xiaohongshu");
  fs.mkdirSync(path.join(egressRoot, "bin"), { recursive: true });
  fs.mkdirSync(path.join(egressRoot, "lib"), { recursive: true });
  fs.mkdirSync(path.join(xhsRoot, "bin"), { recursive: true });

  await materializeEgress(egressManifest, egressRoot, cacheRoot);
  await materializeXiaohongshu(xhsManifest, xhsRoot, cacheRoot);
  copyMetadata("channel-egress", egressRoot);
  copyMetadata("xiaohongshu-channel", xhsRoot);

  return {
    channelEgress: { name: egressManifest.name, version: egressManifest.version, platform: egressManifest.platform },
    xiaohongshu: {
      revision: xhsManifest.adapter.revision,
      release: xhsManifest.adapter.release,
      browserVersion: xhsManifest.browser.version,
      platform: xhsManifest.platform,
    },
  };
}

async function materializeEgress(manifest, outputRoot, cacheRoot) {
  const archive = await downloadVerified(manifest.archive, cacheRoot, `sing-box-${manifest.version}-${manifest.platform}.tar.gz`);
  const extracted = extractTar(archive);
  try {
    const entrypoint = path.join(extracted, ...manifest.archive.entrypoint.split("/"));
    const lib = path.join(path.dirname(entrypoint), "libcronet.so");
    const license = path.join(path.dirname(entrypoint), "LICENSE");
    copyRequired(entrypoint, path.join(outputRoot, "bin", "sing-box"));
    if (fs.existsSync(lib)) copyRequired(lib, path.join(outputRoot, "lib", "libcronet.so"));
    if (fs.existsSync(license)) copyRequired(license, path.join(outputRoot, "LICENSE"));
    fs.chmodSync(path.join(outputRoot, "bin", "sing-box"), 0o755);
  } finally {
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

async function materializeXiaohongshu(manifest, outputRoot, cacheRoot) {
  const adapterTarget = path.join(outputRoot, "bin", "xiaohongshu-mcp");
  if (manifest.adapter.build) await buildXiaohongshuAdapter(manifest.adapter, adapterTarget, cacheRoot, manifest.platform);
  else await extractXiaohongshuAdapter(manifest.adapter, adapterTarget, cacheRoot, manifest.platform);
  fs.chmodSync(adapterTarget, 0o755);

  const browserArchive = await downloadVerified(
    manifest.browser.archive,
    cacheRoot,
    `cloakbrowser-${manifest.browser.version}-${manifest.platform}.tar.gz`,
  );
  const browserExtracted = extractTar(browserArchive);
  try {
    const browserEntry = findUniqueFile(browserExtracted, manifest.browser.archive.entrypoint);
    const browserRoot = path.dirname(browserEntry);
    fs.cpSync(browserRoot, path.join(outputRoot, "browser"), { recursive: true, preserveTimestamps: true });
    for (const executable of [path.basename(browserEntry), "chrome_crashpad_handler", "chromedriver"]) {
      const executablePath = path.join(outputRoot, "browser", executable);
      if (fs.existsSync(executablePath)) fs.chmodSync(executablePath, 0o755);
    }
  } finally {
    fs.rmSync(browserExtracted, { recursive: true, force: true });
  }
}

async function extractXiaohongshuAdapter(adapter, target, cacheRoot, platform) {
  const adapterArchive = await downloadVerified(
    adapter.archive,
    cacheRoot,
    `xiaohongshu-mcp-${adapter.release}-${platform}.tar.gz`,
  );
  const adapterExtracted = extractTar(adapterArchive);
  try {
    copyRequired(path.join(adapterExtracted, ...adapter.archive.entrypoint.split("/")), target);
  } finally {
    fs.rmSync(adapterExtracted, { recursive: true, force: true });
  }
}

async function buildXiaohongshuAdapter(adapter, target, cacheRoot, outputPlatform = "linux-amd64") {
  const build = adapter.build;
  const pristineSourceRoot = await materializeSourceTree(adapter.revision, build, cacheRoot);
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), `xiaohongshu-mcp-build-${adapter.revision}-`));
  fs.cpSync(pristineSourceRoot, sourceRoot, { recursive: true });
  const toolchain = build.toolchains?.[`${process.platform}-${process.arch}`];
  let toolchainRoot = "";
  try {
    applySourcePatches(sourceRoot, build.patches);
    const patchedDigest = sourceTreeDigest(sourceRoot, [...build.sourceFiles, ...(build.patchAddedSourceFiles || [])]);
    if (!build.patchedSourceSha256 || patchedDigest !== build.patchedSourceSha256) {
      throw new Error(`Patched Xiaohongshu source checksum mismatch: ${patchedDigest}`);
    }
    if (!toolchain) throw new Error(`No Go ${build.goVersion} toolchain is pinned for ${process.platform}-${process.arch}`);
    const toolchainArchive = await downloadVerified(toolchain, cacheRoot, path.basename(new URL(toolchain.url).pathname));
    toolchainRoot = extractRuntimeArchive(toolchainArchive, toolchain.format);
    const goBinary = path.join(toolchainRoot, ...toolchain.entrypoint.split("/"));
    if (!fs.existsSync(goBinary)) throw new Error(`Pinned Go toolchain entrypoint is missing: ${toolchain.entrypoint}`);
    fs.chmodSync(goBinary, 0o755);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const [targetOs, targetArch] = outputPlatform === "win32-x64" ? ["windows", "amd64"]
      : outputPlatform === "darwin-arm64" ? ["darwin", "arm64"]
        : outputPlatform === "linux-amd64" ? ["linux", "amd64"]
        : [];
    if (!targetOs) throw new Error(`Unsupported Xiaohongshu output platform: ${outputPlatform}`);
    execFileSync(goBinary, ["build", "-trimpath", "-ldflags=-s -w", "-o", target, "."], {
      cwd: sourceRoot,
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: targetOs,
        GOARCH: targetArch,
        GOTOOLCHAIN: "local",
        GOPATH: path.join(cacheRoot, "go-workspace"),
        GOMODCACHE: path.join(cacheRoot, "go-modules"),
        GOCACHE: path.join(cacheRoot, "go-build"),
      },
      stdio: "inherit",
    });
  } finally {
    if (toolchainRoot) fs.rmSync(toolchainRoot, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
}

async function materializeSourceTree(revision, build, cacheRoot) {
  const sourceFiles = validateSourceFiles(build.sourceFiles);
  const sourceRoot = path.join(cacheRoot, `xiaohongshu-mcp-source-${revision}`);
  if (fs.existsSync(sourceRoot) && sourceTreeDigest(sourceRoot, sourceFiles) === build.sourceSha256) return sourceRoot;
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  for (const relativePath of sourceFiles) {
    const target = path.join(sourceRoot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await downloadFile(`${String(build.sourceBaseUrl).replace(/\/+$/, "")}/${relativePath}`, target);
  }
  const digest = sourceTreeDigest(sourceRoot, sourceFiles);
  if (digest !== build.sourceSha256) {
    throw new Error(`Xiaohongshu source checksum mismatch: ${digest}`);
  }
  return sourceRoot;
}

export function validateSourceFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new Error("Xiaohongshu source file list is empty");
  const normalized = [...new Set(files.map((value) => String(value).replace(/\\/g, "/")))].sort();
  for (const relativePath of normalized) {
    if (!/^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(relativePath) || relativePath.includes("..")) {
      throw new Error(`Unsafe Xiaohongshu source path: ${relativePath}`);
    }
    if (!relativePath.endsWith(".go") && !["go.mod", "go.sum"].includes(path.posix.basename(relativePath))) {
      throw new Error(`Unsupported Xiaohongshu source file: ${relativePath}`);
    }
  }
  return normalized;
}

export async function buildLocalXiaohongshuAdapter({
  outputRoot,
  cacheRoot = path.join(workspaceRoot, ".local", "runtime-cache"),
} = {}) {
  if (!outputRoot) throw new Error("outputRoot is required");
  const manifest = readJson(path.join(workspaceRoot, "core", "channels", "xiaohongshu", "runtime.json"));
  const platform = process.platform === "win32" && process.arch === "x64" ? "win32-x64" : `${process.platform}-${process.arch}`;
  if (!["win32-x64", "darwin-arm64"].includes(platform)) throw new Error(`Local Xiaohongshu runtime is not supported on ${platform}`);
  const target = path.join(outputRoot, process.platform === "win32" ? "xiaohongshu-mcp.exe" : "xiaohongshu-mcp");
  fs.mkdirSync(outputRoot, { recursive: true });
  await buildXiaohongshuAdapter(manifest.adapter, target, cacheRoot, platform);
  return { target, platform, release: manifest.adapter.release, revision: manifest.adapter.revision };
}

export function validateSourcePatches(patches) {
  if (!Array.isArray(patches) || !patches.length) throw new Error("Xiaohongshu source patch list is empty");
  const normalized = patches.map((patch) => ({ file: String(patch?.file || "").replace(/\\/g, "/"), sha256: String(patch?.sha256 || "").toLowerCase() }));
  const files = new Set();
  for (const patch of normalized) {
    if (!/^core\/channels\/xiaohongshu\/patches\/[A-Za-z0-9_.-]+\.patch$/.test(patch.file)) throw new Error(`Unsafe Xiaohongshu source patch path: ${patch.file}`);
    if (!/^[a-f0-9]{64}$/.test(patch.sha256)) throw new Error(`Invalid Xiaohongshu source patch checksum: ${patch.file}`);
    if (files.has(patch.file)) throw new Error(`Duplicate Xiaohongshu source patch: ${patch.file}`);
    files.add(patch.file);
  }
  return normalized;
}

export function applySourcePatches(sourceRoot, patches) {
  for (const patch of validateSourcePatches(patches)) {
    const patchPath = path.resolve(workspaceRoot, ...patch.file.split("/"));
    const digest = crypto.createHash("sha256").update(fs.readFileSync(patchPath)).digest("hex");
    if (digest !== patch.sha256) throw new Error(`Xiaohongshu source patch checksum mismatch: ${patch.file}`);
    execFileSync("git", ["apply", "--check", "--unidiff-zero", patchPath], { cwd: sourceRoot, stdio: "inherit" });
    execFileSync("git", ["apply", "--unidiff-zero", "--whitespace=nowarn", patchPath], { cwd: sourceRoot, stdio: "inherit" });
  }
}

export function sourceTreeDigest(sourceRoot, files) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of validateSourceFiles(files)) {
    const filePath = path.join(sourceRoot, ...relativePath.split("/"));
    if (!fs.existsSync(filePath)) return "";
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function downloadFile(url, target) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.rmSync(temporary, { force: true });
    try {
      if (process.platform === "win32") {
        execFileSync("curl.exe", [
          "--fail", "--location", "--retry", "2", "--connect-timeout", "20", "--max-time", "180",
          "--silent", "--show-error", "--output", temporary, url,
        ], { stdio: "inherit" });
      } else {
        const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(3 * 60 * 1000) });
        if (!response.ok) throw new Error(`Source download failed (${response.status}): ${url}`);
        fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
      }
      fs.renameSync(temporary, target);
      return target;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  throw new Error(`Source download failed: ${url}`);
}

async function downloadVerified(archive, cacheRoot, cacheName) {
  const target = path.join(cacheRoot, cacheName);
  if (fs.existsSync(target) && await sha256(target) === archive.sha256) return target;
  fs.rmSync(target, { force: true });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const temporary = `${target}.${process.pid}.tmp`;
    fs.rmSync(temporary, { force: true });
    process.stdout.write(`Downloading ${cacheName} (attempt ${attempt}/4).\n`);
    let file;
    try {
      if (process.platform === "win32") {
        execFileSync("curl.exe", [
          "--fail",
          "--location",
          "--retry", "3",
          "--connect-timeout", "30",
          "--max-time", "900",
          "--output", temporary,
          archive.url,
        ], { stdio: "inherit" });
      } else {
        const response = await fetch(archive.url, { redirect: "follow", signal: AbortSignal.timeout(15 * 60 * 1000) });
        if (!response.ok || !response.body) throw new Error(`Runtime download failed (${response.status}): ${archive.url}`);
        file = fs.createWriteStream(temporary, { mode: 0o600 });
        for await (const chunk of response.body) {
          if (!file.write(chunk)) await new Promise((resolve) => file.once("drain", resolve));
        }
        await new Promise((resolve, reject) => file.end((error) => error ? reject(error) : resolve()));
      }
      const digest = await sha256(temporary);
      if (digest !== archive.sha256) throw new Error(`Runtime checksum mismatch for ${cacheName}: ${digest}`);
      fs.renameSync(temporary, target);
      return target;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    } finally {
      if (file && !file.closed) file.destroy();
      fs.rmSync(temporary, { force: true });
    }
  }
  throw new Error(`Runtime download failed: ${archive.url}`);
}

function extractTar(archive) {
  const archiveDir = path.dirname(archive);
  const target = fs.mkdtempSync(path.join(archiveDir, "extract-"));
  try {
    execFileSync("tar", ["-xzf", path.basename(archive), "-C", path.basename(target)], {
      cwd: archiveDir,
      stdio: "inherit",
    });
    return target;
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function extractRuntimeArchive(archive, format) {
  if (format === "tar.gz") return extractTar(archive);
  if (format !== "zip") throw new Error(`Unsupported runtime archive format: ${format}`);
  const archiveDir = path.dirname(archive);
  const target = fs.mkdtempSync(path.join(archiveDir, "extract-"));
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }",
      archive,
      target,
    ], {
      stdio: "inherit",
    });
    return target;
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
}

function findUniqueFile(root, basename) {
  const matches = listFiles(root).filter((file) => path.basename(file) === basename);
  if (matches.length !== 1) throw new Error(`Expected one ${basename} in runtime archive, found ${matches.length}`);
  return matches[0];
}

function listFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listFiles(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

function copyMetadata(projectName, outputRoot) {
  const sourceRoot = path.join(workspaceRoot, "projects", projectName);
  for (const file of ["runtime.json", "README.md"]) copyRequired(path.join(sourceRoot, file), path.join(outputRoot, file));
  if (projectName === "channel-egress") {
    fs.cpSync(path.join(sourceRoot, "config"), path.join(outputRoot, "config"), { recursive: true });
    fs.cpSync(path.join(sourceRoot, "scripts"), path.join(outputRoot, "scripts"), { recursive: true });
  }
}

function copyRequired(source, target) {
  if (!fs.existsSync(source)) throw new Error(`Required runtime path is missing: ${source}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  const localXiaohongshu = process.argv.includes("--local-xiaohongshu");
  const flag = localXiaohongshu ? "--output-root" : "--release-root";
  const index = process.argv.indexOf(flag);
  const outputRoot = index >= 0 ? process.argv[index + 1] : "";
  const operation = !outputRoot ? Promise.reject(new Error(`${flag} is required`))
    : localXiaohongshu
      ? buildLocalXiaohongshuAdapter({ outputRoot: path.resolve(outputRoot) })
      : buildChannelRuntimes({ releaseRoot: path.resolve(outputRoot) });
  operation
    .then((runtime) => process.stdout.write(`${JSON.stringify({ ok: true, runtime }, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
      process.exit(1);
    });
}
