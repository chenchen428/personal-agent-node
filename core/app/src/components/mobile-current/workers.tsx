"use client";

import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { elapsedSeconds, fetchJson, formatDateTime, formatTaskDuration, isRunning, relativeTime, statusLabel, useRememberedQuery, useSourcePage } from "./data";
import { MobileTaskDetail } from "./mobile-task-detail";
import { InlineError, LoadSentinel, MobileListShell, SearchStatus } from "./shell";
import { MobileContentSkeleton } from "./skeletons";
import type { FilterOption, MobileTaskResult, Session } from "./types";

export function MobileWorkers({ sessionId = "" }: { sessionId?: string }) {
  const from = useSourcePage("workers");
  const [query, setQuery] = useRememberedQuery("workers");
  const [filter, setFilter] = useState("all");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [taskCounts, setTaskCounts] = useState({ all: 0, running: 0, completed: 0, interrupted: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (background = false) => {
    if (sessionId) return;
    if (!background) setLoading(true);
    try {
      const result = await fetchJson<MobileTaskResult>(`/api/mobile/tasks?limit=200&query=${encodeURIComponent(query)}&status=${encodeURIComponent(filter)}`);
      setSessions(result.items || []);
      setTaskCounts(result.counts);
      setError("");
    } catch (cause) {
      if (!background) setError(cause instanceof Error ? cause.message : "暂时无法读取本机内容");
    } finally {
      if (!background) setLoading(false);
    }
  }, [filter, query, sessionId]);

  useEffect(() => {
    if (sessionId) return;
    const timer = window.setTimeout(() => void load(), query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query, sessionId]);

  const hasRunningTask = !sessionId && sessions.some((item) => isRunning(item.status));
  useEffect(() => {
    if (!hasRunningTask) return;
    const timer = window.setInterval(() => void load(true), 2_500);
    return () => window.clearInterval(timer);
  }, [hasRunningTask, load]);

  if (sessionId) {
    return <MobileTaskDetail
      taskId={sessionId}
      returnHref={from === "activity" ? "/app/mobile" : "/app/mobile/workers"}
      returnLabel={from === "activity" ? "最近动态" : "任务"}
    />;
  }

  const options: FilterOption[] = [
    { value: "all", label: "全部", count: taskCounts.all },
    { value: "running", label: "进行中", count: taskCounts.running },
    { value: "completed", label: "已完成", count: taskCounts.completed },
    { value: "interrupted", label: "已中断", count: taskCounts.interrupted },
  ];
  const selectedFilter = options.find((option) => option.value === filter) || options[0];
  const hasConditions = Boolean(query) || filter !== "all";
  const conditionSummary = [query ? `“${query}”` : "", filter !== "all" ? selectedFilter.label : ""].filter(Boolean).join(" · ");
  const initialLoading = loading && !sessions.length;
  return <MobileListShell
    section="workers"
    title="任务"
    note={filter === "all" ? `${taskCounts.running} 项任务进行中` : `${selectedFilter.count} 项${selectedFilter.label}`}
    query={query}
    setQuery={setQuery}
    searchLabel="搜索任务"
    searchPlaceholder="搜索任务…"
    filter={{ label: "筛选任务状态", description: "选择要查看的任务状态", value: filter, setValue: setFilter, options }}
  >
    <div className="mobile-task-list">
      {error ? <InlineError message={error} /> : null}
      {hasConditions ? <SearchStatus count={sessions.length} summary={conditionSummary} onClear={() => { setQuery(""); setFilter("all"); }} /> : null}
      {!loading && !sessions.length ? <TaskEmpty hasConditions={hasConditions} /> : null}
      {initialLoading ? <MobileContentSkeleton kind="tasks" /> : <div className="mobile-task-items">{sessions.map((item) => <TaskRow session={item} key={item.id} />)}</div>}
      {loading && !initialLoading ? <LoadSentinel loading canLoad={false} exhausted={false} onLoad={() => undefined} /> : null}
    </div>
  </MobileListShell>;
}

function TaskRow({ session }: { session: Session }) {
  const running = isRunning(session.status);
  const seconds = elapsedSeconds(session, running);
  return <Link href={`/app/mobile/workers/${encodeURIComponent(session.id)}`}>
    <span className="mobile-task-icon"><Bot aria-hidden="true" /></span>
    <span className="mobile-task-copy"><span><strong>{session.title || "未命名任务"}</strong><i className={`mobile-task-badge status-${taskStatusTone(session.status)}`}>{taskStatusLabel(session.status)}</i></span><p>{session.summary || session.taskDescription || "PA 正在整理这项任务的最新进展"}</p><small>{taskContext(session)} · {formatTaskDuration(seconds, running)}</small></span>
    <span className="mobile-task-trailing"><time dateTime={session.updatedAt} title={formatDateTime(session.updatedAt)}>{relativeTime(session.updatedAt)}</time><ChevronRight aria-hidden="true" /></span>
  </Link>;
}

function TaskEmpty({ hasConditions }: { hasConditions: boolean }) {
  return <div className="mobile-task-empty"><Bot aria-hidden="true" /><strong>{hasConditions ? "没有找到任务" : "还没有任务"}</strong><span>{hasConditions ? "调整搜索词或状态后再试。" : "PA 开始工作后会显示在这里。"}</span></div>;
}

function taskStatusLabel(status: string) { return status === "idle" ? "已完成" : statusLabel(status); }
function taskStatusTone(status: string) { return isRunning(status) ? "running" : ["failed", "error", "interrupted"].includes(status) ? "interrupted" : "completed"; }
function taskContext(session: Session) { return session.channel === "wechat" ? "来自微信主会话" : session.channel === "mail" ? "来自邮箱" : "来自 PA"; }
