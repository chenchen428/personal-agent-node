"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, CircleAlert, PauseCircle, Search } from "lucide-react";
import { LoadingState } from "../desktop-v72/loading-state";
import { ScheduledTaskDetail } from "./scheduled-task-detail";
import { absoluteDateTime, describeCron, formatScheduleDateTime } from "./scheduled-task-formatters";
import { TaskModuleViewNavigation } from "./task-module-view-navigation";
import { useScheduledTasks } from "./use-scheduled-tasks";

export function ScheduledTasksPage() {
  const { value, tasks, loading, error, refresh } = useScheduledTasks();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tasks.filter((task) => !keyword || `${task.name} ${task.prompt} ${task.cron} ${describeCron(task.cron)}`.toLowerCase().includes(keyword));
  }, [query, tasks]);
  const selected = filtered.find((task) => task.id === selectedId) || filtered[0];
  const initialLoading = loading && !value;

  return <main className="v72-page v72-page-flush v72-schedule-page"><div className="v72-split-view">
    <aside className="v72-split-list" aria-label="自动化列表" aria-busy={loading}>
      <header className="v72-split-toolbar">
        <div className="v72-split-toolbar-title"><h1>任务</h1><TaskModuleViewNavigation active="schedules" scheduledCount={value ? tasks.length : undefined} /></div>
        <label className="v72-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索自动化..." aria-label="搜索自动化" /></label>
      </header>
      <div className="v72-list-label">{query ? "搜索结果" : "自动化"} · {filtered.length}</div>
      {initialLoading ? <LoadingState label="正在读取自动化" compact /> : filtered.map((task) => {
        const absoluteNextRun = absoluteDateTime(task.nextRunAt);
        const nextRun = task.enabled ? formatScheduleDateTime(task.nextRunAt, task.timezone, true) : "已暂停";
        return <button className={`v72-select-row schedule-select-row${selected?.id === task.id ? " selected" : ""}`} type="button" onClick={() => setSelectedId(task.id)} key={task.id}>
          <span className="v72-row-icon">{task.enabled ? <CalendarClock /> : <PauseCircle />}</span>
          <span className="v72-select-body"><span className="v72-select-line"><strong>{task.name}</strong>{absoluteNextRun && task.enabled ? <time dateTime={absoluteNextRun} title={absoluteNextRun}>{nextRun}</time> : <time>{nextRun}</time>}</span><p>{task.enabled ? "运行中" : "已暂停"} · {describeCron(task.cron)}</p></span>
        </button>;
      })}
      {!initialLoading && !filtered.length ? <div className="schedule-list-empty">{error && !value ? "读取失败" : query ? "没有匹配结果" : "暂无计划"}</div> : null}
    </aside>
    <section className="v72-split-detail" aria-busy={initialLoading}>
      {initialLoading ? <LoadingState label="正在准备自动化详情" /> : error && !value ? <ScheduleFeedback kind="error" onRetry={() => void refresh()} /> : selected ? <ScheduledTaskDetail task={selected} /> : <ScheduleFeedback kind={query ? "search" : "empty"} />}
    </section>
  </div></main>;
}

function ScheduleFeedback({ kind, onRetry }: { kind: "error" | "search" | "empty"; onRetry?: () => void }) {
  const error = kind === "error";
  return <div className="schedule-feedback">
    {error ? <CircleAlert aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
    <strong>{error ? "暂时无法读取自动化" : kind === "search" ? "没有匹配的自动化" : "还没有自动化"}</strong>
    <p>{error ? "检查本机 Agent 运行状态后再试一次。" : kind === "search" ? "换一个名称、时间或任务内容试试。" : "在主对话中告诉 Agent 要做什么、何时执行。"}</p>
    {error ? <button className="button" type="button" onClick={onRetry}>重新读取</button> : kind === "empty" ? <Link className="button" href="/app/conversations">前往主对话</Link> : null}
  </div>;
}
