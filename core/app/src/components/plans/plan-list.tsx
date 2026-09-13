"use client";
import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";
import { calendarTime } from "../calendar/view";
import { executionModeLabel, recurrenceLabel, runStatusLabel } from "./format";
import type { Plan, PlansResult } from "./types";

export function PlanList({ value, loading, error, staleError, selectedId, onSelect, onRetry, renderDetail }: {
  value: PlansResult | null; loading: boolean; error: string; staleError: string; selectedId: string;
  onSelect: (id: string) => void; onRetry: () => void;
  renderDetail?: (plan: Plan) => ReactNode;
}) {
  return <section className="plan-list" aria-label="计划列表" aria-busy={loading}>
    {loading ? <p role="status">正在读取计划…</p> : null}
    {error || staleError ? <p role="alert">{error || `更新失败，以下为上次结果：${staleError}`}<button onClick={onRetry}>重新加载</button></p> : null}
    {value?.items.map((plan) => <div key={plan.id}><PlanRow plan={plan} selected={plan.id === selectedId} onSelect={onSelect} />{plan.id === selectedId ? renderDetail?.(plan) : null}</div>)}
    {!loading && !error && value?.total === 0 ? <div className="cove-calendar-empty"><CalendarClock size={30} /><h2>暂无符合条件的计划</h2><p>在主对话中告诉 Cove 事项、时间，以及仅记录、提醒还是执行。周期计划也在这里统一管理。</p></div> : null}
  </section>;
}

function PlanRow({ plan, selected, onSelect }: { plan: Plan; selected: boolean; onSelect: (id: string) => void }) {
  return <button type="button" className={`plan-row${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => onSelect(plan.id)}>
    <span className="plan-row-heading"><strong>{plan.title}</strong><span>{!plan.enabled ? "已暂停" : plan.status === "cancelled" ? "已取消" : executionModeLabel[plan.executionMode]}</span></span>
    <span>{recurrenceLabel(plan.recurrence)} · {plan.participants.join("、") || "我的安排"}</span>
    <span className="plan-next">下一次：{plan.enabled && plan.nextOccurrenceAt ? <time dateTime={plan.nextOccurrenceAt}>{calendarTime(plan.nextOccurrenceAt, plan.timeZone)}</time> : !plan.enabled ? "已暂停" : "没有待发生安排"}</span>
    {plan.latestRun ? <small>最近执行：{runStatusLabel(plan.latestRun.status)} · {calendarTime(plan.latestRun.occurrenceAt, plan.timeZone)}</small> : null}
  </button>;
}
