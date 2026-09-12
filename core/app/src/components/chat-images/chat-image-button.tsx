"use client";

import { useState, type ReactNode } from "react";
import { announceImagePreview, type ChatPreviewImage } from "@/lib/chat-image-preview";
import { ChatImageDialog } from "./chat-image-dialog";

export function ChatImageButton({ image, className = "", children }: { image: ChatPreviewImage; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`chat-image-trigger ${className}`} aria-label={`预览图片 ${image.alt}`} onClick={(event) => {
      announceImagePreview(event.currentTarget); setOpen(true);
    }}>{children}</button>
    {open ? <ChatImageDialog image={image} onClose={() => setOpen(false)} /> : null}
  </>;
}
