import path from "node:path";
import sharp from "sharp";
import { FINAL_REPLY_MAX_FILE_BYTES, inspectSendableFile, safeAttachmentName } from "./file-policy.js";

const CONTROL_PATTERN = /<personal-agent-reply>([\s\S]*?)<\/personal-agent-reply>/g;
const CONTROL_START = "<personal-agent-reply>";
const OBJECT_ID_PATTERN = /^obj_[a-f0-9]{24}$/;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", new Set(["jpeg"])],
  ["image/png", new Set(["png"])],
  ["image/gif", new Set(["gif"])],
  ["image/webp", new Set(["webp"])],
]);

export const FINAL_REPLY_SCHEMA_VERSION = 1;
export const FINAL_REPLY_MAX_ATTACHMENTS = 10;
export const FINAL_REPLY_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const FINAL_REPLY_MAX_IMAGE_EDGE = 16_384;
export const FINAL_REPLY_MAX_IMAGE_PIXELS = 100_000_000;

export function containsFinalReplyControl(content) {
  return String(content || "").includes(CONTROL_START);
}

export function isStreamingFinalReplyControl(event) {
  return event?.kind === "session.assistant_message"
    && event?.payload?.metadata?.streamState !== "completed"
    && containsFinalReplyControl(event?.payload?.content);
}

export function stripFinalReplyControls(content) {
  return String(content || "").replace(CONTROL_PATTERN, "").trim();
}

export function recoverFinalReplyText(content) {
  const controls = parseControlBlocks(content, { requireSingle: false });
  const value = controls[0]?.value;
  return typeof value?.text === "string" ? value.text.trim().slice(0, 40_000) : stripFinalReplyControls(content);
}

export async function processFinalReplyControl({ content, session, managedFiles, spaceId = "" }) {
  if (session?.role !== "main") throw replyError("FINAL_REPLY_MAIN_AGENT_REQUIRED", "only the canonical main Agent may select reply attachments");
  if (!managedFiles?.stat || !managedFiles?.materialize) throw replyError("FINAL_REPLY_FILES_UNAVAILABLE", "managed files are unavailable");
  const [{ value }] = parseControlBlocks(content);
  const visibleOutside = stripFinalReplyControls(content);
  if (visibleOutside) throw replyError("FINAL_REPLY_VISIBLE_CONTENT_CONFLICT", "reply text must be carried inside the control envelope");
  const envelope = normalizeEnvelope(value);
  const deliveryAttachments = [];
  for (const attachment of envelope.attachments) {
    deliveryAttachments.push(await prepareManagedAttachment({
      attachment,
      managedFiles,
      sessionId: session.id,
      spaceId,
    }));
  }
  if (!envelope.text && !deliveryAttachments.length) {
    throw replyError("FINAL_REPLY_EMPTY", "reply text or an attachment is required");
  }
  return {
    visibleContent: envelope.text,
    envelope,
    attachments: deliveryAttachments.map(({ localPath: _localPath, ...attachment }) => ({
      ...attachment,
      deliveryState: "pending",
    })),
    deliveryAttachments,
  };
}

function parseControlBlocks(content, { requireSingle = true } = {}) {
  const text = String(content || "");
  const blocks = [...text.matchAll(CONTROL_PATTERN)];
  if (!blocks.length) throw replyError("FINAL_REPLY_CONTROL_MISSING", "final reply control is missing or incomplete");
  if (requireSingle && blocks.length !== 1) throw replyError("FINAL_REPLY_CONTROL_COUNT", "exactly one final reply control is allowed");
  return blocks.map((match) => {
    try {
      return { raw: match[0], value: JSON.parse(match[1]) };
    } catch {
      throw replyError("FINAL_REPLY_INVALID_JSON", "final reply control must contain valid JSON");
    }
  });
}

function normalizeEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw replyError("FINAL_REPLY_INVALID", "final reply control must be an object");
  if (value.schemaVersion !== FINAL_REPLY_SCHEMA_VERSION) throw replyError("FINAL_REPLY_SCHEMA_UNSUPPORTED", "unsupported final reply schema version");
  const requestId = boundedIdentifier(value.requestId, "requestId");
  const idempotencyKey = boundedIdentifier(value.idempotencyKey, "idempotencyKey");
  const text = boundedText(value.text, "text", 40_000, true);
  if (!Array.isArray(value.attachments)) throw replyError("FINAL_REPLY_ATTACHMENTS_INVALID", "attachments must be an array");
  if (value.attachments.length > FINAL_REPLY_MAX_ATTACHMENTS) throw replyError("FINAL_REPLY_ATTACHMENT_LIMIT", `at most ${FINAL_REPLY_MAX_ATTACHMENTS} attachments are allowed`);
  const seen = new Set();
  const attachments = value.attachments.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw replyError("FINAL_REPLY_ATTACHMENT_INVALID", `attachment ${index + 1} must be an object`);
    const objectId = String(item.objectId || "").trim();
    if (!OBJECT_ID_PATTERN.test(objectId)) throw replyError("FINAL_REPLY_OBJECT_ID_INVALID", `attachment ${index + 1} must use a managed obj_ ID`);
    if (seen.has(objectId)) throw replyError("FINAL_REPLY_OBJECT_DUPLICATE", `attachment ${index + 1} duplicates ${objectId}`);
    seen.add(objectId);
    return {
      objectId,
      alt: boundedText(item.alt, "alt", 500, true),
      caption: boundedText(item.caption, "caption", 1_000, true),
      displayName: boundedText(item.displayName, "displayName", 300, true),
    };
  });
  return { schemaVersion: FINAL_REPLY_SCHEMA_VERSION, requestId, idempotencyKey, text, attachments };
}

async function prepareManagedAttachment({ attachment, managedFiles, sessionId, spaceId }) {
  let object;
  try {
    object = managedFiles.stat(attachment.objectId);
  } catch {
    throw replyError("FINAL_REPLY_OBJECT_NOT_FOUND", `managed attachment ${attachment.objectId} was not found in this Space`);
  }
  if (object.objectId !== attachment.objectId || object.status !== "ready") throw replyError("FINAL_REPLY_OBJECT_NOT_READY", `managed attachment ${attachment.objectId} is not ready`);
  if (spaceId && object.spaceId && object.spaceId !== spaceId) throw replyError("FINAL_REPLY_OBJECT_FORBIDDEN", `managed attachment ${attachment.objectId} belongs to another Space`);
  const originLabel = `${object.source || ""}/${object.relativePath || ""}`;
  if (/(?:^|[\/_.\-])(credentials?|secrets?|internal[-_ ]?logs?|databases?)(?:$|[\/_.\-])/i.test(originLabel)) {
    throw replyError("FINAL_REPLY_OBJECT_SENSITIVE", `managed attachment ${attachment.objectId} comes from a prohibited internal source`);
  }
  const contentType = String(object.contentType || "").split(";", 1)[0].trim().toLowerCase();
  const sizeBytes = Number(object.sizeBytes || 0);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > FINAL_REPLY_MAX_FILE_BYTES) {
    throw replyError("FINAL_REPLY_ATTACHMENT_SIZE", `managed attachment ${attachment.objectId} exceeds the attachment size policy`);
  }
  const securityStatus = String(object.securityStatus || "").trim().toLowerCase();
  if (securityStatus && !["clean", "safe", "passed", "verified"].includes(securityStatus)) {
    throw replyError("FINAL_REPLY_ATTACHMENT_UNSAFE", `managed attachment ${attachment.objectId} did not pass the safety policy`);
  }
  const materialized = await managedFiles.materialize(attachment.objectId, { ttlDays: 1, taskId: `final-reply-${sessionId}` });
  if (!materialized?.verified || !materialized.localPath) throw replyError("FINAL_REPLY_MATERIALIZE_FAILED", `managed attachment ${attachment.objectId} could not be verified`);
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    let inspected;
    try {
      inspected = await inspectSendableFile({ filePath: materialized.localPath, declaredMime: contentType, originalName: object.originalName });
    } catch (error) {
      if (error?.code) throw replyError(error.code, `managed attachment ${attachment.objectId}: ${error.message}`);
      throw error;
    }
    const name = safeAttachmentName({ originalName: object.originalName, displayName: attachment.displayName, extensions: inspected.extensions });
    return {
      objectId: attachment.objectId,
      kind: "file",
      name,
      mimeType: inspected.mimeType,
      sizeBytes,
      caption: attachment.caption,
      previewUrl: `/api/chat/attachments/${encodeURIComponent(attachment.objectId)}`,
      downloadUrl: `/api/chat/attachments/${encodeURIComponent(attachment.objectId)}?download=1`,
      localPath: materialized.localPath,
    };
  }
  if (sizeBytes > FINAL_REPLY_MAX_IMAGE_BYTES) {
    throw replyError("FINAL_REPLY_IMAGE_SIZE", `managed attachment ${attachment.objectId} exceeds the image size policy`);
  }
  let metadata;
  try {
    metadata = await sharp(materialized.localPath, { failOn: "warning", limitInputPixels: FINAL_REPLY_MAX_IMAGE_PIXELS }).metadata();
  } catch {
    throw replyError("FINAL_REPLY_IMAGE_INVALID", `managed attachment ${attachment.objectId} is not a valid image`);
  }
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height || width > FINAL_REPLY_MAX_IMAGE_EDGE || height > FINAL_REPLY_MAX_IMAGE_EDGE || width * height > FINAL_REPLY_MAX_IMAGE_PIXELS) {
    throw replyError("FINAL_REPLY_IMAGE_DIMENSIONS", `managed attachment ${attachment.objectId} exceeds the image dimension policy`);
  }
  if (!ALLOWED_IMAGE_TYPES.get(contentType).has(String(metadata.format || "").toLowerCase())) {
    throw replyError("FINAL_REPLY_IMAGE_MIME_MISMATCH", `managed attachment ${attachment.objectId} content does not match its MIME type`);
  }
  const imageExtensions = ({ jpeg: [".jpg", ".jpeg"], png: [".png"], gif: [".gif"], webp: [".webp"] })[String(metadata.format || "").toLowerCase()] || [];
  return {
    objectId: attachment.objectId,
    kind: "image",
    name: safeAttachmentName({
      originalName: object.originalName || path.basename(materialized.localPath),
      displayName: attachment.displayName,
      extensions: imageExtensions,
      fallback: "image",
    }),
    mimeType: contentType,
    sizeBytes,
    width,
    height,
    alt: attachment.alt,
    caption: attachment.caption,
    previewUrl: `/api/chat/attachments/${encodeURIComponent(attachment.objectId)}`,
    downloadUrl: `/api/chat/attachments/${encodeURIComponent(attachment.objectId)}?download=1`,
    localPath: materialized.localPath,
  };
}

function boundedIdentifier(value, field) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) throw replyError("FINAL_REPLY_IDENTIFIER_INVALID", `${field} must be a stable identifier`);
  return text;
}

function boundedText(value, field, maximum, allowEmpty) {
  if (value === undefined || value === null) return allowEmpty ? "" : null;
  if (typeof value !== "string") throw replyError("FINAL_REPLY_TEXT_INVALID", `${field} must be text`);
  const text = value.trim();
  if ((!allowEmpty && !text) || text.length > maximum) throw replyError("FINAL_REPLY_TEXT_INVALID", `${field} is invalid`);
  return text;
}

function replyError(code, message) {
  return Object.assign(new Error(message), { code });
}
