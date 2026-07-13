import fs from "node:fs";
import path from "node:path";
import { sha256File, sha256Buffer } from "./service.js";

export class LocalManagedProvider {
  constructor({ rootDir, publicBaseUrl = "" } = {}) {
    this.rootDir = path.resolve(rootDir || ".local-managed-objects");
    this.publicBaseUrl = String(publicBaseUrl || "").replace(/\/+$/, "");
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
  }

  settings(visibility) {
    return { visibility, bucket: "local-disk", region: "local", prefix: visibility, baseUrl: this.publicBaseUrl };
  }

  configured() {
    return true;
  }

  async put({ visibility, relativePath, body, filePath, sha256 }) {
    const objectKey = normalizeObjectKey(relativePath);
    const target = this.resolve(visibility, objectKey);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    if (filePath) fs.copyFileSync(filePath, temporary);
    else fs.writeFileSync(temporary, body);
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
    const stat = fs.statSync(target);
    const digest = filePath ? await sha256File(target) : sha256Buffer(Buffer.from(body));
    if (sha256 && digest !== sha256) throw new Error("local managed object checksum differs after write");
    return {
      uploaded: true,
      bucket: "local-disk",
      region: "local",
      objectKey,
      publicUrl: visibility === "public" ? this.publicUrl({ objectKey }) : "",
      sizeBytes: stat.size,
      sha256: digest,
      verifiedAt: new Date().toISOString(),
    };
  }

  async head(object) {
    const target = this.resolve(object.visibility, object.objectKey);
    if (!fs.existsSync(target)) return null;
    const stat = fs.statSync(target);
    return { sizeBytes: stat.size, sha256: await sha256File(target), verifiedAt: new Date().toISOString() };
  }

  async download(object, targetPath) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(this.resolve(object.visibility, object.objectKey), targetPath);
    return targetPath;
  }

  publicUrl(object) {
    return `${this.publicBaseUrl}/${String(object.objectKey).split("/").map(encodeURIComponent).join("/")}`;
  }

  async verifyStorage({ execute = false } = {}) {
    return { ok: true, execute, action: "local-disk-ready", rootDir: this.rootDir };
  }

  resolve(visibility, objectKey) {
    const root = path.join(this.rootDir, visibility === "public" ? "public" : "private");
    const target = path.resolve(root, normalizeObjectKey(objectKey));
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("local managed object path escapes its root");
    return target;
  }
}

function normalizeObjectKey(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid local managed object path");
  return normalized;
}
