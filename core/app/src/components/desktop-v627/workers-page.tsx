"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "./types";
import { Empty, Filters, Heading, fetchJson, formatTime, relativeTime, statusLabel } from "./shared";

export function WorkersPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("全部");
  const load = useCallback(async () => {
    const list = await fetchJson<{ sessions: Session[] }>("/api/chat/sessions?limit=50");
    const workers = (list.sessions || []).filter((item) => item.role === "worker");
    setSessions(workers);
    const target = workers.find((item) => item.id === selected?.id) || workers[0];
    setSelected(target ? (await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(target.id)}`)).session : null);
  }, [selected?.id]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  const filtered = sessions.filter((item) => {
    const running = ["start", "running"].includes(item.status);
    return (status === "全部" || (status === "进行中" ? running : !running))
      && (!query || `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase()));
  });
  return <main><Heading eyebrow="任务" title="PA 正在处理的任务" copy="查看任务中的对话和已经完成的结果。" />
    <div className="pa-toolbar"><Filters labels={[`全部 ${sessions.length}`, `进行中 ${sessions.filter((item) => ["start", "running"].includes(item.status)).length}`, `已完成 ${sessions.filter((item) => !["start", "running"].includes(item.status)).length}`]} selected={status} onSelect={setStatus} /><input className="pa-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索任务" /></div>
    <div className="pa-split"><aside className="pa-list">{filtered.map((item) => <button className={`pa-list-item${selected?.id === item.id ? " selected" : ""}`} onClick={async () => setSelected((await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(item.id)}`)).session)} key={item.id}><span className="pa-avatar">{["start", "running"].includes(item.status) ? "↻" : "✓"}</span><span><strong>{item.title || "未命名任务"}</strong><small>{statusLabel(item.status)} · {item.channel === "wechat" ? "来自微信对话" : "来自 PA"}</small></span><time>{relativeTime(item.updatedAt)}</time></button>)}</aside><article className="pa-detail">{selected ? <><span className="pa-eyebrow">任务 · {statusLabel(selected.status)}</span><h2>{selected.title}</h2><p>{selected.summary || selected.taskDescription || "任务进展保存在本机工作区。"}</p>{(selected.messages || []).filter((item) => ["user", "assistant", "agent"].includes(item.role)).map((item) => <div className={`pa-message${item.role === "user" ? " user" : ""}`} key={item.id}><small>{item.role === "user" ? "你" : "PA"} · {formatTime(item.createdAt)}</small>{item.content}</div>)}</> : <Empty text="还没有任务" />}</article></div>
  </main>;
}
