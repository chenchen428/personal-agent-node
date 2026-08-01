import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PrivatePublicationStore } from "../src/online-pages/private-publications.js";
import { createPageThumbnailPng } from "./page-thumbnail-fixture.mjs";

test("private publications persist report files under authenticated routes", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-publications-"));
  const store = new PrivatePublicationStore({ rootDir, baseUrl: "https://agent.example.test" });
  const uploaded = store.upload({ publicationId: "june-report", fileName: "index.html", content: "<h1>六月账单</h1>" });
  assert.equal(uploaded.url, "/publications/june-report/index.html");
  assert.equal(fs.readFileSync(store.resolve("june-report", "index.html").filePath, "utf8"), "<h1>六月账单</h1>");
  assert.equal(store.list()[0].id, "june-report");
  assert.throws(() => store.resolve("june-report", "../secret"), /invalid/);
});

test("private Page publishing stores desktop and mobile screenshots as first-class properties", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-page-"));
  const store = new PrivatePublicationStore({ rootDir, baseUrl: "https://agent.example.test" });
  store.upload({
    publicationId: "private-report",
    fileName: "media/room.webp",
    content: Buffer.from("room-image").toString("base64"),
    encoding: "base64",
    mimeType: "image/webp",
  });
  store.upload({ publicationId: "private-report", fileName: "page-thumbnail-desktop.png", content: createPageThumbnailPng().toString("base64"), encoding: "base64", mimeType: "image/png" });
  store.upload({ publicationId: "private-report", fileName: "page-thumbnail-mobile.png", content: createPageThumbnailPng(750, 1200).toString("base64"), encoding: "base64", mimeType: "image/png" });
  const published = store.publish({
    publicationId: "private-report",
    fileName: "index.html",
    content: "<h1>Private report</h1>",
    title: "Private report",
    summary: "Only visible after local authentication.",
    assetPaths: ["media/room.webp"],
    desktopThumbnail: {
      fileName: "page-thumbnail-desktop.png",
      alt: "Private report desktop overview",
    },
    mobileThumbnail: {
      fileName: "page-thumbnail-mobile.png",
      alt: "Private report mobile overview",
    },
  });

  assert.equal(published.page.pageId, "private-private-report");
  assert.equal(published.pageId, published.page.pageId);
  assert.equal(published.thumbnailUrl, "/publications/private-report/page-thumbnail-desktop.png");
  assert.equal(published.mobileThumbnailUrl, "/publications/private-report/page-thumbnail-mobile.png");
  assert.equal(published.page.thumbnails.desktop.width, 1200);
  assert.equal(published.page.thumbnails.mobile.height, 1200);
  assert.equal(store.list()[0].page.thumbnails.mobile.alt, "Private report mobile overview");
  assert.equal(fs.existsSync(store.resolve("private-report", "page-thumbnail-mobile.png").filePath), true);
  assert.equal(fs.readFileSync(store.resolve("private-report", "media/room.webp").filePath, "utf8"), "room-image");
});

test("new private Pages reject retired template provenance", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-template-page-"));
  const store = new PrivatePublicationStore({ rootDir });
  assert.throws(() => store.publish({
    publicationId: "private-template",
    fileName: "index.html",
    content: "<h1>Page</h1>",
    template: { id: "interior-design-delivery" },
    desktopThumbnail: {
      fileName: "page-thumbnail-desktop.png",
      content: createPageThumbnailPng().toString("base64"),
    },
    mobileThumbnail: {
      fileName: "page-thumbnail-mobile.png",
      content: createPageThumbnailPng(750, 1200).toString("base64"),
    },
  }), /Page templates are retired/);
});

test("private Page bundles enforce per-file limits without an aggregate bundle cap", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-bundle-limit-"));
  const store = new PrivatePublicationStore({ rootDir, maxUploadBytes: 100_000 });
  const content = Buffer.alloc(60_000, 7).toString("base64");
  store.upload({ publicationId: "large-bundle", fileName: "media/one.bin", content, encoding: "base64" });
  store.upload({ publicationId: "large-bundle", fileName: "media/two.bin", content, encoding: "base64" });
  const published = store.publish({
    publicationId: "large-bundle",
    fileName: "index.html",
    content: "<h1>Page with separately referenced assets</h1>",
    assetPaths: ["media/one.bin", "media/two.bin"],
    desktopThumbnail: { fileName: "desktop.png", content: createPageThumbnailPng().toString("base64") },
    mobileThumbnail: { fileName: "mobile.png", content: createPageThumbnailPng(750, 1200).toString("base64") },
  });
  assert.equal(published.pageId, "private-large-bundle");
  assert.deepEqual(published.page.assets.map((asset) => asset.fileName), ["media/one.bin", "media/two.bin"]);
  assert.equal(fs.statSync(store.resolve("large-bundle", "media/one.bin").filePath).size, 60_000);
  assert.throws(() => store.upload({
    publicationId: "large-bundle",
    fileName: "media/too-large.bin",
    content: Buffer.alloc(100_001).toString("base64"),
    encoding: "base64",
  }), /publication file exceeds 100000 bytes/);
});

test("private Page publishing rejects embedded bundle payloads and missing references", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-page-references-"));
  const store = new PrivatePublicationStore({ rootDir });
  const input = {
    publicationId: "reference-contract",
    fileName: "index.html",
    content: "<h1>References only</h1>",
    desktopThumbnail: { fileName: "desktop.png", content: createPageThumbnailPng().toString("base64") },
    mobileThumbnail: { fileName: "mobile.png", content: createPageThumbnailPng(750, 1200).toString("base64") },
  };
  assert.throws(() => store.publish({ ...input, assets: [{ relativePath: "media/embedded.png", content: "AA==" }] }), /uploaded individually/);
  assert.throws(() => store.publish({ ...input, assetPaths: ["media/missing.png"] }), /was not uploaded/);
});
