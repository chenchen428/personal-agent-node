import assert from "node:assert/strict";
import test from "node:test";
import {
  clipboardImageFiles,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  pastedImageName,
  validateAttachmentBatch,
} from "../core/app/src/components/desktop-v627/conversation-attachments.ts";

test("clipboard attachment discovery keeps only image files", () => {
  const image = { name: "clipboard.png", type: "image/png", size: 12 };
  const document = { name: "notes.txt", type: "text/plain", size: 8 };
  const files = clipboardImageFiles({ items: [
    { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "text/plain", getAsFile: () => document },
    { kind: "file", type: "image/png", getAsFile: () => image },
  ] });
  assert.deepEqual(files, [image]);
});

test("pasted image names are stable, typed, and unique within a batch", () => {
  const now = new Date("2026-07-23T12:34:56.000Z");
  assert.equal(pastedImageName("image/jpeg", now), "pasted-image-20260723123456.jpg");
  assert.equal(pastedImageName("image/webp", now, 1, 2), "pasted-image-20260723123456-2.webp");
});

test("conversation attachments enforce count and byte limits before reading files", () => {
  assert.equal(MAX_ATTACHMENT_COUNT, 4);
  assert.equal(MAX_ATTACHMENT_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_TOTAL_ATTACHMENT_BYTES, 10 * 1024 * 1024);
  assert.throws(
    () => validateAttachmentBatch([{ sizeBytes: 1 }], Array.from({ length: 4 }, () => ({ name: "a", size: 1, type: "image/png" }))),
    /一次最多添加 4 个附件/,
  );
  assert.throws(
    () => validateAttachmentBatch([], [{ name: "large.png", size: MAX_ATTACHMENT_BYTES + 1, type: "image/png" }]),
    /单个附件不能超过 5 MB/,
  );
  assert.throws(
    () => validateAttachmentBatch([{ sizeBytes: 6 * 1024 * 1024 }], [{ name: "more.png", size: 5 * 1024 * 1024, type: "image/png" }]),
    /附件总大小不能超过 10 MB/,
  );
});
