"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { elapsedSeconds, fetchJson, firstCharacter, formatDateTime, formatDetailedElapsed, formatTaskDuration, isRunning, latestPlan, relativeTaskTime, relativeTime, richText, statusLabel, useClock, useRememberedQuery, useSourcePage } from "./data";
import { BackIcon, InlineError, LoadSentinel, MobileListShell, PhoneStatus, SearchEmpty, SearchStatus } from "./shell";
import type { FilterOption, Message, MobileTaskResult, PlanStep, Session } from "./types";

export function MobileWorkers({ sessionId = "", conversations = false }: { sessionId?: string; conversations?: boolean }) {
  const from = useSourcePage("workers");
  const [query, setQuery] = useRememberedQuery("workers");
  const [filter, setFilter] = useState("all");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [taskCounts, setTaskCounts] = useState({ all: 0, running: 0, completed: 0 });
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (sessionId) {
        setSession((await fetchJson<{ session: Session }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`)).session);
      } else if (conversations) {
        const result = await fetchJson<{ sessions: Session[] }>(`/api/chat/sessions?limit=50${query ? `&query=${encodeURIComponent(query)}` : ""}`);
        setSessions((result.sessions || []).filter((item) => item.role !== "worker"));
      } else {
        const result = await fetchJson<MobileTaskResult>(`/api/mobile/tasks?limit=200&query=${encodeURIComponent(query)}&status=${encodeURIComponent(filter)}`);
        setSessions(result.items || []);
        setTaskCounts(result.counts);
      }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取本机内容");
    } finally {
      setLoading(false);
    }
  }, [conversations, filter, query, sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);
  useEffect(() => {
    if (!session || !isRunning(session.status)) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, session]);

  if (sessionId) return <TaskDetail session={session} loading={loading} error={error} returnHref={from === "activity" ? "/app/mobile" : "/app/mobile/workers"} returnLabel={from === "activity" ? "最近动态" : "任务"} />;
  if (conversations) return <TaskDetail session={sessions[0] || null} loading={loading} error={error} returnHref="/app/mobile" returnLabel="最近动态" />;

  const options: FilterOption[] = [
    { value: "all", label: "全部", count: taskCounts.all },
    { value: "running", label: "进行中", count: taskCounts.running },
    { value: "completed", label: "已完成", count: taskCounts.completed },
  ];
  return <MobileListShell section="workers" title="任务" note={filter === "all" ? `${taskCounts.running} 项任务进行中` : `${sessions.length} 项${filter === "running" ? "进行中" : "已完成"}`} query={query} setQuery={setQuery} searchLabel="搜索任务" searchPlaceholder="搜索任务" filter={{ label: "筛选任务状态", description: "选择要查看的任务状态", value: filter, setValue: setFilter, options }}>
    <div className="mobile-list-start task-list-page">
      {error ? <InlineError message={error} /> : null}
      {query && sessions.length ? <SearchStatus query={query} count={sessions.length} /> : null}
      {!loading && !sessions.length ? <SearchEmpty title={query ? "没有找到相关任务" : "还没有任务"} hint={query ? "试试任务名称或来源" : "PA 开始工作后会显示在这里"} /> : null}
      <div className="task-stream">{sessions.map((item) => <TaskRow session={item} key={item.id} />)}</div>
      {loading ? <LoadSentinel loading canLoad={false} exhausted={false} onLoad={() => undefined} /> : null}
    </div>
  </MobileListShell>;
}

function TaskRow({ session }: { session: Session }) {
  const running = isRunning(session.status);
  const seconds = elapsedSeconds(session, running);
  return <Link className={`task-row${running ? " running" : ""}`} href={`/app/mobile/workers/${encodeURIComponent(session.id)}`}>
    <div className="task-row-copy"><strong>{session.title || "未命名任务"}</strong><small><span className="task-row-origin"><b>{statusLabel(session.status)}</b><time dateTime={session.updatedAt} title={formatDateTime(session.updatedAt)}>{relativeTime(session.updatedAt)}</time><span>· {session.channel === "wechat" ? "微信" : "PA"}</span></span><em>{formatTaskDuration(seconds, running)}</em></small></div>
    <i className="task-row-chevron">›</i>
  </Link>;
}

function TaskDetail({ session, loading, error, returnHref, returnLabel }: { session: Session | null; loading: boolean; error: string; returnHref: string; returnLabel: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserScroll = useRef(0);
  const previousCount = useRef(0);
  const [newUpdate, setNewUpdate] = useState(false);
  const now = useClock(1000);
  const count = session?.messages?.length || 0;
  const scrollLatest = useCallback((smooth = true) => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setNewUpdate(false);
  }, []);

  useEffect(() => {
    if (!session) return;
    if (!previousCount.current) window.requestAnimationFrame(() => scrollLatest(false));
    else if (count > previousCount.current) {
      if (Date.now() - lastUserScroll.current >= 3000) scrollLatest();
      else {
        setNewUpdate(true);
        const timer = window.setTimeout(() => scrollLatest(), Math.max(0, 3000 - (Date.now() - lastUserScroll.current)));
        return () => window.clearTimeout(timer);
      }
    }
    previousCount.current = count;
  }, [count, scrollLatest, session]);

  const plan = session ? latestPlan(session) : [];
  const messages = (session?.messages || []).filter((message) => ["user", "assistant", "agent", "error"].includes(message.role) && message.content?.trim());
  return <div className="mobile-current"><div className="mobile-stage"><div className="phone content-detail-phone task-conversation-phone">
    <PhoneStatus />
    <main className="content-detail-screen">
      <div className="task-conversation-bar"><Link href={returnHref} aria-label={`返回${returnLabel}`}><BackIcon /></Link><strong>{session?.title || "任务详情"}</strong><span>{session ? statusLabel(session.status) : ""}</span></div>
      <div className="content-detail-scroll" ref={scrollRef} onWheel={() => { lastUserScroll.current = Date.now(); }} onTouchMove={() => { lastUserScroll.current = Date.now(); }} onPointerDown={() => { lastUserScroll.current = Date.now(); }}>
        {error ? <InlineError message={error} /> : null}
        {session ? <section className="task-live-view">
          <div className="task-dialogue" aria-live="polite">{messages.map((message) => <TaskMessage message={message} userName={session.senderName || "你"} key={message.id} />)}{plan.length ? <TaskPlan steps={plan} updatedAt={session.updatedAt} /> : null}</div>
          {newUpdate ? <button className="task-new-update" type="button" onClick={() => scrollLatest()}>有新进展 <span aria-hidden="true">↓</span></button> : null}
          {isRunning(session.status) ? <div className="task-live-waiting"><i aria-hidden="true" /><span>进行中 · 已运行 <b>{formatDetailedElapsed(Math.max(0, Math.floor((now - new Date(session.createdAt || session.updatedAt || now).getTime()) / 1000)))}</b></span></div> : null}
        </section> : loading ? <LoadSentinel loading canLoad={false} exhausted={false} onLoad={() => undefined} /> : <SearchEmpty title="任务不存在" hint="这条任务可能已经归档" />}
      </div>
    </main>
  </div></div></div>;
}

function TaskMessage({ message, userName }: { message: Message; userName: string }) {
  const user = message.role === "user";
  const content = <div className="task-message-content"><div className="task-message-body">{richText(message.content)}</div><time className="task-message-time" dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{relativeTaskTime(message.createdAt)}</time></div>;
  return <article className={`task-dialogue-message ${user ? "user" : "agent"}`}>
    {user ? <>{content}<span className="task-avatar task-avatar-user" aria-label={userName}>{firstCharacter(userName)}</span></> : <><span className="task-avatar task-avatar-agent" aria-label="PA">PA</span>{content}</>}
  </article>;
}

function TaskPlan({ steps, updatedAt }: { steps: PlanStep[]; updatedAt?: string }) {
  const completed = steps.filter((step) => step.status === "completed").length;
  return <section className="task-plan" aria-label="本轮计划"><header><strong>本轮计划</strong><span>{completed} / {steps.length}</span></header><ol>{steps.map((step, index) => <li data-plan-status={step.status} key={`${index}-${step.step}`}><i aria-hidden="true">{step.status === "completed" ? "✓" : ""}</i><span>{step.step}</span></li>)}</ol><time className="task-plan-time" dateTime={updatedAt} title={formatDateTime(updatedAt)}>{relativeTaskTime(updatedAt)}</time></section>;
}
