import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import {
  clipboardImageFiles,
  prepareAttachments,
  validateAttachmentBatch,
  type PendingAttachment,
} from "./conversation-attachments";
import { fetchJson } from "./shared";

export function useConversationAttachments() {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [uploading, setUploading] = useState(false);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queuedUploadsRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: File[], source: "picker" | "clipboard") => {
    if (!files.length) return;
    queuedUploadsRef.current += 1;
    setUploading(true);
    const upload = uploadQueueRef.current.then(async () => {
      try {
        const prepared = await prepareAttachments(attachmentsRef.current, files, source);
        validateAttachmentBatch(attachmentsRef.current, prepared.map((attachment) => ({
          name: attachment.name,
          size: attachment.sizeBytes,
          type: attachment.mimeType,
        })));
        const result = await fetchJson<{ attachments: PendingAttachment[] }>("/api/chat/desktop/conversation/attachments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ attachments: prepared }),
        });
        const next = [...attachmentsRef.current, ...result.attachments];
        attachmentsRef.current = next;
        setAttachments(next);
        setAttachmentError("");
      } catch (cause) {
        setAttachmentError(cause instanceof Error ? cause.message : "无法上传附件，请重新选择");
      } finally {
        queuedUploadsRef.current -= 1;
        if (!queuedUploadsRef.current) setUploading(false);
      }
    });
    uploadQueueRef.current = upload.catch(() => undefined);
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    addFiles(files, "picker");
  };

  const pasteImages = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = clipboardImageFiles(event.clipboardData);
    if (!images.length) return;
    event.preventDefault();
    addFiles(images, "clipboard");
  };

  const removeAttachment = (index: number) => {
    const next = attachmentsRef.current.filter((_, itemIndex) => itemIndex !== index);
    attachmentsRef.current = next;
    setAttachments(next);
    setAttachmentError("");
  };

  const clearAttachments = () => {
    attachmentsRef.current = [];
    setAttachments([]);
    setAttachmentError("");
  };

  return {
    attachments,
    attachmentError,
    uploading,
    fileRef,
    selectFiles,
    pasteImages,
    removeAttachment,
    clearAttachments,
  };
}
