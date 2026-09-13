import type { ExecutionMode, Recurrence } from "./types";
import { describeCron } from "../desktop-v627/scheduled-task-formatters";

export const executionModeLabel: Record<ExecutionMode, string> = { record: "仅记录", remind: "提醒本人", execute: "交给 Cove" };
export function recurrenceLabel(rule?: Recurrence | null) {
  if (!rule) return "单次安排";
  const interval = rule.interval || 1;
  const units = { daily: "天", weekly: "周", monthly: "月", yearly: "年", cron: "" };
  if (rule.frequency === "cron") {
    const label = describeCron(rule.cron || rule.expression || "");
    return !label || label.startsWith("Cron ·") ? "自定义周期" : label;
  }
  const every = interval === 1 ? `每${units[rule.frequency]}` : `每 ${interval} ${units[rule.frequency]}`;
  const days = rule.frequency === "weekly" && rule.weekdays?.length ? ` · ${rule.weekdays.map((day) => ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][day]).join("、")}` : "";
  return `${every}${days}${rule.count ? ` · 共 ${rule.count} 次` : ""}`;
}
export function runStatusLabel(status: string) {
  return ({ claimed: "准备执行", dispatched: "已开始", pending: "等待执行", running: "执行中", completed: "本次执行结束", succeeded: "本次执行结束", failed: "执行失败", interrupted: "已中断", skipped: "已跳过", cancelled: "已取消", unknown: "结果待确认" } as Record<string, string>)[status] || status;
}
export function planHref(id: string, mobile = false) { return `/app/${mobile ? "mobile/" : ""}workers/plans?id=${encodeURIComponent(id)}`; }
export function executionHref(sessionId: string, mobile = false) { return mobile ? `/app/mobile/workers/${encodeURIComponent(sessionId)}` : `/app/workers?task=${encodeURIComponent(sessionId)}`; }
