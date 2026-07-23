export const MAX_ATTACHMENT_COUNT = 4;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type PendingAttachment = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
};

type AttachmentSource = "picker" | "clipboard";
type FileDescriptor = Pick<File, "name" | "size" | "type">;

export function clipboardImageFiles(clipboard: Pick<DataTransfer, "items">) {
  return Array.from(clipboard.items)
    .filter((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

export function validateAttachmentBatch(
  existing: Array<Pick<PendingAttachment, "sizeBytes">>,
  files: FileDescriptor[],
) {
  if (existing.length + files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`一次最多添加 ${MAX_ATTACHMENT_COUNT} 个附件`);
  }
  if (files.some((file) => file.size <= 0)) {
    throw new Error("附件内容为空，请重新选择");
  }
  if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
    throw new Error("单个附件不能超过 5 MB");
  }
  const totalBytes = existing.reduce((total, item) => total + item.sizeBytes, 0)
    + files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error("附件总大小不能超过 10 MB");
  }
}

export async function prepareAttachments(
  existing: PendingAttachment[],
  files: File[],
  source: AttachmentSource,
) {
  validateAttachmentBatch(existing, files);
  const now = new Date();
  return Promise.all(files.map(async (file, index) => ({
    name: source === "clipboard"
      ? pastedImageName(file.type, now, index, files.length)
      : file.name || `attachment-${index + 1}`,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    content: await readBase64(file),
  })));
}

export function pastedImageName(mimeType: string, now = new Date(), index = 0, total = 1) {
  const extension = imageExtension(mimeType);
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = total > 1 ? `-${index + 1}` : "";
  return `pasted-image-${timestamp}${suffix}.${extension}`;
}

function imageExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(";", 1)[0];
  return ({
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  } as Record<string, string>)[normalized] || "png";
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取附件，请重新选择"));
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
}
