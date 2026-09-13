import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildManagedPageAccess } from "../server/managed-links.js";
import { calendarError, objectFields } from "../calendar/validation.js";
import { renderCalendarPosters, renderPagePoster, posterManagedMetadata } from "./index.js";
import { validatePosterTarget } from "./qr.js";
import { posterFailure } from "./diagnostics.js";

export class PosterService {
  constructor({ calendarStore, privatePublications, publicPagePosters, managedFiles, outputRoot, spaceId, externalAccess, renderCalendar = renderCalendarPosters, renderPage = renderPagePoster, now = Date.now } = {}) {
    Object.assign(this, { calendarStore, privatePublications, publicPagePosters, managedFiles, spaceId, externalAccess, renderCalendar, renderPage, now });
    this.outputRoot = path.resolve(outputRoot);
  }

  targetUrl(internalPath) {
    const access = typeof this.externalAccess === "function" ? this.externalAccess() : this.externalAccess;
    return validatePosterTarget(buildManagedPageAccess(internalPath, access).url);
  }

  async calendar(command, authorize) {
    objectFields(command, ["action", "entryId", "input"]);
    const input = command.input || {};
    objectFields(input, ["from", "to", "status", "query"]);
    authorize();
    const select = () => {
      if (command.entryId) return [this.calendarStore.requireEntry(command.entryId)];
      const result = this.calendarStore.list({ ...input, limit: 500 });
      if (result.hasMore || result.total !== result.items.length) throw calendarError(400, "POSTER_RANGE_TOO_LARGE", "日程过多，请缩短范围后生成海报");
      return result.items;
    };
    const entries = select();
    const snapshot = entries.map(({ id, revision }) => `${id}:${revision}`).join("|");
    const startAt = new Date(command.entryId ? entries[0].startAt : input.from || entries[0]?.startAt || this.now()).toISOString();
    const latestEnd = entries.reduce((end, entry) => Math.max(end, Date.parse(entry.endAt || entry.startAt)), Date.parse(startAt));
    const exclusiveEnd = Math.max(Date.parse(startAt) + 1, !command.entryId && input.to ? Date.parse(input.to) : latestEnd + 1);
    const to = new Date(exclusiveEnd).toISOString();
    const endAt = new Date(exclusiveEnd - 1).toISOString();
    const period = exclusiveEnd - Date.parse(startAt) > 86400000 ? "week" : "day";
    const params = new URLSearchParams({ period, from: startAt, to });
    for (const key of ["status", "query"]) if (input[key] !== undefined) params.set(key, String(input[key]));
    if (command.entryId) params.set("id", command.entryId);
    const targetUrl = this.targetUrl(`/app/mobile/calendar${params.size ? `?${params}` : ""}`);
    const assertCurrent = () => {
      authorize();
      if (select().map(({ id, revision }) => `${id}:${revision}`).join("|") !== snapshot) throw calendarError(409, "POSTER_CALENDAR_VERSION_CONFLICT", "日程已变化，请重新生成海报");
    };
    const rendered = await this.renderCalendar({ entries, targetUrl, startAt, endAt, timeZone: entries[0]?.timeZone || "Asia/Shanghai", period });
    assertCurrent();
    const images = await this.registerImages(rendered.images, assertCurrent);
    assertCurrent();
    return { action: "poster", data: { objectIds: images.map((image) => image.objectId), images, targetUrl } };
  }

  async page(command, authorize) {
    objectFields(command, ["action", "input"]);
    const input = command.input || {};
    objectFields(input, ["pageId", "sourceObjectId", "corner"]);
    authorize();
    if (!/^(?:private|public)-[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(String(input.pageId || ""))) throw calendarError(400, "POSTER_PAGE_UNSUPPORTED", "请选择当前空间的发布页生成海报");
    const privatePage = input.pageId.startsWith("private-");
    const pageStore = privatePage ? this.privatePublications : this.publicPagePosters;
    const publicationId = privatePage ? input.pageId.slice("private-".length) : input.pageId;
    const readVersion = () => {
      try { return pageStore.pageVersion(publicationId); }
      catch (error) { throw posterFailure(error); }
    };
    const pageVersion = readVersion();
    let targetUrl;
    try { targetUrl = this.targetUrl(`/app/mobile/pages/${encodeURIComponent(input.pageId)}`); }
    catch (error) { throw posterFailure(error, "POSTER_LINK_UNAVAILABLE"); }
    if (!/^obj_[a-f0-9]{24}$/.test(String(input.sourceObjectId || ""))) throw calendarError(400, "POSTER_SOURCE_REQUIRED", "请提供当前空间的受管图片 obj_ ID");
    let source;
    try { source = this.managedFiles.stat(input.sourceObjectId); }
    catch { throw posterFailure(null, "POSTER_SOURCE_NOT_READY"); }
    if (source.status !== "ready") throw posterFailure(null, "POSTER_SOURCE_NOT_READY");
    if (source.status !== "ready" || (source.spaceId && source.spaceId !== this.spaceId) || !["image/png", "image/jpeg", "image/webp"].includes(source.contentType) || source.sizeBytes > 25 * 1024 * 1024) throw calendarError(403, "POSTER_SOURCE_DENIED", "底图必须是当前空间已就绪的 PNG、JPEG 或 WebP 图片");
    let materialized;
    try { materialized = await this.managedFiles.materialize(input.sourceObjectId, { taskId: `poster-${publicationId}`, ttlDays: 1 }); }
    catch { throw posterFailure(null, "POSTER_SOURCE_NOT_READY"); }
    const assertCurrent = () => {
      authorize();
      if (readVersion() !== pageVersion) throw posterFailure(null, "POSTER_PAGE_VERSION_CONFLICT");
    };
    assertCurrent();
    if (!materialized.verified || !materialized.localPath) throw posterFailure(null, "POSTER_SOURCE_CHANGED");
    let image;
    try { image = fs.readFileSync(materialized.localPath); }
    catch { throw posterFailure(null, "POSTER_SOURCE_NOT_READY"); }
    if (image.length !== source.sizeBytes || crypto.createHash("sha256").update(image).digest("hex") !== source.sha256) throw posterFailure(null, "POSTER_SOURCE_CHANGED");
    let rendered;
    try { rendered = await this.renderPage({ image, targetUrl, pageId: input.pageId, pageVersion, corner: input.corner }); }
    catch (error) { throw posterFailure(error, "POSTER_RENDER_FAILED"); }
    assertCurrent();
    let images;
    try { images = await this.registerImages([rendered], assertCurrent); }
    catch (error) { authorize(); throw posterFailure(error, "POSTER_REGISTRATION_FAILED"); }
    assertCurrent();
    let binding;
    try { binding = pageStore.bindPoster({ publicationId, pageVersion, ...images[0] }); }
    catch (error) { throw posterFailure(error); }
    return { action: "page-poster", data: { pageId: input.pageId, pageVersion, objectIds: images.map((item) => item.objectId), images, targetUrl, binding } };
  }

  async registerImages(images, authorize) {
    if (!Array.isArray(images) || !images.length || images.length > 10) throw calendarError(400, "POSTER_RANGE_TOO_LARGE", "海报须为一至十张图片");
    authorize();
    const jobId = `poster-${crypto.randomBytes(12).toString("hex")}`;
    const directory = path.join(this.outputRoot, jobId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const image of images) {
      if (!Buffer.isBuffer(image.buffer) || path.basename(image.fileName) !== image.fileName || !image.fileName.endsWith(".png")) throw new Error("invalid rendered poster");
      fs.writeFileSync(path.join(directory, image.fileName), image.buffer, { flag: "wx", mode: 0o600 });
    }
    const result = await this.managedFiles.reconcileLocalTree({ root: directory, visibility: "private", source: "poster", prefix: `posters/${jobId}`, execute: true });
    authorize();
    if (result.failed || result.results.length !== images.length || result.results.some((item) => !item.objectId)) throw calendarError(500, "POSTER_REGISTRATION_FAILED", "海报文件登记失败，未发送图片");
    return images.map((image) => {
      const record = result.results.find((item) => item.relativePath === image.fileName);
      const object = this.managedFiles.catalog.get(record.objectId);
      const meta = posterManagedMetadata(image);
      this.managedFiles.catalog.upsertObject({ ...object, metadata: { ...object.metadata, ...meta.metadata, spaceId: this.spaceId } });
      const verified = this.managedFiles.stat(record.objectId);
      if (verified.status !== "ready" || verified.sha256 !== image.sha256) throw calendarError(500, "POSTER_REGISTRATION_FAILED", "海报登记校验未通过");
      return { objectId: record.objectId, fileName: image.fileName, mimeType: image.mimeType, width: image.width, height: image.height, sha256: image.sha256, sizeBytes: image.sizeBytes, alt: image.alt, ...(image.pageNumber ? { pageNumber: image.pageNumber, pageCount: image.pageCount } : {}) };
    });
  }
}
