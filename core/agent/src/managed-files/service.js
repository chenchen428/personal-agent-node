import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";

export class ManagedFileService {
  constructor({ catalog, remote, managedRoots = [], migrationRoots = [], materializedDir, retentionDays = 30, materializedTtlDays = 7 } = {}) {
    if (!catalog) throw new Error("managed file catalog is required");
    this.catalog = catalog;
    this.remote = remote;
    this.managedRoots = managedRoots.map((item) => path.resolve(item));
    this.migrationRoots = migrationRoots.map((item) => path.resolve(item));
    this.materializedDir = path.resolve(materializedDir || path.join(catalog.dataDir, "materialized"));
    this.retentionDays = boundedDays(retentionDays, 30);
    this.materializedTtlDays = boundedDays(materializedTtlDays, 7);
    fs.mkdirSync(this.materializedDir, { recursive: true });
    if (!this.managedRoots.includes(this.materializedDir)) this.managedRoots.push(this.materializedDir);
  }

  search(input = {}) {
    return this.catalog.search(input).map((object) => summarize(object));
  }

  stat(id) {
    const object = this.catalog.get(id);
    if (!object) throw Object.assign(new Error("managed object not found"), { code: "ENOENT" });
    return summarize(object);
  }

  async materialize(id, { ttlDays, taskId = "" } = {}) {
    const object = this.catalog.get(id);
    if (!object) throw Object.assign(new Error("managed object not found"), { code: "ENOENT" });
    const requestedTtlDays = boundedDays(ttlDays, this.materializedTtlDays);
    let existing = null;
    for (const copy of object.localCopies.filter((item) => item.tier !== "shadow")) {
      if (!fs.existsSync(copy.localPath)) continue;
      const stat = fs.statSync(copy.localPath);
      const digest = stat.isFile() ? await sha256File(copy.localPath) : "";
      if (stat.isFile() && stat.size === object.sizeBytes && digest === object.sha256) {
        existing = copy;
        break;
      }
      this.catalog.removeLocalCopy(object.id, copy.localPath, {
        reason: "local-integrity-check-failed",
        expectedSha256: object.sha256,
        actualSha256: digest,
      });
    }
    if (existing) {
      let updated = object;
      if (taskId) {
        updated = this.catalog.recordLocalCopy(object.id, {
          ...existing,
          localPath: existing.localPath,
          taskLeaseUntil: new Date(Date.now() + requestedTtlDays * 86400000).toISOString(),
        });
      }
      return { ...summarize(updated), tier: existing.tier, localPath: existing.localPath, verified: true };
    }
    if (object.status !== "ready" || !object.remoteVerifiedAt) throw new Error("managed object has no verified remote copy");
    if (!this.remote?.download) throw new Error("managed object remote provider is unavailable");

    const taskSegment = safeSegment(taskId || "shared");
    const targetDir = path.join(this.materializedDir, taskSegment);
    const targetPath = path.join(targetDir, `${object.id}-${safeSegment(object.originalName || "file")}`);
    assertInside(this.materializedDir, targetPath);
    fs.mkdirSync(targetDir, { recursive: true });
    const temporaryPath = `${targetPath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await this.remote.download(object, temporaryPath);
      const stat = fs.statSync(temporaryPath);
      const digest = await sha256File(temporaryPath);
      if (stat.size !== object.sizeBytes || digest !== object.sha256) {
        this.catalog.updateStatus(object.id, "corrupt", { operation: "materialize", expectedSize: object.sizeBytes, actualSize: stat.size });
        throw new Error("materialized file does not match the catalog checksum");
      }
      fs.rmSync(targetPath, { force: true });
      fs.renameSync(temporaryPath, targetPath);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + requestedTtlDays * 86400000).toISOString();
      const updated = this.catalog.recordLocalCopy(object.id, {
        localPath: targetPath,
        tier: "materialized",
        sha256: digest,
        sizeBytes: stat.size,
        verifiedAt: now.toISOString(),
        lastMaterializedAt: now.toISOString(),
        expiresAt,
        taskLeaseUntil: taskId ? expiresAt : null,
      });
      return { ...summarize(updated), tier: "materialized", localPath: targetPath, verified: true, expiresAt };
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }

  pin(id, { days = 30, reason = "" } = {}) {
    const object = this.catalog.get(id);
    if (!object) throw Object.assign(new Error("managed object not found"), { code: "ENOENT" });
    if (!object.localCopies.some((copy) => copy.tier !== "shadow" && fs.existsSync(copy.localPath))) {
      throw new Error("materialize the managed object before pinning it");
    }
    const pinnedUntil = new Date(Date.now() + boundedDays(days, 30) * 86400000).toISOString();
    return summarize(this.catalog.setPin(id, pinnedUntil, reason));
  }

  unpin(id) {
    return summarize(this.catalog.clearPin(id));
  }

  async gc({ execute = false, now = new Date() } = {}) {
    const candidates = this.catalog.evictionCandidates({ now, retentionDays: this.retentionDays });
    const results = [];
    for (const candidate of candidates) {
      const { object, copy } = candidate;
      const result = { objectId: object.id, localPath: copy.localPath, action: execute ? "skipped" : "would-delete", reason: "" };
      try {
        this.assertManagedPath(copy.localPath);
        if (!fs.existsSync(copy.localPath)) {
          if (execute) this.catalog.removeLocalCopy(object.id, copy.localPath, { reason: "missing-local-file" });
          result.action = execute ? "catalog-pruned" : "would-prune-catalog";
          results.push(result);
          continue;
        }
        const localStat = fs.statSync(copy.localPath);
        const localSha = await sha256File(copy.localPath);
        if (localStat.size !== object.sizeBytes || localSha !== object.sha256) throw new Error("local checksum mismatch");
        if (!this.remote?.head) throw new Error("remote provider is unavailable");
        const remote = await this.remote.head(object);
        if (!remote) throw new Error("remote object is missing");
        if (Number(remote.sizeBytes) !== object.sizeBytes) throw new Error("remote size mismatch");
        if (!remote.sha256 || remote.sha256 !== object.sha256) throw new Error("remote SHA-256 metadata is missing or different");
        if (execute) {
          fs.rmSync(copy.localPath);
          this.catalog.removeLocalCopy(object.id, copy.localPath, { reason: "cold-tier-gc", remoteVerifiedAt: remote.verifiedAt || "" });
          removeEmptyParents(path.dirname(copy.localPath), this.managedRoots);
          result.action = "deleted-local-copy";
        }
      } catch (error) {
        result.action = "skipped";
        result.reason = error instanceof Error ? error.message : String(error);
      }
      results.push(result);
    }
    return {
      ok: results.every((item) => item.action !== "skipped"),
      execute,
      retentionDays: this.retentionDays,
      candidates: results.length,
      results,
    };
  }

  async reconcileLocalTree({ root, visibility = "private", source = "migration", prefix = "", excludeRelativePaths = [], execute = false } = {}) {
    const resolvedRoot = path.resolve(String(root || ""));
    if (!this.migrationRoots.some((allowed) => inside(allowed, resolvedRoot))) {
      throw new Error("migration root is outside the configured allowlist");
    }
    const excluded = new Set((Array.isArray(excludeRelativePaths) ? excludeRelativePaths : [])
      .map(normalizeRelativePath)
      .filter(Boolean));
    const discoveredFiles = listRegularFiles(resolvedRoot);
    const files = discoveredFiles.filter((file) => !excluded.has(file.relativePath));
    const currentTime = Date.now();
    const hotCutoff = currentTime - this.retentionDays * 86400000;
    const summary = {
      ok: true,
      execute,
      root: resolvedRoot,
      visibility: visibility === "public" ? "public" : "private",
      source: String(source || "migration").slice(0, 120),
      prefix: normalizePrefix(prefix),
      excludedFiles: discoveredFiles.length - files.length,
      files: files.length,
      bytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      hotFiles: files.filter((file) => file.mtimeMs >= hotCutoff).length,
      coldFiles: files.filter((file) => file.mtimeMs < hotCutoff).length,
      uploaded: 0,
      verifiedExisting: 0,
      failed: 0,
      results: [],
    };
    if (execute && !this.remote?.configured?.(summary.visibility)) throw new Error(`${summary.visibility} local managed storage is not configured`);

    for (const file of files) {
      const tier = file.mtimeMs >= hotCutoff ? "hot" : "cold";
      const result = {
        relativePath: file.relativePath,
        sizeBytes: file.sizeBytes,
        modifiedAt: new Date(file.mtimeMs).toISOString(),
        sha256: "",
        tier,
        action: "failed",
        objectId: "",
        error: "",
      };
      try {
        const sha256 = await sha256File(file.localPath);
        result.sha256 = sha256;
        const managedRelativePath = [summary.prefix, file.relativePath].filter(Boolean).join("/");
        if (!execute) {
          result.action = `would-upload-${tier}`;
          summary.results.push(result);
          continue;
        }

        const existingObject = this.catalog.getByRelativePath(summary.visibility, managedRelativePath);
        let remote = null;
        let reusedExisting = false;
        if (existingObject?.status === "ready" && existingObject.sha256 === sha256 && existingObject.remoteVerifiedAt) {
          const verified = await this.remote.head(existingObject);
          if (verified && Number(verified.sizeBytes) === file.sizeBytes && verified.sha256 === sha256) {
            remote = {
              bucket: existingObject.bucket,
              region: existingObject.region,
              objectKey: existingObject.objectKey,
              crc64: verified.crc64 || existingObject.crc64,
              versionId: verified.versionId || existingObject.versionId,
              verifiedAt: verified.verifiedAt || new Date().toISOString(),
              sizeBytes: verified.sizeBytes,
              sha256: verified.sha256,
            };
            reusedExisting = true;
          }
        }
        if (!remote) {
          remote = await this.remote.put({
            visibility: summary.visibility,
            relativePath: managedRelativePath,
            filePath: file.localPath,
            contentType: mime.lookup(file.localPath) || "application/octet-stream",
            sha256,
            cacheControl: summary.visibility === "public" ? cacheControlFor(file.relativePath) : "",
          });
          if (remote.sizeBytes !== file.sizeBytes || remote.sha256 !== sha256) throw new Error("remote read-back metadata differs from the local file");
        }
        if (existingObject && existingObject.sha256 !== sha256) {
          for (const copy of existingObject.localCopies) {
            this.catalog.removeLocalCopy(existingObject.id, copy.localPath, { reason: "migration-content-changed" });
          }
        }
        const uploadedAt = existingObject?.sha256 === sha256
          ? existingObject.uploadedAt
          : new Date().toISOString();
        let object = this.catalog.upsertObject({
          visibility: summary.visibility,
          source: summary.source,
          bucket: remote.bucket,
          region: remote.region,
          objectKey: remote.objectKey,
          relativePath: managedRelativePath,
          originalName: path.basename(file.localPath),
          contentType: mime.lookup(file.localPath) || "application/octet-stream",
          sizeBytes: file.sizeBytes,
          sha256,
          crc64: remote.crc64 || "",
          versionId: remote.versionId || "",
          status: "ready",
          uploadedAt,
          remoteVerifiedAt: remote.verifiedAt || uploadedAt,
          metadata: { migrationRoot: resolvedRoot, sourceModifiedAt: result.modifiedAt },
        });
        if (tier === "hot") {
          object = this.catalog.recordLocalCopy(object.id, {
            localPath: file.localPath,
            tier: "hot",
            sha256,
            sizeBytes: file.sizeBytes,
            verifiedAt: new Date().toISOString(),
          });
        } else {
          object = this.catalog.recordLocalCopy(object.id, {
            localPath: file.localPath,
            tier: "shadow",
            sha256,
            sizeBytes: file.sizeBytes,
            verifiedAt: new Date().toISOString(),
          });
        }
        result.action = `${reusedExisting ? "verified-existing" : "uploaded"}-${tier}`;
        result.objectId = object.id;
        if (reusedExisting) summary.verifiedExisting += 1;
        else summary.uploaded += 1;
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        summary.failed += 1;
        summary.ok = false;
      }
      summary.results.push(result);
    }
    return summary;
  }

  assertManagedPath(filePath) {
    const resolved = path.resolve(filePath);
    if (!this.managedRoots.some((root) => inside(root, resolved))) throw new Error("local path is outside managed roots");
    return resolved;
  }
}

export async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function summarize(object) {
  const copy = object.localCopies.find((item) => item.tier !== "shadow" && fs.existsSync(item.localPath)) || null;
  return {
    objectId: object.id,
    visibility: object.visibility,
    source: object.source,
    relativePath: object.relativePath,
    originalName: object.originalName,
    contentType: object.contentType,
    sizeBytes: object.sizeBytes,
    sha256: object.sha256,
    status: object.status,
    spaceId: String(object.metadata?.spaceId || ""),
    securityStatus: String(object.metadata?.securityStatus || object.metadata?.scanStatus || ""),
    uploadedAt: object.uploadedAt,
    tier: copy?.tier || "cold",
    localPath: copy?.localPath || "",
    verified: Boolean(copy && object.remoteVerifiedAt),
    expiresAt: copy?.expiresAt || "",
    pinnedUntil: copy?.pinnedUntil || "",
  };
}

function boundedDays(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 3650) : fallback;
}

function safeSegment(value) {
  const normalized = String(value || "file").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 180) || "file";
}

function assertInside(root, target) {
  if (!inside(path.resolve(root), path.resolve(target))) throw new Error("path escapes the managed root");
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function removeEmptyParents(start, roots) {
  let current = path.resolve(start);
  while (roots.some((root) => inside(root, current)) && !roots.some((root) => path.resolve(root) === current)) {
    try {
      if (fs.readdirSync(current).length > 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch {
      break;
    }
  }
}

function listRegularFiles(root) {
  const results = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        results.push({
          localPath: fullPath,
          relativePath: path.relative(root, fullPath).split(path.sep).join("/"),
          sizeBytes: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  }
  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function normalizePrefix(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) throw new Error("invalid migration prefix");
  return normalized;
}

function normalizeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "";
  return normalized;
}

function cacheControlFor(relativePath) {
  return /(?:^|\/)index\.html$/i.test(relativePath)
    ? "no-cache, no-store, must-revalidate"
    : "public, max-age=31536000, immutable";
}
