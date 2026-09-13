"use client";

import { Check, CirclePause, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { LoadingState } from "../desktop-v72/loading-state";
import { relativeTime } from "./shared";
import { TaskConversation } from "./task-conversation";
import { CalendarModuleHeader } from "../calendar/module-header";
import { PageSurface, SearchField } from "../desktop-v72/primitives";
import { TaskStatusFilter } from "./task-status-filter";
import { isWorkerRunning, useWorkerSessions } from "./use-worker-sessions";
import { matchesWorkerStatus, workerStatusLabel, type WorkerStatusFilter } from "./worker-status";

export function WorkersPage() {
  const searchParams = useSearchParams();
  const {
    sessions, selected, selectedId, select, resume, refresh,
    loading, detailLoading, resumeLoading, error,
  } = useWorkerSessions(searchParams.get("task"));
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkerStatusFilter>("all");
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = sessions.filter((item) => matchesWorkerStatus(item, statusFilter)
    && (!normalizedQuery || `${item.title} ${item.summary || ""}`.toLowerCase().includes(normalizedQuery)));

  return <PageSurface className="calendar-module-page calendar-executions"><CalendarModuleHeader active="tasks" onRefresh={refresh} />
    <div className="calendar-execution-toolbar"><TaskStatusFilter value={statusFilter} count={filtered.length} onChange={setStatusFilter} /><SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索执行记录…" aria-label="搜索执行记录" /></div>
    <div className="calendar-module-layout v72-split-view">
    <aside className="v72-split-list" aria-label="执行记录列表" aria-busy={loading}>
      <div className="cove-calendar-caption"><span>{filtered.length} 条执行记录</span><span>最近更新</span></div>

      {loading && !sessions.length ? <LoadingState label="正在读取任务" compact /> : filtered.map((item) => <button className={`v72-select-row${selectedId === item.id ? " selected" : ""}`} type="button" aria-pressed={selectedId === item.id} onClick={() => void select(item.id)} key={item.id}><span className="v72-row-icon">{isWorkerRunning(item.status) ? <LoaderCircle className="v72-spin" /> : item.status === "paused" ? <CirclePause /> : <Check />}</span><span className="v72-select-body"><span className="v72-select-line"><strong>{item.title || "未命名任务"}</strong><time>{relativeTime(item.updatedAt)}</time></span><p>{workerStatusLabel(item.status)} · {item.channel === "wechat" ? "来自微信对话" : "来自 Cove"}</p></span></button>)}
      {!loading && !filtered.length ? <div className="v72-empty">{error || "还没有符合筛选条件的执行记录"}</div> : null}
    </aside>
    <section className="v72-split-detail" aria-busy={loading || detailLoading}>{loading || detailLoading ? <LoadingState label="正在准备任务详情" /> : selected ? <TaskConversation session={selected} resuming={resumeLoading} onResume={(sessionId) => void resume(sessionId)} /> : <div className="v72-empty">{error || "选择一条执行记录"}</div>}</section>
  </div></PageSurface>;
}
