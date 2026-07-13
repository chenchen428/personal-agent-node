import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalManagedProvider } from "../src/managed-files/local-provider.js";

test("local managed storage writes, verifies, and materializes objects", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oab-local-provider-"));
  const provider = new LocalManagedProvider({ rootDir: root, publicBaseUrl: "https://resources.example.test" });
  const target = path.join(root, "downloaded.txt");
  try {
    const stored = await provider.put({ visibility: "public", relativePath: "uploads/test.txt", body: Buffer.from("local-data") });
    assert.equal(stored.bucket, "local-disk");
    assert.equal(stored.publicUrl, "https://resources.example.test/uploads/test.txt");
    const head = await provider.head({ visibility: "public", objectKey: stored.objectKey });
    assert.equal(head.sizeBytes, 10);
    await provider.download({ visibility: "public", objectKey: stored.objectKey }, target);
    assert.equal(fs.readFileSync(target, "utf8"), "local-data");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
