"use client";

import Link from "next/link";
import { AlertCircle, Bot, ChevronRight, Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { elapsedSeconds, fetchJson, firstCharacter, formatDateTime, formatDetailedElapsed, formatTaskDuration, isRunning, latestPlan, relativeTaskTime, relativeTime, richText, statusLabel, useClock, useRememberedQuery, useSourcePage } from "./data";
import { BackIcon, InlineError, LoadSentinel, MobileListShell, SearchStatus } from "./shell";
import { MobileContentSkeleton } from "./skeletons";
import type { ChatAttachment, FilterOption, Message, MobileTaskResult, PlanStep, Session } from "./types";

export function MobileWorkers({ sessionId = "", conversations = false }: { sessionId?: string; conversations?: boolean }) {
  const from = useSourcePage("workers");
  const [query, setQuery] = useRememberedQuery("workers");
  const [filter, setFilter] = useState("all");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [taskCounts, setTaskCounts] = useState({ all: 0, running: 0, completed: 0, interrupted: 0 });
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      if (sessionId) {
        setSession((await fetchJson<{ session: Session }>(`/api/mobile/tasks/${encodeURIComponent(sessionId)}?messageLimit=80`)).session);
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
      if (!background) setError(cause instanceof Error ? cause.message : "暂时无法读取本机内容");
    } finally {
      if (!background) setLoading(false);
    }
  }, [conversations, filter, query, sessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);
  useEffect(() => {
    if (!session || !isRunning(session.status)) return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [load, session]);
  const hasRunningTask = !sessionId && !conversations && sessions.some((item) => isRunning(item.status));
  useEffect(() => {
    if (!hasRunningTask) return;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [hasRunningTask, load]);

  if (sessionId) return <TaskDetail session={session} loading={loading} error={error} returnHref={from === "activity" ? "/app/mobile" : "/app/mobile/workers"} returnLabel={from === "activity" ? "最近动态" : "任务"} />;
  if (conversations) return <TaskDetail session={sessions[0] || null} loading={loading} error={error} returnHref="/app/mobile" returnLabel="最近动态" />;

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
  return <MobileListShell section="workers" title="任务" note={filter === "all" ? `${taskCounts.running} 项任务进行中` : `${selectedFilter.count} 项${selectedFilter.label}`} query={query} setQuery={setQuery} searchLabel="搜索任务" searchPlaceholder="搜索任务…" filter={{ label: "筛选任务状态", description: "选择要查看的任务状态", value: filter, setValue: setFilter, options }}>
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
  const status = taskStatusLabel(session.status);
  return <Link href={`/app/mobile/workers/${encodeURIComponent(session.id)}`}>
    <span className="mobile-task-icon"><Bot aria-hidden="true" /></span>
    <span className="mobile-task-copy"><span><strong>{session.title || "未命名任务"}</strong><i className={`mobile-task-badge status-${taskStatusTone(session.status)}`}>{status}</i></span><p>{session.summary || session.taskDescription || "PA 正在整理这项任务的最新进展"}</p><small>{taskContext(session)} · {formatTaskDuration(seconds, running)}</small></span>
    <span className="mobile-task-trailing"><time dateTime={session.updatedAt} title={formatDateTime(session.updatedAt)}>{relativeTime(session.updatedAt)}</time><ChevronRight aria-hidden="true" /></span>
  </Link>;
}

function TaskEmpty({ hasConditions }: { hasConditions: boolean }) {
  return <div className="mobile-task-empty"><Bot aria-hidden="true" /><strong>{hasConditions ? "没有找到任务" : "还没有任务"}</strong><span>{hasConditions ? "调整搜索词或状态后再试。" : "PA 开始工作后会显示在这里。"}</span></div>;
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
  const messages = (session?.messages || []).filter((message) => ["user", "assistant", "agent", "error"].includes(message.role) && (message.content?.trim() || message.metadata?.attachments?.length));
  const running = session ? isRunning(session.status) : false;
  return <div className="mobile-current"><div className="mobile-stage"><div className="phone content-detail-phone task-conversation-phone">
    <main className="content-detail-screen">
      <div className="task-conversation-bar"><Link href={returnHref} aria-label={`返回${returnLabel}`}><BackIcon /></Link><strong>{session?.title || "任务详情"}</strong><span>{session ? taskStatusLabel(session.status) : ""}</span></div>
      <div className="content-detail-scroll" ref={scrollRef} onWheel={() => { lastUserScroll.current = Date.now(); }} onTouchMove={() => { lastUserScroll.current = Date.now(); }} onPointerDown={() => { lastUserScroll.current = Date.now(); }}>
        {error ? <TaskUnavailable error /> : session && (messages.length || plan.length) ? <section className="mobile-task-conversation">
          <div className="mobile-task-thread" aria-live="polite">{messages.map((message, index) => <div key={message.id}><TaskMessage message={message} userName={session.senderName || "你"} />{index === 1 && plan.length ? <TaskPlan steps={plan} /> : null}</div>)}{plan.length && messages.length < 2 ? <TaskPlan steps={plan} /> : null}
          {newUpdate ? <button className="task-new-update" type="button" onClick={() => scrollLatest()}>有新进展 <span aria-hidden="true">↓</span></button> : null}
          <div className={`mobile-task-runtime${running ? " processing" : ""}`} role={running ? "status" : undefined}>{running ? <><i aria-hidden="true" /><strong>正在处理</strong><span>· {taskRuntimeLabel(session, now)}</span></> : <span>{taskRuntimeLabel(session, now)}</span>}</div></div>
        </section> : loading ? <TaskLoading /> : <TaskUnavailable />}
      </div>
    </main>
  </div></div></div>;
}

function taskStatusLabel(status: string) { return status === "idle" ? "已完成" : statusLabel(status); }

function taskStatusTone(status: string) { return isRunning(status) ? "running" : ["failed", "error", "interrupted"].includes(status) ? "interrupted" : "completed"; }
function taskContext(session: Session) { return session.channel === "wechat" ? "来自微信主会话" : session.channel === "mail" ? "来自邮箱" : "来自 PA"; }
function taskRuntimeLabel(session: Session, now: number) {
  const running = isRunning(session.status);
  const seconds = running ? Math.max(0, Math.floor((now - new Date(session.createdAt || session.updatedAt || now).getTime()) / 1000)) : elapsedSeconds(session, false);
  if (running && session.metadata?.workerRecoveryAttempt) return `重启后已继续处理 · ${formatDetailedElapsed(seconds)}`;
  return formatTaskDuration(seconds, running);
}

function TaskMessage({ message, userName }: { message: Message; userName: string }) {
  const user = message.role === "user";
  const content = <div>{message.content?.trim() ? <div className="mobile-task-message-body">{richText(message.content)}</div> : null}<TaskMessageAttachments attachments={message.metadata?.attachments || []} /><time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{relativeTaskTime(message.createdAt)}</time></div>;
  return <article className={`mobile-task-message ${user ? "user" : "agent"}`}>
    {user ? <><span className="mobile-task-avatar user" aria-label={userName}>{firstCharacter(userName)}</span>{content}</> : <><span className="mobile-task-avatar agent" aria-label="PA">PA</span>{content}</>}
  </article>;
}

function TaskMessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (!attachments.length) return null;
  return <div className="mobile-task-message-attachments">{attachments.map((attachment) => attachment.kind === "image" && attachment.previewUrl
    ? <a href={attachment.previewUrl} target="_blank" rel="noreferrer" key={attachment.objectId || attachment.name}><img src={attachment.previewUrl} alt={attachment.alt || attachment.name} width={attachment.width} height={attachment.height} /><span><strong>{attachment.caption || attachment.name}</strong><small>{attachment.width && attachment.height ? `${attachment.width} × ${attachment.height} · ` : ""}{mobileAttachmentDeliveryLabel(attachment.deliveryState)}</small></span></a>
    : (attachment.downloadUrl || attachment.previewUrl) ? <a className="mobile-task-file" href={attachment.downloadUrl || attachment.previewUrl} key={attachment.objectId || attachment.name}><i aria-hidden="true">{mobileFileType(attachment.name)}</i><span><strong>{attachment.caption || attachment.name}</strong><small>{formatMobileAttachmentBytes(attachment.sizeBytes)} · {mobileAttachmentDeliveryLabel(attachment.deliveryState)}</small></span><em>下载</em></a> : null)}</div>;
}

function mobileAttachmentDeliveryLabel(state?: ChatAttachment["deliveryState"]) {
  return state === "failed" ? "发送失败" : state === "sending" ? "发送中" : state === "sent" ? "已发送" : "待发送";
}

function mobileFileType(name: string) { return name.split(".").pop()?.slice(0, 5).toUpperCase() || "FILE"; }
function formatMobileAttachmentBytes(value = 0) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 ** 2).toFixed(1)} MB`; }

function TaskPlan({ steps }: { steps: PlanStep[] }) {
  const completed = steps.filter((step) => step.status === "completed").length;
  return <section className="mobile-task-plan" aria-label="本轮计划"><header><strong>本轮计划</strong><span>{completed} / {steps.length}</span></header><ol>{steps.map((step, index) => <li data-status={step.status} key={`${index}-${step.step}`}><i aria-hidden="true">{step.status === "completed" ? "✓" : ""}</i><span>{step.step}</span></li>)}</ol></section>;
}

function TaskLoading() { return <div className="mobile-task-state loading" role="status" aria-label="正在加载任务详情">
  <div className="mobile-task-loading-thread" aria-hidden="true">
    <div className="mobile-task-loading-message user"><div className="mobile-task-skeleton bubble"><i /><i /></div><div className="mobile-task-skeleton avatar" /></div>
    <div className="mobile-task-loading-message agent"><div className="mobile-task-skeleton avatar" /><div className="mobile-task-loading-copy"><i /><i /><i /></div></div>
    <div className="mobile-task-skeleton plan"><div className="mobile-task-loading-plan-header"><i /><i /></div><div className="mobile-task-loading-step"><b /><i /></div><div className="mobile-task-loading-step"><b /><i /></div><div className="mobile-task-loading-step"><b /><i /></div></div>
  </div>
  <div className="mobile-task-loading-label"><i aria-hidden="true" /><span>正在读取任务进展</span></div>
</div>; }

function TaskUnavailable({ error = false }: { error?: boolean }) { const Icon = error ? AlertCircle : Inbox; return <div className={`mobile-task-state ${error ? "error" : "empty"}`} role="status"><Icon aria-hidden="true" /><strong>{error ? "暂时无法读取任务" : "还没有可展示的进展"}</strong><p>{error ? "连接恢复后重新打开本页即可继续查看。" : "任务产生可见回复后，会按时间顺序显示在这里。"}</p></div>; }
