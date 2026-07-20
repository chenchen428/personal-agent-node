"use client";

import Link from "next/link";
import { formatDetailedElapsed, formatTaskDuration, isRunning, statusLabel, useClock } from "./data";
import { BackIcon } from "./shell";
import { TaskConversationContent, TaskLoading, TaskUnavailable } from "./task-display-presentation";
import { useTaskDisplayHistory } from "./use-task-display-history";
import type { Session } from "./types";

export function MobileTaskDetail({ taskId, returnHref, returnLabel }: { taskId: string; returnHref: string; returnLabel: string }) {
  const history = useTaskDisplayHistory(taskId);
  const now = useClock(1_000);
  const running = history.task ? isRunning(history.task.status) : false;
  const hasContent = Boolean(history.items.length || history.latestPlan.steps.length);
  return <div className="mobile-current"><div className="mobile-stage"><div className="phone content-detail-phone task-conversation-phone">
    <main className="content-detail-screen">
      <div className="task-conversation-bar">
        <Link href={returnHref} aria-label={`返回${returnLabel}`}><BackIcon /></Link>
        <strong>{history.task?.title || "任务详情"}</strong>
        <span>{history.task ? taskStatusLabel(history.task.status) : ""}</span>
      </div>
      <div
        className="content-detail-scroll"
        data-task-display-scroll="tail"
        ref={history.scrollRef}
        onScroll={history.onScroll}
      >
        {history.error ? <TaskUnavailable error /> : history.task && hasContent ? <TaskConversationContent
          items={history.items}
          plan={history.latestPlan.steps}
          userName={history.task.senderName || "你"}
          loadingEarlier={history.loadingEarlier}
          positioned={history.positioned}
          runtime={<>
            {history.newUpdate ? <button className="task-new-update" type="button" onClick={() => history.scrollLatest()}>有新进展 <span aria-hidden="true">↓</span></button> : null}
            <TaskRuntime task={history.task} running={running} now={now} />
          </>}
        /> : history.loading ? <TaskLoading /> : <TaskUnavailable />}
      </div>
    </main>
  </div></div></div>;
}

function TaskRuntime({ task, running, now }: { task: Session; running: boolean; now: number }) {
  return <div className={`mobile-task-runtime${running ? " processing" : ""}`} role={running ? "status" : undefined}>
    {running
      ? <><i aria-hidden="true" /><strong>正在处理</strong><span>· {taskRuntimeLabel(task, now)}</span></>
      : <span>{taskRuntimeLabel(task, now)}</span>}
  </div>;
}

function taskStatusLabel(status: string) { return status === "idle" ? "已完成" : statusLabel(status); }

function taskRuntimeLabel(task: Session, now: number) {
  const running = isRunning(task.status);
  const start = new Date(task.createdAt || task.updatedAt || now).getTime();
  const end = running ? now : new Date(task.updatedAt || task.createdAt || now).getTime();
  const seconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1_000)) : 0;
  if (running && task.metadata?.workerRecoveryAttempt) return `重启后已继续处理 · ${formatDetailedElapsed(seconds)}`;
  return formatTaskDuration(seconds, running);
}
