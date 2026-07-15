import { simpleParser } from "mailparser";

const MAX_BODY_CHARS = 200_000;

export async function parseMailForDisplay(raw) {
  const parsed = await simpleParser(raw, {
    skipTextToHtml: true,
    maxHtmlLengthToParse: 2 * 1024 * 1024,
  });
  const body = String(parsed.text || htmlToPlainText(parsed.html || "")).trim();
  return {
    subject: String(parsed.subject || ""),
    from: addressList(parsed.from),
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    replyTo: addressList(parsed.replyTo),
    date: parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : "",
    messageId: String(parsed.messageId || ""),
    body: body.slice(0, MAX_BODY_CHARS),
    bodyTruncated: body.length > MAX_BODY_CHARS,
    hasHtml: Boolean(parsed.html),
    attachments: (parsed.attachments || []).map((attachment, index) => ({
      index,
      name: String(attachment.filename || `attachment-${index + 1}`),
      contentType: String(attachment.contentType || "application/octet-stream"),
      sizeBytes: Number(attachment.size || attachment.content?.length || 0),
      contentId: String(attachment.contentId || ""),
      disposition: String(attachment.contentDisposition || "attachment"),
    })),
  };
}

export async function readMailAttachment(raw, index) {
  const parsed = await simpleParser(raw, { skipTextToHtml: true, skipHtmlToText: true });
  const attachment = parsed.attachments?.[Number(index)];
  if (!attachment) throw Object.assign(new Error("mail attachment not found"), { code: "ENOENT" });
  return {
    name: String(attachment.filename || `attachment-${Number(index) + 1}`),
    contentType: String(attachment.contentType || "application/octet-stream"),
    content: Buffer.from(attachment.content || ""),
  };
}

function addressList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((item) => Array.isArray(item?.value) ? item.value : []).map((item) => ({
    name: String(item?.name || ""),
    address: String(item?.address || ""),
  })).filter((item) => item.name || item.address);
}

function htmlToPlainText(value) {
  return String(value || "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/tr|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
