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

export function useConversationAttachments() {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[], source: "picker" | "clipboard") => {
    if (!files.length) return;
    try {
      const prepared = await prepareAttachments(attachmentsRef.current, files, source);
      validateAttachmentBatch(attachmentsRef.current, prepared.map((attachment) => ({
        name: attachment.name,
        size: attachment.sizeBytes,
        type: attachment.mimeType,
      })));
      const next = [...attachmentsRef.current, ...prepared];
      attachmentsRef.current = next;
      setAttachments(next);
      setAttachmentError("");
    } catch (cause) {
      setAttachmentError(cause instanceof Error ? cause.message : "无法读取附件，请重新选择");
    }
  };

  const selectFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    void addFiles(files, "picker");
  };

  const pasteImages = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = clipboardImageFiles(event.clipboardData);
    if (!images.length) return;
    event.preventDefault();
    void addFiles(images, "clipboard");
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
    fileRef,
    selectFiles,
    pasteImages,
    removeAttachment,
    clearAttachments,
  };
}
