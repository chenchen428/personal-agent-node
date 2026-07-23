import type { Session } from "./types";
import { isWorkerRunning } from "./use-worker-sessions";

export type WorkerStatusFilter = "all" | "running" | "completed" | "paused";

export const workerStatusOptions: Array<{ value: WorkerStatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "running", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "paused", label: "已暂停" },
];

export function matchesWorkerStatus(session: Session, filter: WorkerStatusFilter) {
  if (filter === "all") return true;
  if (filter === "running") return isWorkerRunning(session.status);
  if (filter === "paused") return session.status === "paused";
  return ["idle", "done"].includes(session.status);
}

export function workerStatusLabel(status: string) {
  if (status === "idle") return "已完成";
  if (status === "paused") return "已暂停";
  return ({ start: "启动中", running: "进行中", done: "已完成" } as Record<string, string>)[status] || status;
}
