"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoaderCircle, Menu, MessageCircle, Plus, Send, Square, X } from "lucide-react";

type ChatMessage = { id: string; role: "user" | "assistant" | "agent" | "tool" | "system" | "error"; content: string; createdAt?: string };
type ChatSession = { id: string; title: string; status: string; summary?: string; updatedAt?: string; messages?: ChatMessage[] };

const runningStates = new Set(["start", "running"]);

export function ChatDashboard({ initialSessionId = "" }: { initialSessionId?: string }) {
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedId, setSelectedId] = useState(initialSessionId);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    const response = await fetch("/api/chat/sessions?limit=40", { cache: "no-store" });
    const payload = await readJson<{ ok?: boolean; sessions?: ChatSession[]; error?: string }>(response, "对话服务暂时不可用");
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "无法读取会话");
    setSessions(payload.sessions || []);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    if (!id) { setSession(null); return; }
    const response = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload = await readJson<{ ok?: boolean; session?: ChatSession; error?: string }>(response, "对话服务暂时不可用");
    if (!response.ok || payload.ok === false || !payload.session) throw new Error(payload.error || "无法读取对话");
    setSession(payload.session);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadSessions(), selectedId ? loadSession(selectedId) : Promise.resolve()]);
      setError("");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "对话服务暂时不可用");
    } finally {
      setLoading(false);
    }
  }, [loadSession, loadSessions, selectedId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { messagesEnd.current?.scrollIntoView({ block: "end" }); }, [session?.messages?.length]);
  useEffect(() => {
    if (!selectedId || !runningStates.has(session?.status || "")) return;
    const timer = window.setTimeout(() => void refresh(), 1800);
    return () => window.clearTimeout(timer);
  }, [refresh, selectedId, session?.status, session?.messages?.length]);
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/chat/ws`);
    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.type === "session.delta" && (!selectedId || payload.event?.sessionId === selectedId)) void refresh();
      } catch {}
    });
    return () => socket.close();
  }, [refresh, selectedId]);

  const selectSession = (id: string) => {
    setSelectedId(id);
    setRailOpen(false);
    router.replace(`/app/chat/session/${encodeURIComponent(id)}/live`);
  };

  const newConversation = () => {
    setSelectedId("");
    setSession(null);
    setContent("");
    setRailOpen(false);
    router.replace("/app/chat");
  };

  const submit = async () => {
    const message = content.trim();
    if (!message || sending) return;
    setSending(true);
    setError("");
    setContent("");
    try {
      if (!selectedId) {
        const response = await fetch("/api/chat/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: message, title: message.slice(0, 80), createdBy: "web" }),
        });
        const payload = await readJson<{ ok?: boolean; session?: ChatSession; error?: string }>(response, "无法创建对话");
        if (!response.ok || payload.ok === false || !payload.session) throw new Error(payload.error || "无法创建对话");
        setSelectedId(payload.session.id);
        setSession(payload.session);
        router.replace(`/app/chat/session/${encodeURIComponent(payload.session.id)}/live`);
      } else {
        const response = await fetch(`/api/chat/sessions/${encodeURIComponent(selectedId)}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: message }),
        });
        const payload = await readJson<{ ok?: boolean; error?: string }>(response, "消息发送失败");
        if (!response.ok || payload.ok === false) throw new Error(payload.error || "消息发送失败");
      }
      window.setTimeout(() => void refresh(), 250);
    } catch (submitError) {
      setContent(message);
      setError(submitError instanceof Error ? submitError.message : "消息发送失败");
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!selectedId) return;
    await fetch(`/api/chat/sessions/${encodeURIComponent(selectedId)}/stop`, { method: "POST" });
    await refresh();
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
  };

  return <main className="chat-workspace">
    <aside className={`chat-rail ${railOpen ? "is-open" : ""}`} aria-label="对话列表">
      <header><div><span className="toolbar-kicker">CONVERSATIONS</span><strong>{sessions.length} 个本机会话</strong></div><div className="chat-rail-actions"><Button variant="outline" size="icon" type="button" aria-label="新对话" title="新对话" onClick={newConversation}><Plus className="size-4" /></Button><Button className="chat-rail-close" variant="ghost" size="icon" type="button" aria-label="关闭对话列表" title="关闭对话列表" onClick={() => setRailOpen(false)}><X className="size-4" /></Button></div></header>
      <div className="chat-session-list">
        {sessions.map((item) => <button type="button" className={item.id === selectedId ? "is-active" : ""} onClick={() => selectSession(item.id)} key={item.id}><span>{item.title || "未命名对话"}</span><small>{statusLabel(item.status)} · {formatTime(item.updatedAt)}</small></button>)}
        {!loading && !sessions.length ? <div className="chat-list-empty"><MessageCircle className="size-5" /><span>还没有对话</span></div> : null}
      </div>
    </aside>

    <section className="chat-panel" aria-label="当前对话">
      <header className="chat-panel-header">
        <Button className="chat-rail-toggle" variant="ghost" size="icon" type="button" aria-label="打开对话列表" title="对话列表" onClick={() => setRailOpen((current) => !current)}><Menu className="size-5" /></Button>
        <div><span className="toolbar-kicker">CODEX · LOCAL</span><strong>{session?.title || "新对话"}</strong></div>
        <Badge variant={runningStates.has(session?.status || "") ? "warning" : session ? "ready" : "neutral"}>{sending || runningStates.has(session?.status || "") ? <LoaderCircle className="size-3 animate-spin" /> : null}{session ? statusLabel(session.status) : "待输入"}</Badge>
      </header>

      <div className="chat-messages" aria-live="polite">
        {session?.messages?.length ? session.messages.map((message) => <article className={`chat-message role-${message.role}`} key={message.id}><header><span>{messageLabel(message.role)}</span>{message.createdAt ? <time>{formatTime(message.createdAt)}</time> : null}</header><div>{message.content}</div></article>) : <div className="chat-welcome"><span className="radial-mark" aria-hidden="true">✣</span><h1>现在想一起处理什么？</h1><p>消息会交给这台电脑上的 Codex，回复和会话都保存在 Workspace。</p></div>}
        <div ref={messagesEnd} />
      </div>

      {error ? <p className="chat-error" role="alert">{error}</p> : null}
      <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea aria-label="发送给 Codex" placeholder="向 Codex 发送消息" rows={2} value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={onComposerKeyDown} />
        {selectedId && runningStates.has(session?.status || "") ? <Button variant="outline" size="icon" type="button" aria-label="停止回复" title="停止" onClick={() => void stop()}><Square className="size-4" /></Button> : null}
        <Button size="icon" type="submit" aria-label="发送消息" title="发送" disabled={!content.trim() || sending}><Send className="size-4" /></Button>
      </form>
    </section>
  </main>;
}

function statusLabel(status = "") {
  return ({ start: "启动中", running: "回复中", idle: "空闲", paused: "已暂停", done: "已完成", archived: "已归档" } as Record<string, string>)[status] || status || "未知";
}

function messageLabel(role: ChatMessage["role"]) {
  return ({ user: "你", assistant: "Codex", agent: "思考", tool: "工具", system: "系统", error: "错误" } as const)[role];
}

function formatTime(value?: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  if (!text) return { error: fallback } as T;
  try { return JSON.parse(text) as T; } catch { return { error: fallback } as T; }
}
