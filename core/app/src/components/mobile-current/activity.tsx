"use client";

import Link from "next/link";
import { Activity, ChevronDown, Database, FileText, ListTodo, Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { activityKind, fetchJson, formatDateTime, relativeTime, useRememberedQuery } from "./data";
import { InlineError, LoadSentinel, MobileListShell, SearchEmpty, SearchStatus } from "./shell";
import { MobileContentSkeleton } from "./skeletons";
import type { ActivityAttachment, ActivityItem, MobileTaskResult, Session } from "./types";

export function MobileActivity() {
  const [query, setQuery] = useRememberedQuery("activity");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadedMore, setLoadedMore] = useState(false);
  const [runningTasks, setRunningTasks] = useState<Session[]>([]);
  const [tasksExpanded, setTasksExpanded] = useState(false);

  const load = useCallback(async (append = false) => {
    setLoading(true);
    try {
      const result = await fetchJson<{ items: ActivityItem[]; nextCursor: string }>(`/api/mobile/activity?limit=20&query=${encodeURIComponent(query)}${append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setCursor(result.nextCursor || "");
      setLoadedMore(append);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法读取本机内容");
    } finally {
      setLoading(false);
    }
  }, [cursor, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const loadRunningTasks = async () => {
      try {
        const result = await fetchJson<MobileTaskResult>("/api/mobile/tasks?limit=20&status=running");
        setRunningTasks(result.items || []);
      } catch {
        setRunningTasks([]);
      }
    };
    void loadRunningTasks();
    const timer = window.setInterval(() => void loadRunningTasks(), 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (runningTasks.length <= 1) setTasksExpanded(false);
  }, [runningTasks.length]);

  const initialLoading = loading && !items.length;

  return <MobileListShell section="activity" title="最近动态" note={runningTasks.length ? `${runningTasks.length} 项工作进行中` : items.length ? `${items.length} 条动态` : "最近动态"} query={query} setQuery={setQuery} searchLabel="搜索最近动态" searchPlaceholder="搜索动态内容">
    <div className="activity-stream">
      {error ? <InlineError message={error} /> : null}
      {!query && runningTasks.length ? <RunningTaskPresence tasks={runningTasks} expanded={tasksExpanded} setExpanded={setTasksExpanded} /> : null}
      {query ? <SearchStatus count={items.length} summary={`“${query}”`} onClear={() => setQuery("")} /> : null}
      {!loading && !items.length ? <SearchEmpty title={query ? "没有找到相关动态" : "还没有最近动态"} hint={query ? "试试任务名称、邮件主题或页面标题" : "PA 的新工作会显示在这里"} /> : null}
      {initialLoading ? <MobileContentSkeleton kind="activity" /> : items.map((item) => <ActivityEntry item={item} key={item.id} />)}
      {!initialLoading ? <LoadSentinel loading={loading} canLoad={Boolean(cursor)} exhausted={loadedMore && !cursor} onLoad={() => void load(true)} /> : null}
    </div>
  </MobileListShell>;
}

function RunningTaskPresence({ tasks, expanded, setExpanded }: { tasks: Session[]; expanded: boolean; setExpanded: (value: boolean) => void }) {
  const [current, ...parallelTasks] = tasks;
  if (!current) return null;
  return <section className="activity-presence" aria-label="正在工作的任务">
    <header><span><i aria-hidden="true" />正在工作</span><small>{tasks.length > 1 ? `${tasks.length} 项并行` : "1 项进行中"}</small></header>
    <Link className="activity-presence-primary" href={`/app/mobile/workers/${encodeURIComponent(current.id)}?from=activity`}>
      <div><strong>{current.title || "未命名任务"}</strong><time dateTime={current.updatedAt} title={formatDateTime(current.updatedAt)}>{relativeTime(current.updatedAt)}</time></div>
      <p>{current.summary || current.taskDescription || "PA 正在处理这项任务"}</p>
    </Link>
    {parallelTasks.length ? <>
      <button className="activity-presence-toggle" type="button" aria-expanded={expanded} aria-controls="parallel-running-tasks" onClick={() => setExpanded(!expanded)}>
        <span>{expanded ? "收起并行工作" : `另有 ${parallelTasks.length} 项并行工作`}</span><ChevronDown aria-hidden="true" />
      </button>
      <div className="activity-presence-more" id="parallel-running-tasks" hidden={!expanded}>
        {parallelTasks.map((task) => <Link href={`/app/mobile/workers/${encodeURIComponent(task.id)}?from=activity`} key={task.id}><span><i aria-hidden="true" /><strong>{task.title || "未命名任务"}</strong></span><time dateTime={task.updatedAt} title={formatDateTime(task.updatedAt)}>{relativeTime(task.updatedAt)}</time></Link>)}
      </div>
    </> : null}
  </section>;
}

function ActivityEntry({ item }: { item: ActivityItem }) {
  const kind = activityKind(item.kind);
  const KindIcon = activityIcon(item.kind);
  const href = item.href && (item.kind === "work" || item.kind === "page") ? `${item.href}${item.href.includes("?") ? "&" : "?"}from=activity` : item.href;
  return <article className={`activity-story activity-entry${href ? " is-clickable" : ""}`}>
    {href ? <Link className="activity-entry-hit" href={href} aria-label={`查看详情：${item.title}`} /> : null}
    <header><span className={`story-kind ${item.kind}`}><i className="mobile-story-icon"><KindIcon aria-hidden="true" /></i>{kind.label}</span><span className="activity-entry-meta"><time dateTime={item.updatedAt} title={formatDateTime(item.updatedAt)}>{relativeTime(item.updatedAt)}</time>{href ? <i aria-hidden="true">›</i> : null}</span></header>
    <h2>{item.title}</h2><p>{item.summary}</p>
    {item.preview ? <div className="activity-target-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.preview.url} alt={item.preview.alt} loading="lazy" />
    </div> : null}
    {item.attachments.length ? <ActivityAttachments attachments={item.attachments} /> : null}
  </article>;
}

function activityIcon(kind: string) {
  return ({ work: ListTodo, page: FileText, mail: Mail, data: Database } as const)[kind as "work" | "page" | "mail" | "data"] || Activity;
}

function ActivityAttachments({ attachments }: { attachments: ActivityAttachment[] }) {
  const images = attachments.filter((item) => item.kind === "image");
  const files = attachments.filter((item) => item.kind === "file");
  return <section className="activity-related-files" aria-label="关联附件">
    <strong>关联附件</strong>
    {images.length ? <div className="activity-image-grid">
      {images.map((item) => <a href={item.downloadUrl} download={item.name} key={item.objectId} aria-label={`下载图片：${item.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.previewUrl} alt={item.name} loading="lazy" />
      </a>)}
    </div> : null}
    {files.length ? <div className="activity-file-list">
      {files.map((item) => <a className="activity-attachment" href={item.downloadUrl} download={item.name} key={item.objectId}>
        <span className={`attachment-type type-${fileExtension(item.name)}`}>{fileExtension(item.name).toUpperCase()}</span>
        <span className="attachment-copy"><strong>{item.name}</strong></span>
        <small>{formatBytes(item.sizeBytes)}</small>
        <i>下载</i>
      </a>)}
    </div> : null}
  </section>;
}

function fileExtension(name: string) {
  const extension = name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 5).toLowerCase();
  return extension || "file";
}

function formatBytes(value: number) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}
