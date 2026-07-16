"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, FileText, Mail, MessageCircle, RefreshCw, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";

type ChatSession = { id: string; title: string; status: string; summary?: string; updatedAt?: string };
type MailEvent = { id: string; title: string; sender: { address: string; displayName: string }; receivedAt: string; payload: { textPreview: string } };
type PageAsset = { fileName: string; updatedAt: string; publicPath: string };

export function MobileReaderDashboard() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [mail, setMail] = useState<MailEvent[]>([]);
  const [pages, setPages] = useState<PageAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      loadJson<{ ok?: boolean; sessions?: ChatSession[] }>("/api/chat/sessions?limit=6"),
      loadJson<{ ok?: boolean; events?: MailEvent[] }>("/api/app/mail/messages"),
      loadJson<{ ok?: boolean; assets?: PageAsset[] }>("/api/publications"),
    ]);

    const failed: string[] = [];
    const conversations = results[0];
    const messages = results[1];
    const publications = results[2];
    if (conversations.status === "fulfilled") setSessions(conversations.value.sessions || []); else failed.push("对话");
    if (messages.status === "fulfilled") setMail(messages.value.events || []); else failed.push("邮件");
    if (publications.status === "fulfilled") setPages(publications.value.assets || []); else failed.push("页面");
    setUnavailable(failed);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return <main className="mobile-reader">
    <header className="mobile-reader-hero">
      <div className="mobile-reader-status"><Wifi className="size-3.5" /><span>安全隧道 · 本机内容</span></div>
      <h1>回来看看，<br />你的 Agent 最近在做什么。</h1>
      <p>这是为手机准备的阅读首页。内容仍保存在你的电脑，只通过已登录的私有入口读取。</p>
      <div className="mobile-reader-counts" aria-label="内容摘要">
        <span><strong>{sessions.length}</strong>对话</span>
        <span><strong>{mail.length}</strong>邮件</span>
        <span><strong>{pages.length}</strong>页面</span>
      </div>
    </header>

    <div className="mobile-reader-toolbar">
      <div><span>最近更新</span><small>{loading ? "正在读取本机内容" : unavailable.length ? `${unavailable.join("、")}暂不可用` : "内容已同步"}</small></div>
      <Button variant="outline" size="icon" type="button" aria-label="刷新阅读首页" title="刷新" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
    </div>

    <ReadingSection title="对话" description="继续阅读最近的处理过程" href="/app/mobile/conversations" icon={<MessageCircle className="size-4" />}>
      {sessions.slice(0, 4).map((session) => <Link className="mobile-reader-item" href={`/app/mobile/conversations/${encodeURIComponent(session.id)}`} key={session.id}>
        <div><strong>{session.title || "未命名对话"}</strong><p>{session.summary || statusLabel(session.status)}</p></div>
        <span><time>{formatRelative(session.updatedAt)}</time><ArrowUpRight className="size-3.5" /></span>
      </Link>)}
      {!loading && !sessions.length ? <EmptyReadingState>还没有对话记录</EmptyReadingState> : null}
    </ReadingSection>

    <ReadingSection title="邮件" description="快速浏览新到内容" href="/app/mail" icon={<Mail className="size-4" />}>
      {mail.slice(0, 4).map((message) => <Link className="mobile-reader-item" href={`/app/mail?message=${encodeURIComponent(message.id)}`} key={message.id}>
        <div><strong>{message.title || "（无主题）"}</strong><p>{message.payload.textPreview || message.sender.displayName || message.sender.address || "暂无正文预览"}</p></div>
        <span><time>{formatRelative(message.receivedAt)}</time><ArrowUpRight className="size-3.5" /></span>
      </Link>)}
      {!loading && !mail.length ? <EmptyReadingState>还没有收到邮件</EmptyReadingState> : null}
    </ReadingSection>

    <ReadingSection title="页面" description="打开已发布的阅读内容" href="/app/pages" icon={<FileText className="size-4" />}>
      {pages.slice(0, 3).map((page) => <a className="mobile-reader-item" href={publicUrl(page)} key={page.publicPath}>
        <div><strong>{page.fileName}</strong><p>Online Page · {formatDate(page.updatedAt)}</p></div>
        <span><ArrowUpRight className="size-3.5" /></span>
      </a>)}
      {!loading && !pages.length ? <EmptyReadingState>还没有发布页面</EmptyReadingState> : null}
    </ReadingSection>
  </main>;
}

function ReadingSection({ title, description, href, icon, children }: { title: string; description: string; href: string; icon: ReactNode; children: ReactNode }) {
  return <section className="mobile-reading-section">
    <header><div className="mobile-reading-title"><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><Link href={href}>查看全部</Link></header>
    <div className="mobile-reading-list">{children}</div>
  </section>;
}

function EmptyReadingState({ children }: { children: ReactNode }) { return <p className="mobile-reading-empty">{children}</p>; }
function publicUrl(asset: PageAsset) { return `/public${asset.publicPath.startsWith("/") ? asset.publicPath : `/${asset.publicPath}`}`; }
function statusLabel(status = "") { return ({ start: "正在启动", running: "正在处理", idle: "等待继续", paused: "已暂停", done: "已完成", archived: "已归档" } as Record<string, string>)[status] || "本机会话"; }
function formatDate(value?: string) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date) : ""; }
function formatRelative(value?: string) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "刚刚";
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return "刚刚";
  if (elapsed >= 0 && elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
  if (elapsed >= 0 && elapsed < 86_400_000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))} 小时前`;
  return formatDate(value);
}
async function loadJson<T extends { ok?: boolean; error?: string }>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let payload: T;
  try { payload = JSON.parse(text) as T; } catch { throw new Error("响应格式无效"); }
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}
