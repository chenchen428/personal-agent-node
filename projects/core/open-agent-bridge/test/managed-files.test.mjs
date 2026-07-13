import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ManagedFileCatalog } from "../src/managed-files/catalog.js";
import { ManagedFileService } from "../src/managed-files/service.js";

test("managed files materialize cold objects into verified local paths", async () => {
  const fixture = createFixture();
  try {
    const content = Buffer.from("cold object content");
    const object = fixture.addRemoteObject({ content, uploadedAt: daysAgo(60) });
    const result = await fixture.service.materialize(object.id, { taskId: "task-123", ttlDays: 7 });

    assert.equal(result.tier, "materialized");
    assert.equal(result.verified, true);
    assert.equal(fs.readFileSync(result.localPath, "utf8"), "cold object content");
    assert.equal(result.localPath.startsWith(fixture.materializedDir), true);
    assert.equal(fixture.catalog.get(object.id).localCopies.length, 1);
  } finally {
    fixture.close();
  }
});

test("managed files replace an invalid cataloged copy with a verified materialization", async () => {
  const fixture = createFixture();
  try {
    const object = fixture.addHotObject({ content: Buffer.from("trusted remote"), uploadedAt: daysAgo(60) });
    fs.writeFileSync(object.localPath, "locally modified");

    const result = await fixture.service.materialize(object.id, { taskId: "repair-task" });

    assert.equal(result.tier, "materialized");
    assert.equal(result.verified, true);
    assert.notEqual(result.localPath, object.localPath);
    assert.equal(fs.readFileSync(result.localPath, "utf8"), "trusted remote");
    assert.equal(fixture.catalog.get(object.id).localCopies.length, 1);
  } finally {
    fixture.close();
  }
});

test("managed file GC keeps the mandatory 30-day hot copy", async () => {
  const fixture = createFixture();
  try {
    const object = fixture.addHotObject({ content: Buffer.from("recent"), uploadedAt: daysAgo(29) });
    const result = await fixture.service.gc({ execute: true, now: new Date() });
    assert.equal(result.candidates, 0);
    assert.equal(fs.existsSync(object.localPath), true);
  } finally {
    fixture.close();
  }
});

test("managed file GC removes only verified expired local copies", async () => {
  const fixture = createFixture();
  try {
    const object = fixture.addHotObject({ content: Buffer.from("expired"), uploadedAt: daysAgo(31) });
    const dryRun = await fixture.service.gc({ execute: false });
    assert.equal(dryRun.results[0].action, "would-delete");
    assert.equal(fs.existsSync(object.localPath), true);

    const executed = await fixture.service.gc({ execute: true });
    assert.equal(executed.results[0].action, "deleted-local-copy");
    assert.equal(fs.existsSync(object.localPath), false);
    assert.equal(fixture.catalog.get(object.id).localCopies.length, 0);
  } finally {
    fixture.close();
  }
});

test("managed file GC honors pins and rejects unverifiable remote checksums", async () => {
  const fixture = createFixture();
  try {
    const pinned = fixture.addHotObject({ content: Buffer.from("pinned"), uploadedAt: daysAgo(90), name: "pinned.txt" });
    fixture.service.pin(pinned.id, { days: 30, reason: "active task" });
    assert.equal((await fixture.service.gc({ execute: true })).candidates, 0);
    assert.equal(fs.existsSync(pinned.localPath), true);

    const unsafe = fixture.addHotObject({ content: Buffer.from("unsafe"), uploadedAt: daysAgo(90), name: "unsafe.txt" });
    fixture.remote.overrides.set(unsafe.objectKey, { sha256: "" });
    const result = await fixture.service.gc({ execute: true });
    const unsafeResult = result.results.find((item) => item.objectId === unsafe.id);
    assert.equal(unsafeResult.action, "skipped");
    assert.match(unsafeResult.reason, /SHA-256 metadata/);
    assert.equal(fs.existsSync(unsafe.localPath), true);
  } finally {
    fixture.close();
  }
});

test("managed file reconciliation is dry-run by default and restarts the hot window", async () => {
  const fixture = createFixture();
  try {
    const sourceDir = path.join(fixture.hotDir, "legacy-blog");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "index.html"), "<h1>Legacy</h1>");

    const preview = await fixture.service.reconcileLocalTree({
      root: sourceDir,
      visibility: "public",
      source: "legacy-blog",
      prefix: "sites/blog",
    });
    assert.equal(preview.execute, false);
    assert.equal(preview.files, 1);
    assert.equal(preview.hotFiles, 1);
    assert.equal(preview.results[0].action, "would-upload-hot");
    assert.match(preview.results[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(fixture.catalog.search({ source: "legacy-blog" }).length, 0);

    const migrated = await fixture.service.reconcileLocalTree({
      root: sourceDir,
      visibility: "public",
      source: "legacy-blog",
      prefix: "sites/blog",
      execute: true,
    });
    assert.equal(migrated.ok, true);
    assert.equal(migrated.uploaded, 1);
    assert.equal(migrated.results[0].action, "uploaded-hot");
    const stored = fixture.catalog.get(migrated.results[0].objectId);
    assert.equal(stored.relativePath, "sites/blog/index.html");
    assert.equal(stored.localCopies[0].tier, "hot");
    assert.equal((await fixture.service.gc({ execute: true })).candidates, 0);

    const repeated = await fixture.service.reconcileLocalTree({
      root: sourceDir,
      visibility: "public",
      source: "legacy-blog",
      prefix: "sites/blog",
      execute: true,
    });
    assert.equal(repeated.uploaded, 0);
    assert.equal(repeated.verifiedExisting, 1);
    assert.equal(repeated.results[0].action, "verified-existing-hot");
    assert.equal(fixture.remote.putCalls, 1);
  } finally {
    fixture.close();
  }
});

test("managed file reconciliation catalogs files older than 30 days as cold without deleting the source", async () => {
  const fixture = createFixture();
  try {
    const sourceDir = path.join(fixture.hotDir, "legacy-cold");
    const sourcePath = path.join(sourceDir, "archive.pdf");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourcePath, "old archive");
    const oldTime = new Date(Date.now() - 45 * 86400000);
    fs.utimesSync(sourcePath, oldTime, oldTime);

    const preview = await fixture.service.reconcileLocalTree({ root: sourceDir, prefix: "archive" });
    assert.equal(preview.coldFiles, 1);
    assert.equal(preview.results[0].action, "would-upload-cold");

    const migrated = await fixture.service.reconcileLocalTree({ root: sourceDir, prefix: "archive", execute: true });
    const stored = fixture.catalog.get(migrated.results[0].objectId);
    assert.equal(migrated.results[0].action, "uploaded-cold");
    assert.equal(stored.localCopies.length, 1);
    assert.equal(stored.localCopies[0].tier, "shadow");
    assert.equal(fixture.service.stat(stored.id).tier, "cold");
    assert.equal(fs.existsSync(sourcePath), true);

    const materialized = await fixture.service.materialize(stored.id, { taskId: "cold-migration-test" });
    assert.equal(materialized.tier, "materialized");
    assert.equal(fs.readFileSync(materialized.localPath, "utf8"), "old archive");

    const retired = await fixture.service.gc({ execute: true, now: new Date(Date.now() + 31 * 86400000) });
    assert.equal(retired.results.some((item) => item.localPath === path.resolve(sourcePath) && item.action === "deleted-local-copy"), true);
    assert.equal(fs.existsSync(sourcePath), false);
  } finally {
    fixture.close();
  }
});

test("production gateway serves static files from local disk without remote fallback", () => {
  const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const gateway = fs.readFileSync(path.join(workspaceRoot, "projects", "core", "node", "src", "gateway.mjs"), "utf8");
  assert.match(gateway, /fs\.createReadStream\(filePath\)/);
  assert.match(gateway, /publications/);
  assert.doesNotMatch(gateway, /\bOSS\b|aliyuncs/i);
});

test("managed resource reconciliation excludes Git-owned relative paths", async () => {
  const fixture = createFixture();
  try {
    const sourceDir = path.join(fixture.hotDir, "resources");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "tracked.txt"), "tracked");
    fs.writeFileSync(path.join(sourceDir, "runtime.txt"), "runtime");

    const preview = await fixture.service.reconcileLocalTree({
      root: sourceDir,
      excludeRelativePaths: ["tracked.txt"],
    });
    assert.equal(preview.files, 1);
    assert.equal(preview.excludedFiles, 1);
    assert.equal(preview.results[0].relativePath, "runtime.txt");
  } finally {
    fixture.close();
  }
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oab-managed-files-"));
  const hotDir = path.join(root, "hot");
  const materializedDir = path.join(root, "materialized");
  fs.mkdirSync(hotDir, { recursive: true });
  const catalog = new ManagedFileCatalog({ dataDir: root });
  const remote = new FakeRemote();
  const service = new ManagedFileService({
    catalog,
    remote,
    managedRoots: [hotDir, materializedDir],
    migrationRoots: [hotDir],
    materializedDir,
    retentionDays: 30,
    materializedTtlDays: 7,
  });

  function addRemoteObject({ content, uploadedAt, name = "file.txt" }) {
    const sha256 = digest(content);
    const objectKey = `objects/${name}`;
    remote.objects.set(objectKey, Buffer.from(content));
    return catalog.upsertObject({
      visibility: "private",
      source: "test",
      bucket: "private-test",
      region: "local",
      objectKey,
      relativePath: objectKey,
      originalName: name,
      contentType: "text/plain",
      sizeBytes: content.length,
      sha256,
      status: "ready",
      uploadedAt,
      remoteVerifiedAt: uploadedAt,
    });
  }

  function addHotObject(input) {
    const object = addRemoteObject(input);
    const localPath = path.join(hotDir, input.name || "file.txt");
    fs.writeFileSync(localPath, input.content);
    catalog.recordLocalCopy(object.id, {
      localPath,
      tier: "hot",
      sha256: object.sha256,
      sizeBytes: object.sizeBytes,
      verifiedAt: input.uploadedAt,
    });
    return { ...object, localPath };
  }

  return {
    root,
    hotDir,
    materializedDir,
    catalog,
    remote,
    service,
    addRemoteObject,
    addHotObject,
    close() {
      catalog.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

class FakeRemote {
  objects = new Map();
  overrides = new Map();
  putCalls = 0;

  configured() {
    return true;
  }

  async put(input) {
    this.putCalls += 1;
    const content = input.filePath ? fs.readFileSync(input.filePath) : Buffer.from(input.body);
    const objectKey = input.relativePath;
    this.objects.set(objectKey, content);
    return {
      bucket: input.visibility === "public" ? "public-test" : "private-test",
      region: "local",
      objectKey,
      sizeBytes: content.length,
      sha256: input.sha256,
      crc64: "123",
      versionId: "version-1",
      verifiedAt: new Date().toISOString(),
      publicUrl: input.visibility === "public" ? `https://resources.example.test/${objectKey}` : "",
    };
  }

  async head(object) {
    const content = this.objects.get(object.objectKey);
    if (!content) return null;
    return {
      sizeBytes: content.length,
      sha256: digest(content),
      verifiedAt: new Date().toISOString(),
      ...(this.overrides.get(object.objectKey) || {}),
    };
  }

  async download(object, targetPath) {
    const content = this.objects.get(object.objectKey);
    if (!content) throw Object.assign(new Error("missing"), { code: "NoSuchKey" });
    fs.writeFileSync(targetPath, content);
  }
}

function digest(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}
