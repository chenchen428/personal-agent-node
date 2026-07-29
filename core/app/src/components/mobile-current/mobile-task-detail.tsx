"use client";

import { formatDetailedElapsed, formatTaskDuration, isRunning, statusLabel, useClock } from "./data";
import { DetailShell } from "./shell";
import { TaskConversationContent, TaskLoading, TaskUnavailable } from "./task-display-presentation";
import { useTaskDisplayHistory } from "./use-task-display-history";
import type { Session } from "./types";

export function MobileTaskDetail({ taskId, returnHref, returnLabel }: { taskId: string; returnHref: string; returnLabel: string }) {
  const history = useTaskDisplayHistory(taskId);
  const now = useClock(1_000);
  const running = history.task ? isRunning(history.task.status) : false;
  const hasContent = Boolean(history.items.length || history.latestPlan.steps.length);
  return <DetailShell
    returnHref={returnHref}
    returnLabel={returnLabel}
    title={history.task?.title || "任务详情"}
    trailing={history.task ? taskStatusLabel(history.task.status) : ""}
    section="workers"
    task
    scrollRef={history.scrollRef}
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
  </DetailShell>;
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
