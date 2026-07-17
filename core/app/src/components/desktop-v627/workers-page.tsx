"use client";

import { useState } from "react";
import { Check, Circle, LoaderCircle, Search } from "lucide-react";
import type { Session } from "./types";
import { MarkdownContent } from "./markdown-content";
import { formatTime, relativeTime, statusLabel } from "./shared";
import { isWorkerRunning, useWorkerSessions } from "./use-worker-sessions";
import { TaskLifecycleStatus } from "./task-lifecycle-status";
import { LoadingState } from "../desktop-v72/loading-state";

export function WorkersPage() {
  const { sessions, selected, select, loading, detailLoading, error } = useWorkerSessions();
  const [query, setQuery] = useState("");
  const filtered = sessions.filter((item) => !query || `${item.title} ${item.summary || ""}`.toLowerCase().includes(query.toLowerCase()));

  return <main className="v72-page v72-page-flush"><div className="v72-split-view">
    <aside className="v72-split-list" aria-label="任务列表" aria-busy={loading}>
      <header className="v72-split-toolbar"><h1>任务</h1><label className="v72-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务..." aria-label="搜索任务" /></label></header>
      <div className="v72-list-label">全部 · {filtered.length}</div>
      {loading && !sessions.length ? <LoadingState label="正在读取任务" compact /> : filtered.map((item) => <button className={`v72-select-row${selected?.id === item.id ? " selected" : ""}`} type="button" onClick={() => void select(item.id)} key={item.id}><span className="v72-row-icon">{isWorkerRunning(item.status) ? <LoaderCircle className="v72-spin" /> : <Check />}</span><span className="v72-select-body"><span className="v72-select-line"><strong>{item.title || "未命名任务"}</strong><time>{relativeTime(item.updatedAt)}</time></span><p>{workerStatusLabel(item.status)} · {item.channel === "wechat" ? "来自微信对话" : "来自 PA"}</p></span></button>)}
      {!loading && !filtered.length ? <div className="v72-empty">{error || "还没有任务"}</div> : null}
    </aside>
    <section className="v72-split-detail" aria-busy={loading || detailLoading}>{loading || detailLoading ? <LoadingState label="正在准备任务详情" /> : selected ? <TaskConversation session={selected} /> : <div className="v72-empty">{error || "选择一个任务"}</div>}</section>
  </div></main>;
}

function TaskConversation({ session }: { session: Session }) {
  const messages = (session.messages || []).filter((item) => ["user", "assistant", "agent"].includes(item.role));
  const plan = session.currentPlan?.steps || [];

  return <div className="v72-task-conversation">
    <header className="v72-task-head"><div><span>任务 · {workerStatusLabel(session.status)}</span><h1>{session.title || "未命名任务"}</h1><p>{session.summary || session.taskDescription || "任务进展保存在本机工作区。"}</p></div><span className={`v72-badge ${isWorkerRunning(session.status) ? "warning" : "success"}`}>{workerStatusLabel(session.status)}</span></header>
    <div className="v72-task-scroll"><div className="v72-task-thread">
      {messages.map((message, index) => <div key={message.id}><article className={`v72-task-message${message.role === "user" ? " user" : ""}`}><span className={`v72-task-avatar${message.role === "user" ? " user" : ""}`}>{message.role === "user" ? "你" : "PA"}</span><div><MarkdownContent className="v72-task-body" content={message.content} /><time>{formatTime(message.createdAt)}</time></div></article>{index === 0 && plan.length ? <TaskPlan session={session} /> : null}</div>)}
      {!messages.length ? <div className="v72-empty">任务暂无对话记录</div> : null}
      {plan.length && !messages.length ? <TaskPlan session={session} /> : null}
      <TaskLifecycleStatus session={session} />
    </div></div>
  </div>;
}

function TaskPlan({ session }: { session: Session }) {
  const steps = session.currentPlan?.steps || [];
  return <section className="v72-task-plan"><header><strong>{session.currentPlan?.title || "执行计划"}</strong><span>{steps.filter((item) => item.status === "completed").length}/{steps.length}</span></header><ol>{steps.map((item, index) => <li data-status={item.status} key={`${index}-${item.step}`}>{item.status === "completed" ? <Check /> : item.status === "in_progress" ? <LoaderCircle className="v72-spin" /> : <Circle />}<span>{item.step}</span></li>)}</ol></section>;
}

function workerStatusLabel(status: string) { return status === "idle" ? "已完成" : statusLabel(status); }
