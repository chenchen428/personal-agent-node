import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FINAL_REPLY_MAX_FILE_BYTES, inspectSendableFile, safeAttachmentName } from "../src/final-reply/file-policy.js";

test("accepts the governed native-file whitelist only when magic, MIME, and extension agree", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-reply-file-types-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = [
    ["report.pdf", "application/pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF")],
    ["notes.txt", "text/plain", Buffer.from("Safe plain text\n", "utf8")],
    ["notes.md", "text/markdown", Buffer.from("# Safe markdown\n", "utf8")],
    ["audio.mp3", "audio/mpeg", Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00])],
    ["audio.wav", "audio/wav", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")])],
    ["audio.ogg", "audio/ogg", Buffer.from("OggS\0\x02fixture", "binary")],
    ["video.mp4", "video/mp4", isoMediaFixture("isom")],
    ["video.mov", "video/quicktime", isoMediaFixture("qt  ")],
    ["video.webm", "video/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x00])],
    ["archive.zip", "application/zip", zipFixture(["readme.txt"])],
    ["document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zipFixture(["[Content_Types].xml", "word/document.xml"])],
    ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zipFixture(["[Content_Types].xml", "xl/workbook.xml"])],
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", zipFixture(["[Content_Types].xml", "ppt/presentation.xml"])],
  ];
  for (const [name, declaredMime, bytes] of cases) {
    await t.test(name, async () => {
      const filePath = path.join(root, name);
      fs.writeFileSync(filePath, bytes);
      const result = await inspectSendableFile({ filePath, declaredMime, originalName: name });
      assert.equal(result.mimeType, declaredMime, name);
    });
  }
});

test("rejects MIME spoofing, scripts, dangerous names, unsafe ZIPs, and over-limit files", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-reply-file-reject-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pdf = write(root, "spoof.docx", Buffer.from("%PDF-1.7\n%%EOF"));
  await assert.rejects(() => inspectSendableFile({ filePath: pdf, declaredMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", originalName: "spoof.docx" }), { code: "FINAL_REPLY_FILE_MIME_MISMATCH" });
  const script = write(root, "renamed.txt", Buffer.from("#!/bin/sh\necho unsafe\n"));
  await assert.rejects(() => inspectSendableFile({ filePath: script, declaredMime: "text/plain", originalName: "renamed.txt" }), { code: "FINAL_REPLY_FILE_SCRIPT" });
  const executable = write(root, "run.exe", Buffer.from("plain text"));
  await assert.rejects(() => inspectSendableFile({ filePath: executable, declaredMime: "text/plain", originalName: "run.exe" }), { code: "FINAL_REPLY_FILE_NAME_UNSAFE" });
  const secret = write(root, "credentials.txt", Buffer.from("not actual credentials"));
  await assert.rejects(() => inspectSendableFile({ filePath: secret, declaredMime: "text/plain", originalName: "credentials.txt" }), { code: "FINAL_REPLY_FILE_NAME_UNSAFE" });
  for (const [name, entries, code] of [
    ["dangerous.zip", ["readme.txt", "tools/run.exe"], "FINAL_REPLY_FILE_ZIP_UNSAFE"],
    ["traversal.zip", ["../outside.txt"], "FINAL_REPLY_FILE_ZIP_PATH"],
    ["active.docx", ["[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"], "FINAL_REPLY_FILE_ZIP_UNSAFE"],
  ]) {
    const filePath = write(root, name, zipFixture(entries));
    const mime = name.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/zip";
    await assert.rejects(() => inspectSendableFile({ filePath, declaredMime: mime, originalName: name }), { code });
  }
  const large = path.join(root, "large.pdf");
  fs.writeFileSync(large, "%PDF-1.7\n");
  fs.truncateSync(large, FINAL_REPLY_MAX_FILE_BYTES + 1);
  await assert.rejects(() => inspectSendableFile({ filePath: large, declaredMime: "application/pdf", originalName: "large.pdf" }), { code: "FINAL_REPLY_FILE_SIZE" });
});

test("sanitizes display names while preserving the verified extension", () => {
  assert.equal(safeAttachmentName({ originalName: "report.pdf", displayName: "../Quarter:Report.pdf", extensions: [".pdf"] }), "Quarter_Report.pdf");
  assert.equal(safeAttachmentName({ originalName: "report.pdf", displayName: "Quarter Report", extensions: [".pdf"] }), "Quarter Report.pdf");
  assert.throws(() => safeAttachmentName({ originalName: "report.pdf", displayName: "run.exe", extensions: [".pdf"] }), { code: "FINAL_REPLY_FILE_NAME_UNSAFE" });
  assert.throws(() => safeAttachmentName({ originalName: "report.pdf", displayName: "report.zip", extensions: [".pdf"] }), { code: "FINAL_REPLY_DISPLAY_NAME_EXTENSION" });
});

function write(root, name, bytes) { const filePath = path.join(root, name); fs.writeFileSync(filePath, bytes); return filePath; }

function isoMediaFixture(brand) {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32BE(16, 0);
  buffer.write("ftyp", 4, "ascii");
  buffer.write(brand, 8, "ascii");
  return buffer;
}

function zipFixture(names) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const value of names) {
    const name = Buffer.from(value, "utf8");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(names.length, 8);
  eocd.writeUInt16LE(names.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, eocd]);
}
