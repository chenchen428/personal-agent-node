"use client";

import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

export type PendingAttachment = { name: string; mimeType: string; sizeBytes: number; content: string };

type Props = {
  initialMessage?: string;
  sending: boolean;
  waiting: boolean;
  error: string;
  onSend: (content: string, attachment: PendingAttachment | null) => Promise<void>;
};

export function ConversationComposer({ initialMessage = "", sending, waiting, error, onSend }: Props) {
  const [message, setMessage] = useState(initialMessage);
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if ((!content && !attachment) || sending || waiting) return;
    try {
      await onSend(content || `请处理附件：${attachment!.name}`, attachment);
      setMessage("");
      setAttachment(null);
    } catch {
      // Parent state keeps the message and exposes the recoverable error.
    }
  };

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setAttachmentError("单个附件不能超过 5 MB");
      return;
    }
    try {
      setAttachment({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        content: await readBase64(file),
      });
      setAttachmentError("");
    } catch {
      setAttachmentError("无法读取这个附件，请重新选择");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return <form className="composer-wrap" onSubmit={submit}><div className="composer">
    <label className="sr-only" htmlFor="desktop-chat-input">发消息给 PA</label>
    <textarea
      id="desktop-chat-input"
      autoFocus
      rows={1}
      maxLength={4000}
      placeholder="让 Personal Agent 做什么…"
      value={message}
      onChange={(event) => setMessage(event.target.value)}
      onInput={(event) => {
        event.currentTarget.style.height = "auto";
        event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`;
      }}
      onKeyDown={handleKeyDown}
    />
    {attachment ? <div className="composer-selected-file">
      <span>{attachment.name}</span>
      <button type="button" onClick={() => setAttachment(null)} aria-label={`移除附件 ${attachment.name}`}>×</button>
    </div> : null}
    <footer className="composer-actions"><div className="composer-tools">
      <button className="icon-button" type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件" title="添加附件">
        <AttachmentIcon />
      </button>
      <span className="composer-feedback">{attachmentError || error || (waiting ? "PA 正在处理，回复会自动出现" : "")}</span></div>
      <button className="send-button" type="submit" disabled={sending || waiting || (!message.trim() && !attachment)} aria-label="发送消息">
        <SendIcon />
      </button>
    </footer>
    <input ref={fileRef} type="file" hidden onChange={selectFile} />
    <span className="composer-send-status" role="status">{sending ? "正在发送" : waiting ? "PA 正在处理" : ""}</span>
  </div></form>;
}

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
    reader.readAsDataURL(file);
  });
}

function AttachmentIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 12.5l6-6a3 3 0 014.2 4.2l-7.6 7.6a5 5 0 01-7.1-7.1l7.3-7.3" /></svg>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-5 5l5-5 5 5" /></svg>;
}
