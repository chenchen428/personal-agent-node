export type ChatPreviewImage = { src: string; fallbackSrc?: string; alt: string; name?: string; downloadUrl?: string };

export function safeChatImageUrl(value: string) {
  if (value.trim() !== value || /[\x00-\x1f\\]/.test(value)) return "";
  if (/^blob:/i.test(value)) return value;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,/i.test(value)) return value;
  try { const url = new URL(value, "https://image-preview.invalid/"); if (value && ["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return value; } catch { /* Unsupported sources do not become navigation targets. */ }
  return "";
}

export function isImagePreviewKey(key: string) { return key === "Enter" || key === " "; }

export function announceImagePreview(trigger: HTMLElement) {
  trigger.dispatchEvent(new Event("chat-image-preview-open", { bubbles: true }));
}
