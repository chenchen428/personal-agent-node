"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Mail, Search } from "lucide-react";
import type { MailView } from "./types";
import { errorMessage, fetchJson, formatBytes, formatDateTime, relativeTime } from "./shared";
import { LoadingState } from "../desktop-v72/loading-state";
import { useSearchParams } from "next/navigation";

export function MailPage() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<MailView | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [recipient, setRecipient] = useState("agent@你的域名");
  const [error, setError] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async (id = "", { detail = false }: { detail?: boolean } = {}) => {
    const request = ++requestRef.current;
    if (detail) setDetailLoading(true);
    else setListLoading(true);
    try {
      const mail = await fetchJson<MailView>(`/api/app/mail/messages${id ? `?message=${encodeURIComponent(id)}` : ""}`);
      if (request !== requestRef.current) return;
      setView(mail);
      setSelectedId((current) => current || mail.selectedEvent?.id || "");
      setError("");
    } catch (cause) {
      if (request === requestRef.current) setError(errorMessage(cause));
    } finally {
      if (request === requestRef.current) {
        if (detail) setDetailLoading(false);
        else setListLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const requestedMessage = searchParams.get("message") || "";
    setSelectedId(requestedMessage);
    void load(requestedMessage);
    void fetchJson<{ status: { suggestedRecipients?: string[] } }>("/api/system/mail/status")
      .then((status) => setRecipient(status.status?.suggestedRecipients?.[0] || "agent@你的域名"))
      .catch(() => undefined);
  }, [load, searchParams]);
  const events = (view?.events || []).filter((item) => !query || `${item.title} ${item.sender.displayName} ${item.sender.address}`.toLowerCase().includes(query.toLowerCase()));
  const selected = view?.selectedEvent;
  const detailFailed = Boolean(error && selectedId && selected?.id !== selectedId);
  const selectMessage = (id: string) => {
    setSelectedId(id);
    void load(id, { detail: true });
  };

  return <main className="v72-page v72-page-flush">
    <div className="v72-split-view">
      <aside className="v72-split-list" aria-label="邮件列表" aria-busy={listLoading}>
        <header className="v72-split-toolbar"><h1>邮件</h1><label className="v72-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索邮件..." aria-label="搜索邮件" /></label></header>
        <div className="v72-list-label">{recipient}</div>
        {listLoading && !view ? <LoadingState label="正在读取邮件" compact /> : events.map((item) => <button className={`v72-select-row${selectedId === item.id ? " selected" : ""}`} type="button" aria-pressed={selectedId === item.id} onClick={() => selectMessage(item.id)} key={item.id}>
          <span className="v72-row-icon"><Mail /></span><span className="v72-select-body"><span className="v72-select-line"><strong>{item.title || "（无主题）"}</strong><time>{relativeTime(item.receivedAt)}</time></span><p>{item.sender.displayName || item.sender.address} · {item.payload.textPreview || (item.matched ? "已处理" : "未处理")}</p></span>
        </button>)}
        {!listLoading && !events.length ? <div className="v72-empty">{error || "暂时没有邮件"}</div> : null}
      </aside>
      <article className="v72-split-detail" aria-busy={listLoading || detailLoading}>{listLoading || detailLoading ? <LoadingState label="正在准备邮件内容" /> : detailFailed ? <div className="v72-empty">{error}</div> : selected ? <div className="v72-detail-wrap">
        <header className="v72-detail-head"><div><h1>{view?.content?.subject || selected.title || "（无主题）"}</h1><p>{selected.sender.displayName || selected.sender.address} · {formatDateTime(selected.receivedAt)}</p></div><span className={`v72-badge ${selected.matched ? "success" : "warning"}`}>{selected.matched ? "已处理" : "未处理"}</span></header>
        <div className="v72-mail-meta"><span className="v72-mail-avatar">{(selected.sender.displayName || selected.sender.address || "邮").slice(0, 1)}</span><div><strong>{selected.sender.displayName || selected.sender.address}</strong><span>发送至 {selected.payload.recipients.join("、") || recipient}</span></div><time>{formatDateTime(selected.receivedAt)}</time></div>
        <div className="v72-mail-body">{view?.content?.body || selected.payload.textPreview || "暂无正文"}</div>
        {view?.content?.attachments.length ? <section className="v72-attachments"><h2>附件</h2>{view.content.attachments.map((attachment) => <a className="v72-attachment" href={`/app/mail/messages/${encodeURIComponent(selected.id)}/attachments/${attachment.index}`} key={`${attachment.index}-${attachment.name}`}><span className="v72-row-icon"><FileText /></span><span>{attachment.name}</span><em>{formatBytes(attachment.sizeBytes)}</em><strong>查看</strong></a>)}</section> : null}
      </div> : <div className="v72-empty">选择一封邮件</div>}</article>
    </div>
  </main>;
}
