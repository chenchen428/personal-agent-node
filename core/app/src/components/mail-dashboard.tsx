"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Archive, ArrowLeft, CheckCircle2, ChevronDown, Download, FileUp, Inbox, Mail, RefreshCw, ShieldCheck } from "lucide-react";

type MailEvent = { id: string; title: string; sender: { address: string; displayName: string }; receivedAt: string; matched: boolean; payload: { recipients: string[]; textPreview: string; attachments: { name: string }[] } };
type MailContent = { subject: string; from: { name: string; address: string }[]; to: { name: string; address: string }[]; date: string; body: string; bodyTruncated: boolean; error?: string; attachments: { index: number; name: string; contentType: string; sizeBytes: number }[] };
type MailStatus = { suggestedRecipients: string[]; ingress: { ready: boolean; tokenConfigured: boolean; shimReady: boolean; command: string }; archive: { messages: number | null; bytes: number | null }; policy: { mtaUserManaged: boolean } };
type MailView = { events: MailEvent[]; total: number; selectedEvent: MailEvent | null; selectedRuns: { matched: boolean; reason: string; sessionId: string }[]; content: MailContent | null };

export function MailDashboard() {
  const [status, setStatus] = useState<MailStatus | null>(null);
  const [view, setView] = useState<MailView>({ events: [], total: 0, selectedEvent: null, selectedRuns: [], content: null });
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (messageId = "") => {
    setLoading(true);
    try {
      const [statusResponse, viewResponse] = await Promise.all([
        fetch("/api/system/mail/status", { cache: "no-store" }),
        fetch(`/api/app/mail/messages${messageId ? `?message=${encodeURIComponent(messageId)}` : ""}`, { cache: "no-store" }),
      ]);
      const statusPayload = await readJson<{ ok?: boolean; status?: MailStatus; error?: string }>(statusResponse, "邮件状态服务暂时不可用");
      const viewPayload = await readJson<MailView & { ok?: boolean; error?: string }>(viewResponse, "邮件服务暂时不可用");
      if (!statusResponse.ok || statusPayload.ok === false || !statusPayload.status) throw new Error(statusPayload.error || "无法读取邮件接入状态");
      if (!viewResponse.ok || viewPayload.ok === false) throw new Error(viewPayload.error || "无法读取邮件");
      setStatus(statusPayload.status);
      setView(viewPayload);
      setMessage("");
    } catch (refreshError) {
      setMessage(refreshError instanceof Error ? refreshError.message : "邮件服务暂时不可用");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requestedMessage = new URLSearchParams(window.location.search).get("message") || "";
    setSelectedId(requestedMessage);
    void refresh(requestedMessage);
  }, [refresh]);

  const select = (id: string) => {
    setSelectedId(id);
    void refresh(id);
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMessage("");
    try {
      const response = await fetch("/api/app/mail/import", { method: "POST", headers: { "Content-Type": "message/rfc822" }, body: await file.arrayBuffer() });
      const payload = await readJson<{ ok?: boolean; eventId?: string; error?: string }>(response, "邮件导入失败");
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "邮件导入失败");
      setSelectedId(payload.eventId || "");
      setMessage("邮件已导入本机 Workspace。");
      await refresh(payload.eventId || "");
    } catch (importError) {
      setMessage(importError instanceof Error ? importError.message : "邮件导入失败");
    } finally {
      setImporting(false);
      if (input.current) input.current.value = "";
    }
  };

  const matchedRun = view.selectedRuns.find((run) => run.matched);
  const primaryRecipient = status?.suggestedRecipients?.[0] || "agent@你的域名";

  return <section className="mail-console" aria-live="polite">
    <div className="mail-status-band">
      <div><span className={`semantic-dot ${status?.ingress.ready ? "is-ready" : "is-warning"}`} /><span>本机入口</span><strong>{status?.ingress.ready ? "可接收" : "待接入"}</strong></div>
      <div><Archive className="size-4" /><span>本机归档</span><strong>{status?.archive.messages ?? 0} 封</strong></div>
      <div><ShieldCheck className="size-4" /><span>数据位置</span><strong>仅 Workspace</strong></div>
      <Button variant="outline" size="icon" type="button" aria-label="刷新邮件" title="刷新" onClick={() => void refresh(selectedId)} disabled={loading}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
    </div>

    <details className="mail-connection-guide" open={!view.events.length}>
      <summary><div><span className="toolbar-kicker">CONNECT A MAIL SOURCE</span><strong>接入自己的邮件来源</strong></div><Badge variant={status?.ingress.ready ? "ready" : "warning"}>{status?.ingress.ready ? "入口已准备" : "需要配置"}</Badge><ChevronDown className="size-4" /></summary>
      <div className="mail-guide-steps">
        <section><span>01</span><div><strong>先验证本机归档</strong><p>从 Apple Mail、Outlook 或其他邮箱导出一封 `.eml`，导入后确认正文和附件可读取。这一步不验证发件人身份。</p><input ref={input} type="file" accept=".eml,message/rfc822" onChange={importFile} /><Button variant="outline" type="button" onClick={() => input.current?.click()} disabled={importing}><FileUp className="size-4" />{importing ? "导入中" : "导入 EML"}</Button></div></section>
        <section><span>02</span><div><strong>连接真实收件入口</strong><p>当前稳定方式是由你管理的 Postfix、邮件网关或转发器接收邮件，并把完整 RFC 5322 邮件交给本机命令。</p><code>{`pa-cli mail ingest --recipient ${primaryRecipient} --sender <发件人>`}</code></div></section>
        <section><span>03</span><div><strong>限制收件人与网络</strong><p>只允许明确的收件地址，先从回环或私有网络投递开始。SMTP/IMAP 不是 HTTPS，公网接入需要独立的邮件 Relay，Node 不会自动开放 25 端口。</p><span className="mail-recipient">建议地址 · {status?.suggestedRecipients?.join(" · ") || primaryRecipient}</span></div></section>
      </div>
    </details>

    {message ? <p className="mail-inline-message" role="status">{message}</p> : null}

    <div className="mail-workspace-next">
      <aside className={`mail-list-next ${view.selectedEvent ? "has-selection" : ""}`}>
        <header><div><span className="toolbar-kicker">INBOX</span><strong>{view.total} 封邮件</strong></div><Inbox className="size-5" /></header>
        <div>{view.events.map((event) => <button type="button" className={event.id === selectedId ? "is-active" : ""} onClick={() => select(event.id)} key={event.id}><span><strong>{event.sender.displayName || event.sender.address || "未知发件人"}</strong><time>{formatDate(event.receivedAt)}</time></span><b>{event.title || "（无主题）"}</b><small>{event.payload.textPreview || "暂无正文预览"}</small><em>{event.matched ? "Agent 已关注" : "已归档"}{event.payload.attachments.length ? ` · ${event.payload.attachments.length} 个附件` : ""}</em></button>)}</div>
        {!loading && !view.events.length ? <div className="mail-empty-next"><Mail className="size-6" /><strong>还没有邮件</strong><span>先导入一封 EML，或按上方步骤连接邮件来源。</span></div> : null}
      </aside>

      <article className="mail-reader-next">
        {view.selectedEvent && view.content ? <>
          <header><Button className="mail-reader-back" variant="ghost" size="icon" type="button" aria-label="返回邮件列表" title="返回邮件列表" onClick={() => { setSelectedId(""); setView((current) => ({ ...current, selectedEvent: null, selectedRuns: [], content: null })); }}><ArrowLeft className="size-4" /></Button><div><span className="toolbar-kicker">MESSAGE</span><h2>{view.content.subject || view.selectedEvent.title || "（无主题）"}</h2></div><a href={`/app/mail/messages/${encodeURIComponent(view.selectedEvent.id)}/raw`} aria-label="下载原始邮件" title="下载原始邮件"><Download className="size-4" /></a></header>
          <div className="mail-addresses"><span className="mail-avatar-next">{senderInitial(view.content.from[0]?.name || view.content.from[0]?.address)}</span><div><strong>{addressLabel(view.content.from[0])}</strong><small>发送至 {view.content.to.map(addressLabel).join("、") || view.selectedEvent.payload.recipients.join("、")}</small></div><time>{formatFullDate(view.content.date || view.selectedEvent.receivedAt)}</time></div>
          <div className={`mail-agent-result ${matchedRun ? "is-matched" : ""}`}><CheckCircle2 className="size-4" /><div><strong>{matchedRun ? "Agent 已关注" : "已安全归档"}</strong><span>{matchedRun?.reason || "邮件已经保存在本机，当前没有自动化规则需要处理。"}</span></div>{matchedRun?.sessionId ? <Link href={`/app/chat/session/${encodeURIComponent(matchedRun.sessionId)}/live`}>查看处理</Link> : null}</div>
          {view.content.attachments.length ? <div className="mail-attachments-next">{view.content.attachments.map((attachment) => <a href={`/app/mail/messages/${encodeURIComponent(view.selectedEvent!.id)}/attachments/${attachment.index}`} key={`${attachment.index}-${attachment.name}`}><Download className="size-4" /><span><strong>{attachment.name}</strong><small>{attachment.contentType} · {formatBytes(attachment.sizeBytes)}</small></span></a>)}</div> : null}
          <div className="mail-body-next">{view.content.body || view.selectedEvent.payload.textPreview || "暂无可显示的纯文本正文。"}</div>
        </> : <div className="mail-reader-empty-next"><Mail className="size-7" /><strong>选择一封邮件</strong><span>在这里查看正文、附件和 Agent 处理结果。</span></div>}
      </article>
    </div>
  </section>;
}

function senderInitial(value = "") { return [...String(value || "邮")][0]?.toUpperCase() || "邮"; }
function addressLabel(value?: { name: string; address: string }) { return value ? (value.name ? `${value.name} <${value.address}>` : value.address) : "未知发件人"; }
function formatDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date) : ""; }
function formatFullDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : ""; }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
async function readJson<T>(response: Response, fallback: string): Promise<T> { const text = await response.text(); if (!text) return { error: fallback } as T; try { return JSON.parse(text) as T; } catch { return { error: fallback } as T; } }
