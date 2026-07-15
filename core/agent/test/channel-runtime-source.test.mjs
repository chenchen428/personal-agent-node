import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sourceTreeDigest, validateSourceFiles, validateSourcePatches } from "../../../scripts/build-channel-runtimes.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("channel source digest is stable across manifest ordering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "channel-source-digest-"));
  fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "go.mod"), "module example.test/channel\n");
  fs.writeFileSync(path.join(root, "pkg", "main.go"), "package pkg\n");
  const expected = crypto.createHash("sha256")
    .update("go.mod\0module example.test/channel\n\0pkg/main.go\0package pkg\n\0")
    .digest("hex");
  assert.equal(sourceTreeDigest(root, ["pkg/main.go", "go.mod"]), expected);
});

test("channel source manifest rejects traversal and non-Go inputs", () => {
  assert.throws(() => validateSourceFiles(["../secret"]), /Unsafe/);
  assert.throws(() => validateSourceFiles(["assets/session.json"]), /Unsupported/);
  assert.deepEqual(validateSourceFiles(["service.go", "go.mod", "service.go"]), ["go.mod", "service.go"]);
});

test("channel source patches are pinned and constrained to the runtime patch directory", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "core", "channels", "xiaohongshu", "runtime.json"), "utf8"));
  const patches = validateSourcePatches(manifest.adapter.build.patches);
  assert.equal(patches.length, 1);
  const patchPath = path.join(workspaceRoot, ...patches[0].file.split("/"));
  const digest = crypto.createHash("sha256").update(fs.readFileSync(patchPath)).digest("hex");
  assert.equal(digest, patches[0].sha256);
  assert.throws(() => validateSourcePatches([{ file: "../service.patch", sha256: "a".repeat(64) }]), /Unsafe/);
});
