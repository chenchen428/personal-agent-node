import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oab-upload-"));
process.env.OPEN_AGENT_BRIDGE_WORKSPACE_ROOT = dataDir;
process.env.OPEN_AGENT_BRIDGE_DATA_DIR = path.join(dataDir, "state");
process.env.OPEN_AGENT_BRIDGE_PAGES_BASE_URL = "https://pages.example.test";

const { config, ensureRuntimeDirs } = await import("../src/config.js");
config.publicDir = path.join(dataDir, "public");
ensureRuntimeDirs();

const { configureOnlinePagesStorage, uploadStaticAsset, listUploadedAssets } = await import("../src/online-pages/upload.js");
const { ManagedFileCatalog } = await import("../src/managed-files/catalog.js");

test("uploads static assets under public uploads", async () => {
  const asset = await uploadStaticAsset({
    fileName: "hello.html",
    content: "<h1>Hello</h1>",
    folder: "demo",
  });
  assert.equal(asset.publicPath, "/uploads/demo/hello.html");
  assert.equal(asset.url, "https://pages.example.test/uploads/demo/hello.html");
  assert.equal(fs.existsSync(path.join(config.uploadsDir, "demo", "hello.html")), true);
  assert.equal(config.uploadsDir.startsWith(config.dataDir), true);

  const assets = await listUploadedAssets();
  assert.equal(assets.length, 1);
  assert.equal(assets[0].fileName, "hello.html");
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
