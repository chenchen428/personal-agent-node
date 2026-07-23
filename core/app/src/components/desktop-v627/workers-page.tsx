"use client";

import { Check, CirclePause, LoaderCircle, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { LoadingState } from "../desktop-v72/loading-state";
import { relativeTime } from "./shared";
import { TaskConversation } from "./task-conversation";
import { TaskModuleViewNavigation } from "./task-module-view-navigation";
import { TaskStatusFilter } from "./task-status-filter";
import { useScheduledTasks } from "./use-scheduled-tasks";
import { isWorkerRunning, useWorkerSessions } from "./use-worker-sessions";
import { matchesWorkerStatus, workerStatusLabel, type WorkerStatusFilter } from "./worker-status";

export function WorkersPage() {
  const searchParams = useSearchParams();
  const {
    sessions, selected, selectedId, select, resume,
    loading, detailLoading, resumeLoading, error,
  } = useWorkerSessions(searchParams.get("task"));
  const schedules = useScheduledTasks();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkerStatusFilter>("all");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = sessions.filter((item) => matchesWorkerStatus(item, statusFilter)
    && (!normalizedQuery || `${item.title} ${item.summary || ""}`.toLowerCase().includes(normalizedQuery)));

  return <main className="v72-page v72-page-flush"><div className="v72-split-view">
    <aside className="v72-split-list" aria-label="任务列表" aria-busy={loading}>
      <header className="v72-split-toolbar"><div className="v72-split-toolbar-title"><h1>任务</h1><TaskModuleViewNavigation active="tasks" scheduledCount={schedules.value ? schedules.tasks.length : undefined} /></div><label className="v72-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务..." aria-label="搜索任务" /></label></header>
      <TaskStatusFilter value={statusFilter} count={filtered.length} onChange={setStatusFilter} />
      {loading && !sessions.length ? <LoadingState label="正在读取任务" compact /> : filtered.map((item) => <button className={`v72-select-row${selectedId === item.id ? " selected" : ""}`} type="button" aria-pressed={selectedId === item.id} onClick={() => void select(item.id)} key={item.id}><span className="v72-row-icon">{isWorkerRunning(item.status) ? <LoaderCircle className="v72-spin" /> : item.status === "paused" ? <CirclePause /> : <Check />}</span><span className="v72-select-body"><span className="v72-select-line"><strong>{item.title || "未命名任务"}</strong><time>{relativeTime(item.updatedAt)}</time></span><p>{workerStatusLabel(item.status)} · {item.channel === "wechat" ? "来自微信对话" : "来自 PA"}</p></span></button>)}
      {!loading && !filtered.length ? <div className="v72-empty">{error || "还没有符合筛选条件的任务"}</div> : null}
    </aside>
    <section className="v72-split-detail" aria-busy={loading || detailLoading}>{loading || detailLoading ? <LoadingState label="正在准备任务详情" /> : selected ? <TaskConversation session={selected} resuming={resumeLoading} onResume={(sessionId) => void resume(sessionId)} /> : <div className="v72-empty">{error || "选择一个任务"}</div>}</section>
  </div></main>;
}
