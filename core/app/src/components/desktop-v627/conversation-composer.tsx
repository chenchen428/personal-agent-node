"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ConversationAttachmentList } from "./conversation-attachment-list";
import type { PendingAttachment } from "./conversation-attachments";
import { useConversationAttachments } from "./use-conversation-attachments";

type Props = {
  initialMessage?: string;
  sending: boolean;
  waiting: boolean;
  error: string;
  onSend: (content: string, attachments: PendingAttachment[]) => Promise<void>;
};

export function ConversationComposer({ initialMessage = "", sending, waiting, error, onSend }: Props) {
  const [message, setMessage] = useState(initialMessage);
  const {
    attachments,
    attachmentError,
    uploading,
    fileRef,
    selectFiles,
    pasteImages,
    removeAttachment,
    clearAttachments,
    restoreAttachments,
  } = useConversationAttachments();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if ((!content && !attachments.length) || sending || waiting || uploading) return;
    const submittedMessage = message;
    const submittedAttachments = attachments;
    try {
      const sendRequest = onSend(
        content || `请处理附件：${submittedAttachments.map((attachment) => attachment.name).join("、")}`,
        submittedAttachments,
      );
      setMessage("");
      clearAttachments();
      await sendRequest;
    } catch {
      setMessage((current) => current || submittedMessage);
      restoreAttachments(submittedAttachments);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return <form className="composer-wrap" onSubmit={submit}><div className="composer">
    <ConversationAttachmentList attachments={attachments} disabled={sending} onRemove={removeAttachment} />
    <label className="sr-only" htmlFor="desktop-chat-input">发消息给 PA</label>
    <textarea
      id="desktop-chat-input"
      autoFocus
      rows={1}
      readOnly={sending}
      maxLength={4000}
      placeholder="让 Personal Agent 做什么…"
      value={message}
      onChange={(event) => setMessage(event.target.value)}
      onInput={(event) => {
        event.currentTarget.style.height = "auto";
        event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
      }}
      onKeyDown={handleKeyDown}
      onPaste={pasteImages}
    />
    <footer className="composer-actions"><div className="composer-tools">
      <button className="icon-button" type="button" disabled={sending} onClick={() => fileRef.current?.click()} aria-label="添加附件" title="添加附件">
        <AttachmentIcon />
      </button>
      <span className="composer-feedback">{attachmentError || error || (uploading ? "正在上传附件…" : waiting ? "PA 正在处理，回复会自动出现" : "")}</span></div>
      <button className="send-button" type="submit" disabled={sending || waiting || uploading || (!message.trim() && !attachments.length)} aria-label="发送消息">
        <SendIcon />
      </button>
    </footer>
    <input ref={fileRef} type="file" multiple hidden onChange={selectFiles} />
    <span className="composer-send-status" role="status">{uploading ? "正在上传附件" : sending ? "正在发送" : waiting ? "PA 正在处理" : ""}</span>
  </div></form>;
}

function AttachmentIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12.5l6-6a3 3 0 014.2 4.2l-7.6 7.6a5 5 0 01-7.1-7.1l7.3-7.3" /></svg>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-5 5l5-5 5 5" /></svg>;
}
