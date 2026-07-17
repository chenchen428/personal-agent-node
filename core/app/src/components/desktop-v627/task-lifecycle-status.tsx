"use client";

import { AlertCircle, Check, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "./types";
import { isWorkerRunning } from "./use-worker-sessions";

export function TaskLifecycleStatus({ session }: { session: Session }) {
  const running = isWorkerRunning(session.status);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useMemo(() => timestamp(session.metadata?.cliThreadStartedAt || session.createdAt), [session.createdAt, session.metadata?.cliThreadStartedAt]);
  const updatedAt = useMemo(() => timestamp(session.updatedAt), [session.updatedAt]);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, session.id]);

  const endedAt = running ? now : Math.max(updatedAt, startedAt);
  const duration = formatTaskDuration(Math.max(0, endedAt - startedAt), running);
  const lastUpdate = session.updatedAt ? `最近更新 ${formatClock(updatedAt)}` : "等待首次进展";

  if (running) {
    return <section className="v72-task-lifecycle running" aria-label={`任务仍在处理，已运行 ${duration}`}>
      <LoaderCircle className="v72-spin" aria-hidden="true" />
      <div><strong>仍在处理 · 已运行 {duration}</strong><span>{lastUpdate}；新进展会自动显示，任务结束后状态会自动更新。</span></div>
    </section>;
  }

  const interrupted = session.status === "paused";
  return <section className={`v72-task-lifecycle ${interrupted ? "interrupted" : "completed"}`} aria-label={interrupted ? "任务已中断" : "任务已完成"}>
    {interrupted ? <AlertCircle aria-hidden="true" /> : <Check aria-hidden="true" />}
    <div><strong>{interrupted ? "任务已中断" : "任务已完成"} · 用时 {duration}</strong><span>{lastUpdate}；当前任务不会继续保持运行状态。</span></div>
  </section>;
}

export function formatTaskDuration(milliseconds: number, includeSeconds = false) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) return includeSeconds ? `${totalSeconds} 秒` : "不足 1 分钟";
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return includeSeconds ? `${totalMinutes} 分 ${seconds} 秒` : `${totalMinutes} 分钟`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} 小时 ${totalMinutes % 60} 分`;
  return `${Math.floor(totalHours / 24)} 天 ${totalHours % 24} 小时`;
}

function timestamp(value?: string) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatClock(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}
