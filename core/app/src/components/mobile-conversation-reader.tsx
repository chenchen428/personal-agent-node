"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Clock3, MessageCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ChatMessage = { id: string; role: "user" | "assistant" | "agent" | "tool" | "system" | "error"; content: string; createdAt?: string };
type ChatSession = { id: string; title: string; status: string; summary?: string; updatedAt?: string; messages?: ChatMessage[] };

const runningStates = new Set(["start", "running"]);

export function MobileConversationReader({ initialSessionId = "" }: { initialSessionId?: string }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<unknown>[] = [loadJson<{ ok?: boolean; sessions?: ChatSession[] }>("/api/chat/sessions?limit=40")];
      if (initialSessionId) requests.push(loadJson<{ ok?: boolean; session?: ChatSession }>(`/api/chat/sessions/${encodeURIComponent(initialSessionId)}`));
      const [list, detail] = await Promise.all(requests) as [{ sessions?: ChatSession[] }, { session?: ChatSession }?];
      setSessions(list.sessions || []);
      setSession(detail?.session || null);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "对话暂时无法读取");
    } finally { setLoading(false); }
  }, [initialSessionId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!runningStates.has(session?.status || "")) return;
    const timer = window.setTimeout(() => void refresh(), 2200);
    return () => window.clearTimeout(timer);
  }, [refresh, session?.status, session?.messages?.length]);

  if (!initialSessionId) return <main className="mobile-conversation-reader">
    <ReaderHeader title="全部对话" description={loading ? "正在读取本机会话" : `${sessions.length} 段本地记录`} onRefresh={refresh} loading={loading} />
    {error ? <p className="mobile-reader-error" role="alert">{error}</p> : null}
    <section className="mobile-conversation-index" aria-label="全部对话">
      {sessions.map((item) => <Link href={`/app/mobile/conversations/${encodeURIComponent(item.id)}`} key={item.id}>
        <div><strong>{item.title || "未命名对话"}</strong><p>{item.summary || statusLabel(item.status)}</p><small><Clock3 className="size-3" />{formatTime(item.updatedAt)}</small></div>
        <ArrowUpRight className="size-4" />
      </Link>)}
      {!loading && !sessions.length ? <div className="mobile-conversation-empty"><MessageCircle className="size-6" /><strong>还没有对话记录</strong><span>这里仅用于阅读已发生的会话。</span></div> : null}
    </section>
  </main>;

  return <main className="mobile-conversation-reader">
    <div className="mobile-conversation-back"><Link href="/app/mobile/conversations"><ArrowLeft className="size-4" />全部对话</Link><Button variant="outline" size="icon" type="button" aria-label="刷新对话" title="刷新" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button></div>
    <header className="mobile-conversation-heading">
      <div><span className="toolbar-kicker">READ ONLY · LOCAL</span><h1>{session?.title || (loading ? "正在读取" : "对话不存在")}</h1></div>
      {session ? <Badge variant={runningStates.has(session.status) ? "warning" : "ready"}>{statusLabel(session.status)}</Badge> : null}
      {session?.summary ? <p>{session.summary}</p> : null}
    </header>
    {error ? <p className="mobile-reader-error" role="alert">{error}</p> : null}
    <section className="mobile-conversation-transcript" aria-live="polite">
      {session?.messages?.length ? session.messages.map((message) => <article className={`mobile-conversation-message role-${message.role}`} key={message.id}>
        <header><span>{messageLabel(message.role)}</span>{message.createdAt ? <time>{formatTime(message.createdAt)}</time> : null}</header>
        <div>{message.content}</div>
      </article>) : !loading ? <div className="mobile-conversation-empty"><MessageCircle className="size-6" /><strong>暂无可阅读内容</strong><span>这段会话还没有保存消息。</span></div> : null}
    </section>
  </main>;
}

function ReaderHeader({ title, description, onRefresh, loading }: { title: string; description: string; onRefresh: () => Promise<void>; loading: boolean }) {
  return <header className="mobile-conversation-list-heading"><div><Link href="/app/mobile"><ArrowLeft className="size-4" />阅读首页</Link><span className="toolbar-kicker">CONVERSATIONS</span><h1>{title}</h1><p>{description}</p></div><Button variant="outline" size="icon" type="button" aria-label="刷新对话列表" title="刷新" disabled={loading} onClick={() => void onRefresh()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button></header>;
}

function statusLabel(status = "") { return ({ start: "启动中", running: "处理中", idle: "等待继续", paused: "已暂停", done: "已完成", archived: "已归档" } as Record<string, string>)[status] || status || "本地记录"; }
function messageLabel(role: ChatMessage["role"]) { return ({ user: "你", assistant: "Agent", agent: "处理过程", tool: "工具记录", system: "系统记录", error: "错误" } as const)[role]; }
function formatTime(value?: string) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "刚刚"; }
async function loadJson<T extends { ok?: boolean; error?: string }>(url: string): Promise<T> { const response = await fetch(url, { cache: "no-store" }); const text = await response.text(); let payload: T; try { payload = JSON.parse(text) as T; } catch { throw new Error("响应格式无效"); } if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`); return payload; }
