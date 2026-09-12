import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { CalendarStore } from "../src/calendar/store.js";
import { PosterService } from "../src/posters/service.js";
import { PrivatePublicationStore } from "../src/online-pages/private-publications.js";
import { ManagedFileCatalog } from "../src/managed-files/catalog.js";
import { ManagedFileService } from "../src/managed-files/service.js";
import { LocalManagedProvider } from "../src/managed-files/local-provider.js";
import { PublicPagePosterStore } from "../src/posters/public-pages.js";

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cove-poster-service-"));
  const calendarStore = new CalendarStore({ dataDir: path.join(root, "calendar"), spaceId: "space-a", sessionResolver: (id) => id === "main" ? { id, role: "main", spaceId: "space-a" } : null });
  const catalog = new ManagedFileCatalog({ dataDir: path.join(root, "catalog") });
  const outputRoot = path.join(root, "files", "managed");
  const managedFiles = new ManagedFileService({ catalog, remote: new LocalManagedProvider({ rootDir: path.join(root, "storage") }), managedRoots: [outputRoot], migrationRoots: [outputRoot], materializedDir: path.join(root, "materialized") });
  const privatePublications = new PrivatePublicationStore({ rootDir: path.join(root, "publications") });
  const service = new PosterService({ calendarStore, privatePublications, managedFiles, outputRoot, spaceId: "space-a", externalAccess: () => ({ ready: true, origin: "https://space.example.com" }) });
  t.after(() => { calendarStore.close(); catalog.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, calendarStore, catalog, managedFiles, privatePublications, service };
}
const data = { title: "安排讨论", participants: ["林沐", "Alex"], startAt: "2026-09-12T09:00:00+08:00", timeZone: "Asia/Shanghai" };

test("calendar poster resolves current-Space mobile URL and returns verified native image objects", async (t) => {
  const { service, calendarStore, managedFiles } = setup(t);
  calendarStore.create({ sessionId: "main" }, data);
  const result = await service.calendar({ action: "poster", input: { from: "2026-09-12T00:00:00+08:00", to: "2026-09-13T00:00:00+08:00" } }, () => true);
  assert.equal(result.data.objectIds.length, 1);
  const url = new URL(result.data.targetUrl);
  assert.equal(url.origin, "https://space.example.com");
  assert.equal(url.pathname, "/app/mobile/calendar");
  assert.equal(url.searchParams.get("from"), "2026-09-11T16:00:00.000Z");
  assert.equal(url.searchParams.get("to"), "2026-09-12T16:00:00.000Z");
  const file = managedFiles.stat(result.data.objectIds[0]);
  assert.equal(file.status, "ready"); assert.equal(file.visibility, "private"); assert.equal(file.spaceId, "space-a");
  assert.doesNotMatch(JSON.stringify(result), /localPath|migrationRoot|file:\/\//);
});

test("poster selection rejects incomplete lists, injected URLs and changed revisions", async (t) => {
  const { service, calendarStore } = setup(t);
  const entry = calendarStore.create({ sessionId: "main" }, data);
  await assert.rejects(service.calendar({ action: "poster", input: { targetUrl: "https://evil.example" } }, () => true), { code: "INVALID_CALENDAR_FIELD" });
  const list = calendarStore.list.bind(calendarStore);
  calendarStore.list = () => ({ items: [entry], total: 501, hasMore: true });
  await assert.rejects(service.calendar({ action: "poster", input: {} }, () => true), { code: "POSTER_RANGE_TOO_LARGE" });
  calendarStore.list = list;
  service.renderCalendar = async () => { calendarStore.update({ sessionId: "main" }, entry.id, { title: "新安排", expectedRevision: 1 }); return { images: [] }; };
  await assert.rejects(service.calendar({ action: "poster", input: {} }, () => true), { code: "POSTER_CALENDAR_VERSION_CONFLICT" });
  service.externalAccess = () => ({ ready: false });
  await assert.rejects(service.calendar({ action: "poster", input: {} }, () => true), { code: "POSTER_LINK_UNAVAILABLE" });
});

test("Page poster uses a governed current-Space image, binds a version and never copies a supplied URL", async (t) => {
  const { root, service, privatePublications, managedFiles, catalog } = setup(t);
  privatePublications.upload({ publicationId: "demo", fileName: "index.html", content: "<h1>Current</h1>" });
  const manifestPath = path.join(root, "publications", "demo", "publication.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.page = { pageId: "private-demo", entryFile: "index.html", title: "Demo", assets: [] };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const sourceDir = path.join(service.outputRoot, "source");
  fs.mkdirSync(sourceDir, { recursive: true });
  await sharp({ create: { width: 1200, height: 1600, channels: 3, background: "#234449" } }).png().toFile(path.join(sourceDir, "source.png"));
  const registered = await managedFiles.reconcileLocalTree({ root: sourceDir, source: "test", prefix: "source", execute: true });
  const sourceObjectId = registered.results[0].objectId;
  const result = await service.page({ action: "page-poster", input: { pageId: "private-demo", sourceObjectId } }, () => true);
  assert.equal(result.data.targetUrl, "https://space.example.com/app/mobile/pages/private-demo");
  assert.equal(privatePublications.currentPoster("demo").objectId, result.data.objectIds[0]);
  assert.equal(managedFiles.stat(result.data.objectIds[0]).spaceId, "space-a");
  const source = catalog.get(sourceObjectId);
  catalog.upsertObject({ ...source, metadata: { ...source.metadata, spaceId: "space-other" } });
  await assert.rejects(service.page({ action: "page-poster", input: { pageId: "private-demo", sourceObjectId } }, () => true), { code: "POSTER_SOURCE_DENIED" });
  await assert.rejects(service.page({ action: "page-poster", input: { pageId: "private-other", sourceObjectId } }, () => true), { code: "POSTER_PAGE_NOT_FOUND" });
});

test("unbounded and single-event calendar posters carry the exact resolved interval in the QR", async (t) => {
  const { service, calendarStore } = setup(t);
  const first = calendarStore.create({ sessionId: "main" }, data);
  const second = calendarStore.create({ sessionId: "main" }, { ...data, startAt: "2026-11-12T09:00:00+08:00" });
  const all = await service.calendar({ action: "poster", input: {} }, () => true);
  const url = new URL(all.data.targetUrl);
  assert.equal(url.searchParams.get("from"), first.startAt);
  assert.equal(Date.parse(url.searchParams.get("to")), Date.parse(second.startAt) + 1);
  assert.equal(url.searchParams.get("period"), "week");
  const single = new URL((await service.calendar({ action: "poster", entryId: first.id, input: {} }, () => true)).data.targetUrl);
  assert.equal(single.searchParams.get("id"), first.id);
  assert.equal(single.searchParams.get("from"), first.startAt);
  assert.equal(Date.parse(single.searchParams.get("to")), Date.parse(first.startAt) + 1);
});

test("public Page bindings invalidate when HTML or referenced assets change, without changing the Page source", (t) => {
  const { root } = setup(t);
  const uploadsRoot = path.join(root, "uploads");
  const directory = path.join(uploadsRoot, "demo"); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "index.html"), "<h1>Public</h1>");
  fs.writeFileSync(path.join(directory, "style.css"), "body{color:green}");
  const manifest = JSON.stringify({ schemaVersion: 1, pageId: "public-demo", entryFile: "index.html", assets: [{ fileName: "style.css" }] });
  fs.writeFileSync(path.join(directory, ".page.json"), manifest);
  const store = new PublicPagePosterStore({ uploadsRoot, bindingRoot: path.join(root, "bindings") });
  const pageVersion = store.pageVersion("public-demo");
  store.bindPoster({ publicationId: "public-demo", pageVersion, objectId: `obj_${"a".repeat(24)}`, sha256: "b".repeat(64), width: 1200, height: 1600 });
  assert.ok(store.currentPoster("public-demo"));
  assert.equal(fs.readFileSync(path.join(directory, ".page.json"), "utf8"), manifest);
  fs.writeFileSync(path.join(directory, "style.css"), "body{color:blue}");
  assert.equal(store.currentPoster("public-demo"), null);
  assert.throws(() => store.bindPoster({ publicationId: "public-demo", pageVersion, objectId: `obj_${"a".repeat(24)}`, sha256: "b".repeat(64), width: 1200, height: 1600 }), { code: "POSTER_PAGE_VERSION_CONFLICT" });
});
