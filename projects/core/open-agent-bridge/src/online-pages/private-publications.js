import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class PrivatePublicationStore {
  constructor({ rootDir, baseUrl } = {}) {
    this.rootDir = path.resolve(rootDir || process.cwd());
    this.baseUrl = String(baseUrl || "").replace(/\/+$/, "");
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.rootDir, 0o700);
  }

  upload({ publicationId, fileName, content, encoding = "utf8", mimeType = "", overwrite = false } = {}) {
    const id = publicationId ? safeSegment(publicationId) : `report-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(5).toString("hex")}`;
    const name = safeFileName(fileName || "index.html");
    const directory = path.join(this.rootDir, id);
    const target = path.join(directory, name);
    if (fs.existsSync(target) && !overwrite) throw new Error("private publication file already exists");
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    const bytes = encoding === "base64" ? Buffer.from(String(content || ""), "base64") : Buffer.from(String(content || ""), "utf8");
    if (!bytes.length) throw new Error("publication content is required");
    const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temp, bytes, { mode: 0o600 });
    fs.renameSync(temp, target);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const manifestPath = path.join(directory, "publication.json");
    const current = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { id, createdAt: new Date().toISOString(), files: [] };
    const entry = { name, mimeType: mimeType || mimeFromName(name), sizeBytes: bytes.length, sha256, updatedAt: new Date().toISOString() };
    current.files = [...current.files.filter((item) => item.name !== name), entry].sort((a, b) => a.name.localeCompare(b.name));
    current.updatedAt = entry.updatedAt;
    fs.writeFileSync(manifestPath, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    return { ...entry, publicationId: id, url: `${this.baseUrl}/publications/${encodeURIComponent(id)}/${encodeURIComponent(name)}` };
  }

  list() {
    return fs.readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const manifestPath = path.join(this.rootDir, entry.name, "publication.json");
        if (!fs.existsSync(manifestPath)) return null;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        return { ...manifest, url: `${this.baseUrl}/publications/${encodeURIComponent(entry.name)}/index.html` };
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  resolve(publicationId, fileName = "index.html") {
    const id = safeSegment(publicationId);
    const name = safeFileName(fileName);
    const filePath = path.resolve(this.rootDir, id, name);
    const expected = `${path.resolve(this.rootDir, id)}${path.sep}`;
    if (!filePath.startsWith(expected)) throw new Error("invalid publication path");
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return { filePath, mimeType: mimeFromName(name), fileName: name };
  }
}

function safeSegment(value) {
  const segment = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(segment)) throw new Error("invalid publication id");
  return segment;
}

function safeFileName(value) {
  const name = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!name || name.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new Error("invalid publication file name");
  return name;
}

function mimeFromName(name) {
  const extension = path.extname(name).toLowerCase();
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" })[extension] || "application/octet-stream";
}
