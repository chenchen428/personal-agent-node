import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import QRCode from "qrcode";
import sharp from "sharp";
import { renderCalendarPosters, layoutCalendarPosters, renderPagePoster, createPosterQr, validatePosterTarget, posterManagedMetadata } from "../src/posters/index.js";
import { createTypography } from "../src/posters/text.js";
import { PrivatePublicationStore } from "../src/online-pages/private-publications.js";

const targetUrl = "https://calendar.example.com/app/mobile/calendar";
const entry = (id = "cal_1", extra = {}) => ({ id, title: "Cove 产品讨论与设计复盘", participants: ["林沐", "周可"], startAt: "2026-09-12T01:00:00Z", endAt: "2026-09-12T02:00:00Z", timeZone: "Asia/Shanghai", status: "planned", location: "海湾会议室", ...extra });

test("Calendar poster renders deterministically using the shipped font file", async () => {
  const input = { entries: [entry()], targetUrl, startAt: "2026-09-12T00:00:00Z", timeZone: "Asia/Shanghai" };
  const result = await renderCalendarPosters(input);
  const again = await renderCalendarPosters(input);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].sha256, again.images[0].sha256);
  assert.equal((await sharp(result.images[0].buffer).metadata()).width, 1200);
  assert.deepEqual(result.images[0].entryIds, ["cal_1"]);
  assert.equal(posterManagedMetadata(result.images[0]).visibility, "private");
  assert.throws(() => createTypography({ fontPath: path.join(os.tmpdir(), "no-such-cove-font.ttf") }), { code: "POSTER_FONT_UNAVAILABLE" });
});

test("multilingual long content, all participants and overnight dates remain complete across pages", async () => {
  const title = "跨午夜的全球协作：从访谈记录到 Research insights 与下一轮产品验证，确认每一项行动都有明确负责人。".repeat(4);
  const participants = Array.from({ length: 32 }, (_, index) => `参与者${index + 1} / Team member ${index + 1}`);
  const { pages } = await layoutCalendarPosters({ entries: [entry("overnight", { title, participants, startAt: "2026-09-12T15:30:00Z", endAt: "2026-09-12T17:15:00Z" })] });
  assert.ok(pages.length > 1);
  const fragments = pages.flat();
  assert.equal(fragments.flatMap((block) => block.lines).filter((line) => line.field === "title").map((line) => line.text).join(""), title);
  assert.equal(fragments.flatMap((block) => block.lines).filter((line) => line.field === "participants").map((line) => line.text).join(""), `参与人 · ${participants.join("、")}`);
  assert.ok(fragments[0].rail.some((line) => line.text === "2026.09.12"));
  assert.ok(fragments[0].rail.some((line) => line.text === "至 2026.09.13"));
  for (const block of fragments) {
    assert.ok(block.top + block.height <= 1268);
    for (const line of block.lines) assert.ok(line.info.width <= 752);
  }
});

test("Calendar rejects oversized ranges rather than dropping entries or shrinking type", async () => {
  const entries = Array.from({ length: 80 }, (_, index) => entry(`cal_${index}`));
  await assert.rejects(layoutCalendarPosters({ entries }), { code: "POSTER_RANGE_TOO_LARGE" });
  await assert.rejects(renderCalendarPosters({ entries: [], targetUrl, startAt: "not a date" }), { code: "POSTER_RANGE_INVALID" });
  await assert.rejects(layoutCalendarPosters({ entries: [entry("a", { status: "unknown" })] }), { code: "POSTER_ENTRY_INVALID" });
});

test("poster QR preserves every module, high contrast and a four-module quiet zone", async () => {
  const qr = await createPosterQr(targetUrl);
  const matrix = QRCode.create(targetUrl, { errorCorrectionLevel: "M" }).modules;
  const { data, info } = await sharp(qr.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, (matrix.size + 8) * 4);
  for (let y = 0; y < matrix.size + 8; y += 1) for (let x = 0; x < matrix.size + 8; x += 1) {
    const offset = ((y * 4 + 2) * info.width + x * 4 + 2) * info.channels;
    const dark = x >= 4 && y >= 4 && x < matrix.size + 4 && y < matrix.size + 4 && matrix.get(y - 4, x - 4);
    assert.equal(data[offset], dark ? 24 : 255);
  }
});

test("missing, loopback and credential-bearing QR destinations fail closed", () => {
  for (const url of ["", "http://localhost/app", "https://127.0.0.1/app", "https://[::1]/app", "http://private.example/app", "https://user:secret@example.com/app", "https://example.com/app?token=secret", "https://example.com/app#secret"]) {
    assert.throws(() => validatePosterTarget(url), { code: "POSTER_LINK_UNAVAILABLE" });
  }
  assert.equal(validatePosterTarget(targetUrl), targetUrl);
});

test("Page poster adds only the QR, preserving the full un-cropped Agent composition", async () => {
  const image = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#bd9a82" } }).png().toBuffer();
  const poster = await renderPagePoster({ image, targetUrl: "https://calendar.example.com/app/mobile/pages/private-demo", pageId: "private-demo", pageVersion: "a".repeat(64) });
  assert.equal(poster.width, 1200); assert.equal(poster.height, 1800);
  const unmodified = await sharp(poster.buffer).extract({ left: 0, top: 0, width: 1000, height: 1200 }).removeAlpha().raw().toBuffer();
  const original = await sharp(image).extract({ left: 0, top: 0, width: 1000, height: 1200 }).removeAlpha().raw().toBuffer();
  assert.ok(unmodified.equals(original));
  assert.ok(poster.qr.width <= poster.width * 0.23);
  await assert.rejects(renderPagePoster({ image: Buffer.from('<svg><image href="file:///private"/></svg>'), targetUrl, pageId: "private-demo", pageVersion: "a".repeat(64) }), { code: "POSTER_IMAGE_INVALID" });
  await assert.rejects(renderPagePoster({ image, targetUrl, pageId: "private-demo", pageVersion: "old" }), { code: "POSTER_PAGE_VERSION_REQUIRED" });
});

test("Page poster binding is revision-safe and stale posters disappear from current metadata", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "cove-poster-binding-"));
  try {
    const store = new PrivatePublicationStore({ rootDir });
    store.upload({ publicationId: "demo", fileName: "index.html", content: "<h1>Version one</h1>" });
    const manifestPath = path.join(rootDir, "demo", "publication.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.page = { pageId: "private-demo", entryFile: "index.html", title: "Demo", assets: [] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const pageVersion = store.pageVersion("demo");
    store.bindPoster({ publicationId: "demo", pageVersion, objectId: "obj_demo", sha256: "b".repeat(64), width: 1200, height: 1600 });
    assert.equal(store.pageVersion("demo"), pageVersion);
    assert.equal(store.currentPoster("demo").objectId, "obj_demo");
    store.upload({ publicationId: "demo", fileName: "unrelated.txt", content: "not referenced" });
    assert.equal(store.pageVersion("demo"), pageVersion);
    store.upload({ publicationId: "demo", fileName: "index.html", content: "<h1>Version two</h1>", overwrite: true });
    assert.notEqual(store.pageVersion("demo"), pageVersion);
    assert.equal(store.currentPoster("demo"), null);
    assert.equal(store.list()[0].page.poster, undefined);
    assert.throws(() => store.bindPoster({ publicationId: "demo", pageVersion, objectId: "obj_demo", sha256: "b".repeat(64), width: 1200, height: 1600 }), { code: "POSTER_PAGE_VERSION_CONFLICT" });
  } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
});
