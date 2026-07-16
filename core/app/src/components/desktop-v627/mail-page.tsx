"use client";

import { useCallback, useEffect, useState } from "react";
import type { MailView } from "./types";
import { Empty, Filters, Heading, errorMessage, fetchJson, formatBytes, formatDateTime, relativeTime } from "./shared";

export function MailPage() {
  const [view, setView] = useState<MailView | null>(null); const [selectedId, setSelectedId] = useState(""); const [query, setQuery] = useState(""); const [filter, setFilter] = useState("全部"); const [recipient, setRecipient] = useState("agent@你的域名"); const [error, setError] = useState("");
  const load = useCallback(async (id = "") => {
    try {
      const [mail, status] = await Promise.all([fetchJson<MailView>(`/api/app/mail/messages${id ? `?message=${encodeURIComponent(id)}` : ""}`), fetchJson<{ status: { suggestedRecipients?: string[] } }>("/api/system/mail/status")]);
      setView(mail); setRecipient(status.status?.suggestedRecipients?.[0] || "agent@你的域名"); setError("");
    } catch (cause) { setError(errorMessage(cause)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const events = (view?.events || []).filter((item) => {
    const matchesFilter = filter === "全部"
      || (filter === "未处理" && !item.matched)
      || (filter === "已处理" && item.matched)
      || (filter === "有附件" && item.payload.attachments.length > 0);
    return matchesFilter && (!query || `${item.title} ${item.sender.displayName} ${item.sender.address}`.toLowerCase().includes(query.toLowerCase()));
  });
  return <main><Heading eyebrow="PA 邮箱" title="PA 收到的邮件" copy={`把资料或通知发送到 ${recipient}，PA 会在本机接收并处理。`} action={<span className="pa-status private">只读查看</span>} /><div className="pa-boundary-demo"><strong>Agent 邮箱：</strong>{recipient} · 邮件正文和附件保存在用户自己的电脑上。</div><div className="pa-toolbar" style={{ marginTop: 12 }}><Filters labels={[`全部 ${view?.total || 0}`, `未处理 ${(view?.events || []).filter((item) => !item.matched).length}`, `已处理 ${(view?.events || []).filter((item) => item.matched).length}`, `有附件 ${(view?.events || []).filter((item) => item.payload.attachments.length).length}`]} selected={filter} onSelect={setFilter} /><input className="pa-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题或发件人" aria-label="搜索邮件" /></div>{error ? <p className="pa-boundary-demo">{error}</p> : null}<div className="pa-split"><aside className="pa-list">{events.map((item) => <button className={`pa-list-item${selectedId === item.id || view?.selectedEvent?.id === item.id ? " selected" : ""}`} type="button" onClick={() => { setSelectedId(item.id); void load(item.id); }} key={item.id}><span className="pa-avatar">{(item.sender.displayName || item.sender.address || "邮").slice(0, 1)}</span><span><strong>{item.title || "（无主题）"}</strong><small>{item.sender.displayName || item.sender.address} · {item.matched ? "已处理" : "未处理"}{item.payload.attachments.length ? ` · ${item.payload.attachments.length} 个附件` : ""}</small></span><time>{relativeTime(item.receivedAt)}</time></button>)}</aside><article className="pa-detail">{view?.selectedEvent ? <><span className="pa-eyebrow">邮件详情 · {view.selectedEvent.matched ? "已处理" : "未处理"}</span><h2>{view.content?.subject || view.selectedEvent.title}</h2><p>{view.selectedEvent.sender.displayName || view.selectedEvent.sender.address} &lt;{view.selectedEvent.sender.address}&gt;<br />收件：{view.selectedEvent.payload.recipients.join("、") || recipient} · {formatDateTime(view.selectedEvent.receivedAt)}</p><div className="pa-message" style={{ maxWidth: "100%" }}>{view.content?.body || view.selectedEvent.payload.textPreview || "暂无正文"}</div>{view.content?.attachments.map((attachment) => <a className="pa-button" href={`/app/mail/messages/${encodeURIComponent(view.selectedEvent!.id)}/attachments/${attachment.index}`} key={`${attachment.index}-${attachment.name}`}>▤ {attachment.name} · {formatBytes(attachment.sizeBytes)}</a>)}</> : <Empty text="选择一封邮件" />}</article></div></main>;
}
