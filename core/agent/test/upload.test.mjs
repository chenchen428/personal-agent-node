import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPageThumbnailPng } from "./page-thumbnail-fixture.mjs";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-upload-"));
process.env.OPEN_AGENT_BRIDGE_WORKSPACE_ROOT = dataDir;
process.env.OPEN_AGENT_BRIDGE_DATA_DIR = path.join(dataDir, "state");
process.env.OPEN_AGENT_BRIDGE_PAGES_BASE_URL = "https://pages.example.test";

const { config, ensureRuntimeDirs } = await import("../src/config.js");
config.publicDir = path.join(dataDir, "public");
config.externalAccess = () => ({ ready: true, reason: "ready", origin: "https://pages.example.test" });
ensureRuntimeDirs();

const { configureOnlinePagesStorage, uploadStaticAsset, listUploadedAssets, publishHtmlPage } = await import("../src/online-pages/upload.js");
const { createVerificationSitePublication } = await import("../src/connections/verification-site-publication.js");
const { ManagedFileCatalog } = await import("../src/managed-files/catalog.js");

test("uploads static assets under public uploads", async () => {
  const asset = await uploadStaticAsset({
    fileName: "hello.html",
    content: "<h1>Hello</h1>",
    folder: "demo",
  });
  assert.equal(asset.publicPath, "/uploads/demo/hello.html");
  assert.equal(asset.url, "/public/uploads/demo/hello.html");
  assert.equal(asset.shareUrl, "https://pages.example.test/public/uploads/demo/hello.html");
  assert.equal(fs.existsSync(path.join(config.uploadsDir, "demo", "hello.html")), true);
  assert.equal(config.uploadsDir.startsWith(config.dataDir), true);

  const assets = await listUploadedAssets();
  assert.equal(assets.length, 1);
  assert.equal(assets[0].fileName, "hello.html");
});

test("keeps the internal page link but omits the share link when remote access is unavailable", async () => {
  const previous = config.externalAccess;
  config.externalAccess = () => ({ ready: false, reason: "local-only", origin: "" });
  try {
    const asset = await uploadStaticAsset({ fileName: "local.html", content: "local", folder: "demo" });
    assert.equal(asset.publicPath, "/uploads/demo/local.html");
    assert.equal(asset.url, "/public/uploads/demo/local.html");
    assert.equal(asset.shareUrl, "");
  } finally {
    config.externalAccess = previous;
  }
});

test("publishes HTML with persisted desktop and mobile gallery screenshots", async () => {
  const desktopThumbnail = createPageThumbnailPng();
  const mobileThumbnail = createPageThumbnailPng(750, 1200);
  const asset = await publishHtmlPage({
    fileName: "index.html",
    folder: "published-report",
    content: "<h1>Published report</h1>",
    title: "Published report",
    summary: "A stable Pages gallery entry.",
    desktopThumbnail: {
      fileName: "page-thumbnail-desktop.png",
      content: desktopThumbnail.toString("base64"),
      encoding: "base64",
      alt: "Published report desktop overview",
    },
    mobileThumbnail: {
      fileName: "page-thumbnail-mobile.png",
      content: mobileThumbnail.toString("base64"),
      encoding: "base64",
      alt: "Published report mobile overview",
    },
  });

  assert.equal(asset.page.pageId, "public-published-report");
  assert.equal(asset.pageId, asset.page.pageId);
  assert.equal(asset.page.thumbnails.desktop.width, 1200);
  assert.equal(asset.page.thumbnails.desktop.height, 750);
  assert.equal(asset.page.thumbnails.mobile.width, 750);
  assert.equal(asset.page.thumbnails.mobile.height, 1200);
  assert.equal(asset.thumbnailUrl, "/public/uploads/published-report/page-thumbnail-desktop.png");
  assert.equal(asset.desktopThumbnailUrl, asset.thumbnailUrl);
  assert.equal(asset.mobileThumbnailUrl, "/public/uploads/published-report/page-thumbnail-mobile.png");
  assert.equal(fs.existsSync(path.join(config.uploadsDir, "published-report", ".page.json")), true);
  assert.deepEqual(
    (await listUploadedAssets()).find((item) => item.fileName === "index.html")?.page,
    asset.page,
  );
});

test("publishes Site verification as a complete Pages gallery entry", async () => {
  const input = await createVerificationSitePublication({
    marker: "pa-domain-0123456789abcdef01234567",
    domain: "owner.personal-agent.cn",
  });
  const asset = await publishHtmlPage(input);
  const listed = (await listUploadedAssets()).find((item) => item.pageId === "public-domain-verification");

  assert.equal(asset.page.title, "Personal Agent Node · 公网入口已就绪");
  assert.match(asset.page.summary, /公网发布链路/);
  assert.equal(asset.page.thumbnails.desktop.width, 1200);
  assert.equal(asset.page.thumbnails.desktop.height, 750);
  assert.equal(asset.page.thumbnails.mobile.width, 750);
  assert.equal(asset.page.thumbnails.mobile.height, 1200);
  assert.equal(listed?.thumbnailUrl, "/public/uploads/domain-verification/page-thumbnail-desktop.png");
  assert.equal(listed?.mobileThumbnailUrl, "/public/uploads/domain-verification/page-thumbnail-mobile.png");
  assert.equal(fs.existsSync(path.join(config.uploadsDir, "domain-verification", ".page.json")), true);
});

test("rejects unsuitable, incomplete, or missing Page screenshots", async () => {
  await assert.rejects(() => publishHtmlPage({
    fileName: "index.html",
    folder: "bad-thumbnail",
    content: "<h1>Bad thumbnail</h1>",
    desktopThumbnail: { fileName: "desktop.png", content: createPageThumbnailPng(640, 640).toString("base64") },
    mobileThumbnail: { fileName: "mobile.png", content: createPageThumbnailPng(750, 1200).toString("base64") },
  }), /aspect ratio/);
  await assert.rejects(() => publishHtmlPage({
    fileName: "index.html",
    folder: "incomplete-thumbnail",
    content: "<h1>Incomplete thumbnail</h1>",
    desktopThumbnail: { fileName: "desktop.png", content: createPageThumbnailPng().subarray(0, 40).toString("base64") },
    mobileThumbnail: { fileName: "mobile.png", content: createPageThumbnailPng(750, 1200).toString("base64") },
  }), /valid PNG|incomplete/);
  await assert.rejects(() => publishHtmlPage({
    fileName: "index.html",
    folder: "missing-mobile-thumbnail",
    content: "<h1>Missing mobile screenshot</h1>",
    desktopThumbnail: { fileName: "desktop.png", content: createPageThumbnailPng().toString("base64") },
  }), /mobile Page thumbnail/);
});

test("records a durable public object and hot local copy", async (t) => {
  const catalog = new ManagedFileCatalog({ dataDir: config.dataDir });
  t.after(() => catalog.close());
  const remote = {
    configured: () => true,
    settings: () => ({ bucket: "local-disk", region: "local" }),
    async put(input) {
      return {
        bucket: "public-test",
        region: "local",
        objectKey: input.relativePath,
        sizeBytes: input.body.length,
        sha256: input.sha256,
        crc64: "123",
        versionId: "version-1",
        verifiedAt: new Date().toISOString(),
        publicUrl: `https://resources.example.test/${input.relativePath}`,
      };
    },
  };
  configureOnlinePagesStorage({ catalog, remote });
  t.after(() => configureOnlinePagesStorage());

  const asset = await uploadStaticAsset({
    fileName: "durable.txt",
    content: "durable",
    folder: "demo",
  });

  assert.equal(asset.durable, true);
  assert.match(asset.objectId, /^obj_/);
  assert.equal(asset.tier, "hot");
  assert.equal(fs.existsSync(asset.localPath), true);
  const stored = catalog.get(asset.objectId);
  assert.equal(stored.status, "ready");
  assert.equal(stored.localCopies[0].tier, "hot");
});
