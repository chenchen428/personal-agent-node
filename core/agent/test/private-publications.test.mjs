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
  const published = store.publish({
    publicationId: "private-report",
    fileName: "index.html",
    content: "<h1>Private report</h1>",
    title: "Private report",
    summary: "Only visible after local authentication.",
    desktopThumbnail: {
      fileName: "page-thumbnail-desktop.png",
      content: createPageThumbnailPng().toString("base64"),
      encoding: "base64",
      alt: "Private report desktop overview",
    },
    mobileThumbnail: {
      fileName: "page-thumbnail-mobile.png",
      content: createPageThumbnailPng(750, 1200).toString("base64"),
      encoding: "base64",
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
});

test("private registered Page publication re-verifies and stores template provenance", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-private-template-page-"));
  const store = new PrivatePublicationStore({ rootDir });
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../../app/public/assets/templates/interior-design-delivery-v2/index.html"));
  const published = store.publish({
    publicationId: "private-template",
    fileName: "index.html",
    content: html.toString("base64"),
    encoding: "base64",
    template: { id: "interior-design-delivery" },
    desktopThumbnail: {
      fileName: "page-thumbnail-desktop.png",
      content: createPageThumbnailPng().toString("base64"),
    },
    mobileThumbnail: {
      fileName: "page-thumbnail-mobile.png",
      content: createPageThumbnailPng(750, 1200).toString("base64"),
    },
  });
  assert.deepEqual(published.page.template, {
    id: "interior-design-delivery",
    version: 2,
    contractDigest: published.page.template.contractDigest,
    artifactMarker: "personal-agent-page-template",
    artifactSha256: crypto.createHash("sha256").update(html).digest("hex"),
  });
});
