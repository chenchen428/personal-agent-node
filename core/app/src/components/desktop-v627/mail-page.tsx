"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Mail, Search } from "lucide-react";
import type { MailView } from "./types";
import { errorMessage, fetchJson, formatBytes, formatDateTime, relativeTime } from "./shared";

export function MailPage() {
  const [view, setView] = useState<MailView | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState("agent@你的域名");
  const [error, setError] = useState("");

  const load = useCallback(async (id = "") => {
    try {
      const [mail, status] = await Promise.all([
        fetchJson<MailView>(`/api/app/mail/messages${id ? `?message=${encodeURIComponent(id)}` : ""}`),
        fetchJson<{ status: { suggestedRecipients?: string[] } }>("/api/system/mail/status"),
      ]);
      setView(mail);
      setRecipient(status.status?.suggestedRecipients?.[0] || "agent@你的域名");
      setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const events = (view?.events || []).filter((item) => !query || `${item.title} ${item.sender.displayName} ${item.sender.address}`.toLowerCase().includes(query.toLowerCase()));
  const selected = view?.selectedEvent;

  return <main className="v72-page v72-page-flush">
    <div className="v72-split-view">
      <aside className="v72-split-list" aria-label="邮件列表">
        <header className="v72-split-toolbar"><h1>邮件</h1><label className="v72-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮件..." aria-label="搜索邮件" /></label></header>
        <div className="v72-list-label">{recipient}</div>
        {events.map((item) => <button className={`v72-select-row${selectedId === item.id || selected?.id === item.id ? " selected" : ""}`} type="button" onClick={() => { setSelectedId(item.id); void load(item.id); }} key={item.id}>
          <span className="v72-row-icon"><Mail /></span><span className="v72-select-body"><span className="v72-select-line"><strong>{item.title || "（无主题）"}</strong><time>{relativeTime(item.receivedAt)}</time></span><p>{item.sender.displayName || item.sender.address} · {item.payload.textPreview || (item.matched ? "已处理" : "未处理")}</p></span>
        </button>)}
        {!events.length ? <div className="v72-empty">{error || "暂时没有邮件"}</div> : null}
      </aside>
      <article className="v72-split-detail">{selected ? <div className="v72-detail-wrap">
        <header className="v72-detail-head"><div><h1>{view?.content?.subject || selected.title || "（无主题）"}</h1><p>{selected.sender.displayName || selected.sender.address} · {formatDateTime(selected.receivedAt)}</p></div><span className={`v72-badge ${selected.matched ? "success" : "warning"}`}>{selected.matched ? "已处理" : "未处理"}</span></header>
        <div className="v72-mail-meta"><span className="v72-mail-avatar">{(selected.sender.displayName || selected.sender.address || "邮").slice(0, 1)}</span><div><strong>{selected.sender.displayName || selected.sender.address}</strong><span>发送至 {selected.payload.recipients.join("、") || recipient}</span></div><time>{formatDateTime(selected.receivedAt)}</time></div>
        <div className="v72-mail-body">{view?.content?.body || selected.payload.textPreview || "暂无正文"}</div>
        {view?.content?.attachments.length ? <section className="v72-attachments"><h2>附件</h2>{view.content.attachments.map((attachment) => <a className="v72-attachment" href={`/app/mail/messages/${encodeURIComponent(selected.id)}/attachments/${attachment.index}`} key={`${attachment.index}-${attachment.name}`}><span className="v72-row-icon"><FileText /></span><span>{attachment.name}</span><em>{formatBytes(attachment.sizeBytes)}</em><strong>查看</strong></a>)}</section> : null}
      </div> : <div className="v72-empty">选择一封邮件</div>}</article>
    </div>
  </main>;
}
