import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { calendarError } from "../calendar/validation.js";

// Public Page content stays in its existing owner. Poster bindings are private
// metadata; publishing a poster never rewrites the public Page's source files.
export class PublicPagePosterStore {
  constructor({ uploadsRoot, bindingRoot }) {
    this.uploadsRoot = path.resolve(uploadsRoot);
    this.bindingRoot = path.resolve(bindingRoot);
  }

  pageVersion(pageId) {
    const matches = [];
    const visit = (directory) => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.name === ".page.json" && fs.statSync(target).size < 1024 * 1024) {
          try { const manifest = JSON.parse(fs.readFileSync(target, "utf8")); if (manifest.pageId === pageId) matches.push({ directory, manifest }); } catch { /* unrelated malformed manifest */ }
        }
      }
    };
    visit(this.uploadsRoot);
    if (matches.length !== 1) throw calendarError(404, "POSTER_PAGE_NOT_FOUND", "当前空间没有可唯一定位的发布页");
    const { directory, manifest } = matches[0];
    const names = new Set([manifest.entryFile, ...(manifest.assets || []).map((item) => item.fileName), ...Object.values(manifest.thumbnails || {}).map((item) => item.fileName)]);
    const files = [...names].sort().map((name) => {
      if (typeof name !== "string" || !name || name.includes("\\") || name.split("/").some((part) => !part || part === "." || part === "..")) throw calendarError(409, "POSTER_PAGE_NOT_FOUND", "发布页资产引用无效");
      const target = path.resolve(directory, name);
      if (!target.startsWith(`${directory}${path.sep}`) || !fs.realpathSync(target).startsWith(`${fs.realpathSync(directory)}${path.sep}`)) throw calendarError(409, "POSTER_PAGE_NOT_FOUND", "发布页资产超出范围");
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024) throw calendarError(409, "POSTER_PAGE_NOT_FOUND", "发布页资产无效");
      return { name, sha256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") };
    });
    return crypto.createHash("sha256").update(JSON.stringify({ manifest, files })).digest("hex");
  }

  bindingPath(pageId) {
    if (!/^public-[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(String(pageId || ""))) throw calendarError(400, "POSTER_PAGE_NOT_FOUND", "发布页ID无效");
    return path.join(this.bindingRoot, `${crypto.createHash("sha256").update(pageId).digest("hex")}.json`);
  }

  bindPoster({ publicationId: pageId, pageVersion, objectId, sha256, width, height }) {
    if (this.pageVersion(pageId) !== pageVersion) throw calendarError(409, "POSTER_PAGE_VERSION_CONFLICT", "发布页已变化，请重新生成海报");
    if (!/^obj_[a-f0-9]{24}$/.test(String(objectId || "")) || !/^[a-f0-9]{64}$/.test(String(sha256 || "")) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw calendarError(400, "POSTER_REGISTRATION_FAILED", "海报受管对象信息无效");
    const target = this.bindingPath(pageId);
    const binding = { objectId, sha256, width, height, pageVersion, createdAt: new Date().toISOString() };
    fs.mkdirSync(this.bindingRoot, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(binding), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, target);
    return binding;
  }

  currentPoster(pageId) {
    try {
      const binding = JSON.parse(fs.readFileSync(this.bindingPath(pageId), "utf8"));
      return binding.pageVersion === this.pageVersion(pageId) ? binding : null;
    } catch { return null; }
  }
}
