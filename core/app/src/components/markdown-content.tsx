"use client";

import { useState, type MouseEvent, type KeyboardEvent } from "react";
import { renderMarkdown, type MarkdownLinkTransform } from "@/lib/markdown";
import { announceImagePreview, isImagePreviewKey, safeChatImageUrl, type ChatPreviewImage } from "@/lib/chat-image-preview";
import { ChatImageDialog } from "./chat-images/chat-image-dialog";

export function MarkdownContent({ content, className = "", linkTransform, previewImages = false }: { content: string; className?: string; linkTransform?: MarkdownLinkTransform; previewImages?: boolean }) {
  const [image, setImage] = useState<ChatPreviewImage | null>(null);
  const preview = (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    if (!previewImages || ("key" in event && !isImagePreviewKey(event.key))) return;
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.hasAttribute("data-chat-image")) return;
    const src = safeChatImageUrl(target.getAttribute("src") || "");
    if (!src) return;
    event.preventDefault(); event.stopPropagation(); announceImagePreview(target);
    setImage({ src, alt: target.alt || "对话图片", name: target.alt || "图片" });
  };
  return <><div className={`pa-markdown v72-markdown${className ? ` ${className}` : ""}`} onClick={previewImages ? preview : undefined} onKeyDown={previewImages ? preview : undefined} dangerouslySetInnerHTML={{ __html: renderMarkdown(content, linkTransform, previewImages) }} />
    {image ? <ChatImageDialog image={image} onClose={() => setImage(null)} /> : null}
  </>;
}
