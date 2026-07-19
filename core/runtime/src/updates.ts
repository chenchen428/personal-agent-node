import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { operationError } from "./operations.ts";
import { installationPaths } from "./space-registry.ts";

const REPOSITORY = "chenchen428/personal-agent-node";
const CHECK_TTL_MS = 6 * 60 * 60_000;
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024;
const ACTIVE_STATES = new Set(["planned", "approved", "downloading", "verified", "handoff", "activating", "restarting", "verifying"]);

export function createUpdateManager({ config, operations, now = () => Date.now(), randomUUID = () => crypto.randomUUID(), fetchImpl = fetch, spawnImpl = spawn } = {}) {
  if (!config?.dataRoot || !operations) throw operationError("INVALID_ARGUMENT", "Update manager requires config and operation storage", 2);
  const installRoot = path.join(config.homeRoot || path.dirname(config.dataRoot), "core");
  const updatesRoot = path.join(installationPaths(config.installationDataRoot || config.dataRoot).installationRoot, "updates");
  const stateFile = path.join(updatesRoot, "state.json");
  let checking = null;

  function status({ background = true, jobId } = {}) {
    const installation = readJson(path.join(installRoot, "installation.json"));
    const state = readJson(stateFile) || {};
    const currentVersion = String(installation?.activeReleaseId || packageVersion()).replace(/^v/, "");
    const channel = state.channel || channelFor(currentVersion);
    const jobs = listJobs();
    const job = jobId ? readJob(jobId) : jobs[0] || null;
    if (background && (!state.checkedAt || now() - Date.parse(state.checkedAt) >= CHECK_TTL_MS) && !checking) {
      checking = check().catch(() => null).finally(() => { checking = null; });
    }
    return {
      schemaVersion: 1,
      current: { version: currentVersion, releaseId: installation?.activeReleaseId || currentVersion },
      channel,
      checkedAt: state.checkedAt || null,
      checkError: state.checkError || null,
      available: state.available || null,
      updateAvailable: Boolean(state.available && compareVersions(state.available.version, currentVersion) > 0),
      previousReleaseId: previousReleaseId(installation),
      job,
    };
  }

  async function check({ channel } = {}) {
    const before = status({ background: false });
    const selectedChannel = normalizeChannel(channel || before.channel);
    try {
      const releases = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=20`);
      const release = releases.find((entry) => eligibleRelease(entry, selectedChannel));
      if (!release) throw operationError("UPDATE_UNAVAILABLE", `No ${selectedChannel} release is available`, 3);
      const assetName = updaterAssetName(release.tag_name);
      const asset = release.assets?.find((entry) => entry.name === assetName);
      const sums = release.assets?.find((entry) => entry.name === "SHA256SUMS");
      if (!asset?.browser_download_url || !sums?.browser_download_url) throw operationError("UPDATE_ARTIFACT_UNAVAILABLE", `Release ${release.tag_name} does not contain the platform updater`, 7);
      const sumsUrl = validateGitHubAssetUrl(sums.browser_download_url, release.tag_name, "SHA256SUMS");
      const checksums = await fetchText(sumsUrl, 2 * 1024 * 1024);
      const sha256 = checksumFor(checksums, assetName);
      const artifactUrl = validateGitHubAssetUrl(asset.browser_download_url, release.tag_name, assetName);
      const available = {
        version: String(release.tag_name).replace(/^v/, ""),
        releaseId: String(release.tag_name).replace(/^v/, ""),
        tag: release.tag_name,
        channel: selectedChannel,
        publishedAt: release.published_at,
        notesUrl: release.html_url,
        asset: { name: assetName, url: artifactUrl, size: Number(asset.size || 0), sha256 },
      };
      writeState({ schemaVersion: 1, channel: selectedChannel, checkedAt: iso(now()), available, checkError: null });
      return status({ background: false });
    } catch (error) {
      const previous = readJson(stateFile) || {};
      writeState({ ...previous, schemaVersion: 1, channel: selectedChannel, checkedAt: iso(now()), checkError: { code: error?.code || "UPDATE_CHECK_FAILED", message: String(error?.message || "Update check failed").slice(0, 300) } });
      throw error;
    }
  }

  async function plan({ version } = {}) {
    let snapshot = status({ background: false });
    if (!snapshot.available || (version && snapshot.available.version !== version)) snapshot = await check({ channel: snapshot.channel });
    if (!snapshot.updateAvailable) throw operationError("ALREADY_CURRENT", "Personal Agent is already up to date", 3);
    const available = snapshot.available;
    if (version && available.version !== version) throw operationError("VERSION_UNAVAILABLE", `Requested version is unavailable: ${version}`, 3);
    const jobId = `update_${randomUUID()}`;
    const operation = operations.plan({
      command: "update apply",
      risk: "R3",
      inputSummary: `Install Personal Agent ${available.version}; ${available.asset.size || 0} bytes; restart required`,
      target: `${available.channel}:${available.releaseId}`,
      stateFingerprint: `${snapshot.current.releaseId}:${available.asset.sha256}`,
      idempotencyKey: `update:${available.releaseId}`,
    });
    const job = {
      schemaVersion: 1, id: jobId, kind: "apply", status: "planned", createdAt: iso(now()), updatedAt: iso(now()),
      channel: available.channel, platform: platformKey(), targetVersion: available.version, targetReleaseId: available.releaseId,
      previousReleaseId: snapshot.current.releaseId, artifact: available.asset,
      operationId: operation.id, operationDigest: operation.digest,
    };
    writeJob(job);
    return { job: publicJob(job), operation };
  }

  function planRollback() {
    const snapshot = status({ background: false });
    if (!snapshot.previousReleaseId) throw operationError("ROLLBACK_UNAVAILABLE", "No previous release is available", 3);
    const jobId = `update_${randomUUID()}`;
    const operation = operations.plan({ command: "update rollback", risk: "R3", inputSummary: `Restore previous Personal Agent release ${snapshot.previousReleaseId}; restart required`, target: snapshot.previousReleaseId, stateFingerprint: snapshot.current.releaseId, idempotencyKey: `rollback:${snapshot.current.releaseId}:${snapshot.previousReleaseId}` });
    const job = { schemaVersion: 1, id: jobId, kind: "rollback", status: "planned", createdAt: iso(now()), updatedAt: iso(now()), channel: snapshot.channel, platform: platformKey(), targetReleaseId: snapshot.previousReleaseId, previousReleaseId: snapshot.current.releaseId, operationId: operation.id, operationDigest: operation.digest };
    writeJob(job);
    return { job: publicJob(job), operation };
  }

  function approve({ jobId, operationId, digest }) {
    const job = requireBoundJob(jobId, operationId, digest);
    const operation = operations.approve(operationId, { digest, actor: { kind: "human", authenticated: true, loopback: true, channel: "local-console" } });
    transition(job, "approved");
    return { job: publicJob(job), operation };
  }

  async function apply({ jobId, operationId, digest, authorizationPolicy = "" }) {
    const job = requireBoundJob(jobId, operationId, digest);
    if (operations.inspect(operationId).status === "planned" && authorizationPolicy === "product-development") {
      requireProductDevelopmentState(config);
      operations.authorize(operationId, { digest, actor: { kind: "agent-policy", policy: "product-development" } });
      transition(job, "approved");
    }
    const operation = await operations.execute(operationId, {
      digest,
      actor: { kind: "runtime" },
      handler: async () => {
        try {
          if (job.kind === "apply") await stageArtifact(job);
          else transition(job, "verified");
          job.handoffNonce = crypto.randomBytes(32).toString("base64url");
          transition(job, "handoff");
          launchShellHandoff(job);
          return { jobId: job.id, status: job.status, targetReleaseId: job.targetReleaseId };
        } catch (error) {
          transition(job, "failed", { failure: { code: error?.code || "UPDATE_FAILED", message: String(error?.message || "Update failed").slice(0, 300) } });
          throw error;
        }
      },
    });
    return { job: publicJob(job), operation };
  }

  async function stageArtifact(job) {
    if (job.status === "verified" && fs.existsSync(job.artifactPath || "")) return;
    transition(job, "downloading");
    const response = await fetchImpl(job.artifact.url, { redirect: "follow", headers: { "user-agent": "personal-agent-updater/1" }, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw operationError("UPDATE_DOWNLOAD_FAILED", `Update download failed with HTTP ${response.status}`, 7);
    const declared = Number(response.headers.get("content-length") || job.artifact.size || 0);
    if (declared > MAX_ARTIFACT_BYTES) throw operationError("UPDATE_ARTIFACT_TOO_LARGE", "Update artifact exceeds the size limit", 7);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_ARTIFACT_BYTES || (job.artifact.size && bytes.length !== job.artifact.size)) throw operationError("UPDATE_SIZE_MISMATCH", "Update artifact size does not match release metadata", 7);
    const actual = crypto.createHash("sha256").update(bytes).digest("hex");
    if (!constantTimeEqual(actual, job.artifact.sha256)) throw operationError("UPDATE_DIGEST_MISMATCH", "Update artifact checksum verification failed", 7);
    const artifactPath = path.join(jobDirectory(job.id), process.platform === "win32" ? "candidate.exe" : "candidate");
    fs.writeFileSync(artifactPath, bytes, { mode: 0o700, flag: "wx" });
    try { fs.chmodSync(artifactPath, 0o700); } catch {}
    job.artifactPath = artifactPath;
    transition(job, "verified");
  }

  function launchShellHandoff(job) {
    const launcher = path.join(installRoot, "bin", process.platform === "win32" ? "personal-agent-ui.exe" : "personal-agent-ui");
    if (!fs.existsSync(launcher)) throw operationError("DESKTOP_HANDOFF_UNAVAILABLE", "Stable desktop launcher is unavailable", 7);
    const child = spawnImpl(launcher, ["--apply-update", job.id, "--nonce", job.handoffNonce], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
    child.unref?.();
  }

  function requireBoundJob(jobId, operationId, digest) {
    const job = jobId ? readJob(jobId) : rawJobs().find((entry) => entry.operationId === operationId);
    if (!job || job.operationId !== operationId || !constantTimeEqual(job.operationDigest, digest)) throw operationError("DIGEST_MISMATCH", "Update job does not match the approved operation", 4);
    return job;
  }

  function listJobs() {
    return rawJobs().map(publicJob);
  }

  function rawJobs() {
    if (!fs.existsSync(updatesRoot)) return [];
    return fs.readdirSync(updatesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^update_[A-Za-z0-9-]+$/.test(entry.name)).map((entry) => readJson(path.join(updatesRoot, entry.name, "job.json"))).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function readJob(id) {
    if (!/^update_[A-Za-z0-9-]+$/.test(String(id || ""))) throw operationError("INVALID_ARGUMENT", "Invalid update job id", 2);
    return readJson(path.join(jobDirectory(id), "job.json"));
  }

  function jobDirectory(id) { return path.join(updatesRoot, id); }
  function writeJob(job) { fs.mkdirSync(jobDirectory(job.id), { recursive: true, mode: 0o700 }); atomicJson(path.join(jobDirectory(job.id), "job.json"), job); }
  function transition(job, status, detail = {}) { job.status = status; job.updatedAt = iso(now()); Object.assign(job, detail); writeJob(job); }
  function writeState(value) { fs.mkdirSync(updatesRoot, { recursive: true, mode: 0o700 }); atomicJson(stateFile, value); }

  async function fetchJson(url) { const response = await fetchImpl(url, { headers: { accept: "application/vnd.github+json", "user-agent": "personal-agent-updater/1" }, signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw operationError("UPDATE_CHECK_FAILED", `GitHub release check failed with HTTP ${response.status}`, 7); return response.json(); }
  async function fetchText(url, limit) { const response = await fetchImpl(url, { redirect: "follow", headers: { "user-agent": "personal-agent-updater/1" }, signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw operationError("UPDATE_CHECK_FAILED", `Release metadata download failed with HTTP ${response.status}`, 7); const text = await response.text(); if (Buffer.byteLength(text) > limit) throw operationError("UPDATE_METADATA_INVALID", "Release metadata is too large", 7); return text; }

  return { status, check, plan, planRollback, approve, apply, readJob, listJobs, updatesRoot, installRoot };
}

function requireProductDevelopmentState(config) {
  const state = readJson(path.join(config.dataRoot, "runtime", "product-development.json"));
  const workspaceValue = String(config.agentWorkspaceRoot || "").trim();
  const workspace = workspaceValue && path.isAbsolute(workspaceValue) ? path.resolve(workspaceValue) : "";
  const expectedCheckout = workspace ? path.resolve(workspace, "projects", "personal-agent") : "";
  const checkout = state?.checkoutPath ? path.resolve(state.checkoutPath) : "";
  if (state?.schemaVersion !== 1
    || state.repository !== "chenchen428/personal-agent"
    || state.ready !== true
    || !workspace
    || checkout !== expectedCheckout
    || checkout.includes(`${path.sep}core${path.sep}current`)
    || !fs.statSync(checkout, { throwIfNoEntry: false })?.isDirectory()) {
    throw operationError("PRODUCT_DEVELOPMENT_REQUIRED", "Autonomous update authorization requires the prepared registered product-development checkout", 5);
  }
}

function eligibleRelease(release, channel) { return release && !release.draft && (channel === "beta" || release.prerelease !== true) && /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(release.tag_name || "")); }
function normalizeChannel(value) { if (value !== "stable" && value !== "beta") throw operationError("INVALID_ARGUMENT", "Update channel must be stable or beta", 2); return value; }
function channelFor(version) { return String(version).includes("-") ? "beta" : "stable"; }
function platformKey() { return `${process.platform}-${process.arch}`; }
function updaterAssetName(tag) { const os = { win32: "windows", darwin: "macos", linux: "linux" }[process.platform]; const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : ""; if (!os || !arch) throw operationError("UNSUPPORTED_PLATFORM", `Updates are unavailable on ${process.platform}-${process.arch}`, 7); return `personal-agent-node-${tag}-${os}-${arch}-updater${process.platform === "win32" ? ".exe" : ""}`; }
function validateGitHubAssetUrl(value, tag, name) { const url = new URL(String(value || "")); const expected = `/${REPOSITORY}/releases/download/${tag}/${name}`; if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expected || url.username || url.password || url.search || url.hash) throw operationError("UPDATE_METADATA_INVALID", "Release metadata contains an unsafe artifact URL", 7); return url.toString(); }
function checksumFor(text, name) { const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const match = new RegExp(`^([a-f0-9]{64})\\s+\\*?${escaped}$`, "mi").exec(text); if (!match) throw operationError("UPDATE_METADATA_INVALID", `SHA256SUMS does not contain ${name}`, 7); return match[1].toLowerCase(); }
function previousReleaseId(installation) { const previous = String(installation?.previous || ""); return previous ? path.basename(previous.replace(/[\\/]$/, "")) : null; }
function packageVersion() { try { return JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version; } catch { return "0.0.0"; } }
function compareVersions(a, b) { const parse = (value) => { const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value).replace(/^v/, "")); return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] || ""] : [0, 0, 0, ""]; }; const left = parse(a), right = parse(b); for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1; if (left[3] === right[3]) return 0; if (!left[3]) return 1; if (!right[3]) return -1; return String(left[3]).localeCompare(String(right[3]), undefined, { numeric: true }); }
function publicJob(job) { if (!job) return null; const copy = JSON.parse(JSON.stringify(job)); delete copy.handoffNonce; delete copy.artifactPath; if (copy.artifact) delete copy.artifact.url; copy.active = ACTIVE_STATES.has(copy.status); return copy; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function atomicJson(file, value) { const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); try { fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); } try { fs.chmodSync(file, 0o600); } catch {} }
function constantTimeEqual(left, right) { const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || "")); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function iso(value) { return new Date(value).toISOString(); }

export const updateInternals = { compareVersions, updaterAssetName, checksumFor, channelFor };
