import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  containsFinalReplyControl,
  FINAL_REPLY_MAX_ATTACHMENTS,
  FINAL_REPLY_MAX_IMAGE_BYTES,
  processFinalReplyControl,
  recoverFinalReplyText,
  stripFinalReplyControls,
} from "../src/final-reply/control.js";

const objectId = "obj_0123456789abcdef01234567";

test("parses, strips, validates, and materializes a current-Space managed image", async () => {
  const fixture = await imageFixture();
  try {
    const calls = [];
    const result = await processFinalReplyControl({
      content: envelope({
        text: "Here is the image.",
        attachments: [{ objectId, alt: "A red square", caption: "Final image" }],
      }),
      session: { id: "ses_main", role: "main" },
      spaceId: "sp_owner",
      managedFiles: managedFiles(fixture, { spaceId: "sp_owner" }, calls),
    });
    assert.equal(result.visibleContent, "Here is the image.");
    assert.equal(result.attachments[0].objectId, objectId);
    assert.equal(result.attachments[0].mimeType, "image/png");
    assert.equal(result.attachments[0].width, 8);
    assert.equal(result.attachments[0].height, 6);
    assert.equal(result.attachments[0].deliveryState, "pending");
    assert.equal(result.attachments[0].previewUrl, `/api/chat/attachments/${objectId}`);
    assert.equal("localPath" in result.attachments[0], false);
    assert.equal(result.deliveryAttachments[0].localPath, fixture.filePath);
    assert.deepEqual(calls, [{ id: objectId, options: { ttlDays: 1, taskId: "final-reply-ses_main" } }]);
  } finally { fixture.cleanup(); }
});

test("rejects worker authority, foreign Space objects, MIME mismatch, and over-limit selections", async () => {
  const fixture = await imageFixture();
  try {
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments: [{ objectId }] }),
      session: { id: "ses_worker", role: "worker" },
      managedFiles: managedFiles(fixture),
    }), { code: "FINAL_REPLY_MAIN_AGENT_REQUIRED" });
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments: [{ objectId }] }),
      session: { id: "ses_main", role: "main" },
      spaceId: "sp_owner",
      managedFiles: managedFiles(fixture, { spaceId: "sp_other" }),
    }), { code: "FINAL_REPLY_OBJECT_FORBIDDEN" });
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments: [{ objectId }] }),
      session: { id: "ses_main", role: "main" },
      managedFiles: managedFiles(fixture, { contentType: "image/jpeg" }),
    }), { code: "FINAL_REPLY_IMAGE_MIME_MISMATCH" });
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments: [{ objectId }] }),
      session: { id: "ses_main", role: "main" },
      managedFiles: managedFiles(fixture, { sizeBytes: FINAL_REPLY_MAX_IMAGE_BYTES + 1 }),
    }), { code: "FINAL_REPLY_IMAGE_SIZE" });
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments: [{ objectId }] }),
      session: { id: "ses_main", role: "main" },
      managedFiles: managedFiles(fixture, { securityStatus: "quarantined" }),
    }), { code: "FINAL_REPLY_ATTACHMENT_UNSAFE" });
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments: [{ objectId }] }),
      session: { id: "ses_main", role: "main" },
      managedFiles: managedFiles(fixture, { securityStatus: "scan_failed" }),
    }), { code: "FINAL_REPLY_ATTACHMENT_UNSAFE" });
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments: [{ objectId }] }),
      session: { id: "ses_main", role: "main" },
      managedFiles: managedFiles(fixture, { source: "internal-logs", relativePath: "runtime/result.png" }),
    }), { code: "FINAL_REPLY_OBJECT_SENSITIVE" });
    const attachments = Array.from({ length: FINAL_REPLY_MAX_ATTACHMENTS + 1 }, (_, index) => ({
      objectId: `obj_${index.toString(16).padStart(24, "0")}`,
    }));
    await assert.rejects(() => processFinalReplyControl({
      content: envelope({ attachments }),
      session: { id: "ses_main", role: "main" },
      managedFiles: managedFiles(fixture),
    }), { code: "FINAL_REPLY_ATTACHMENT_LIMIT" });
  } finally { fixture.cleanup(); }
});

test("requires only managed object IDs and recovers visible text from a rejected envelope", async () => {
  const content = envelope({ attachments: [{ objectId: "https://example.test/private.png" }], text: "Visible body" });
  assert.equal(containsFinalReplyControl(content), true);
  assert.equal(stripFinalReplyControls(content), "");
  assert.equal(recoverFinalReplyText(content), "Visible body");
  await assert.rejects(() => processFinalReplyControl({
    content,
    session: { id: "ses_main", role: "main" },
    managedFiles: { stat: () => null, materialize: async () => null },
  }), { code: "FINAL_REPLY_OBJECT_ID_INVALID" });
});

test("selects a verified managed PDF through the same final-reply envelope", async () => {
  const fixture = fileFixture("report.pdf", Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF"));
  try {
    const result = await processFinalReplyControl({
      content: envelope({ text: "Report attached.", attachments: [{ objectId, caption: "Quarterly report", displayName: "Q2 Report.pdf" }] }),
      session: { id: "ses_main", role: "main" },
      spaceId: "sp_owner",
      managedFiles: managedFiles(fixture, { originalName: "report.pdf", contentType: "application/pdf", spaceId: "sp_owner" }),
    });
    assert.equal(result.attachments[0].kind, "file");
    assert.equal(result.attachments[0].name, "Q2 Report.pdf");
    assert.equal(result.attachments[0].mimeType, "application/pdf");
    assert.equal(result.attachments[0].caption, "Quarterly report");
    assert.equal(result.attachments[0].downloadUrl, `/api/chat/attachments/${objectId}?download=1`);
    assert.equal("localPath" in result.attachments[0], false);
    assert.equal(result.deliveryAttachments[0].localPath, fixture.filePath);
  } finally { fixture.cleanup(); }
});

function envelope({ text = "", attachments = [] } = {}) {
  return `<personal-agent-reply>${JSON.stringify({
    schemaVersion: 1,
    requestId: "request-1",
    idempotencyKey: "reply-1",
    text,
    attachments,
  })}</personal-agent-reply>`;
}

function managedFiles(fixture, overrides = {}, calls = []) {
  return {
    stat: (id) => ({
      objectId: id,
      originalName: "result.png",
      contentType: "image/png",
      sizeBytes: fixture.sizeBytes,
      status: "ready",
      ...overrides,
    }),
    materialize: async (id, options) => {
      calls.push({ id, options });
      return { objectId: id, localPath: fixture.filePath, verified: true };
    },
  };
}

async function imageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-final-reply-"));
  const filePath = path.join(root, "result.png");
  await sharp({ create: { width: 8, height: 6, channels: 4, background: "#cc3344" } }).png().toFile(filePath);
  return {
    filePath,
    sizeBytes: fs.statSync(filePath).size,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function fileFixture(name, bytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-final-reply-file-"));
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, bytes);
  return { filePath, sizeBytes: bytes.length, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
