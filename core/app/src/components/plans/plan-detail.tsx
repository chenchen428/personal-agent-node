"use client";
import Link from "next/link";
import { useClientResource } from "@/lib/use-client-resource";
import { calendarTime } from "../calendar/view";
import { calendarStatus } from "../calendar/data";
import { executionModeLabel, recurrenceLabel } from "./format";
import { PlanRuns } from "./plan-runs";
import type { Plan } from "./types";

export function PlanDetail({ id, mobile = false }: { id: string; mobile?: boolean }) {
  const result = useClientResource<{ plan: Plan }>(`/api/plans/${encodeURIComponent(id)}`);
  const plan = result.value?.plan;
  return <section className="cove-calendar-detail plan-detail" aria-label="计划详情">
    {result.loading ? <p role="status">正在读取计划详情…</p> : null}
    {result.error || result.staleError ? <p role="alert">{result.error || result.staleError}<button onClick={() => void result.refresh()}>重新加载</button></p> : null}
    {plan ? <><span className="cove-calendar-status">{plan.enabled ? calendarStatus[plan.status] : "已暂停"} · {executionModeLabel[plan.executionMode]}</span><h2>{plan.title}</h2>
      <dl><dt>下一次</dt><dd>{plan.enabled && plan.nextOccurrenceAt ? calendarTime(plan.nextOccurrenceAt, plan.timeZone) : "暂无待发生安排"}</dd>
        <dt>重复</dt><dd>{recurrenceLabel(plan.recurrence)}{plan.recurrence?.until ? <small>截止 {calendarTime(plan.recurrence.until, plan.timeZone)}</small> : null}</dd>
        <dt>起始时间</dt><dd>{calendarTime(plan.startAt, plan.timeZone)}{plan.endAt ? ` — ${calendarTime(plan.endAt, plan.timeZone)}` : ""}<small>{plan.timeZone}</small></dd>
        <dt>参与人</dt><dd>{plan.participants.join("、") || "未设置"}</dd>{plan.location ? <><dt>地点</dt><dd>{plan.location}</dd></> : null}
        {plan.executionMode !== "record" ? <><dt>停机错过时</dt><dd>{plan.missedRunPolicy === "latest" ? "恢复后补执行最近一次" : "跳过，等待下一次"}</dd></> : null}
      </dl>
      {plan.legacy?.migrationWarning ? <p role="alert">{plan.legacy.migrationWarning}</p> : null}
      {plan.notes ? <p className="cove-calendar-notes">{plan.notes}</p> : null}{plan.executionPrompt ? <><h3>{plan.executionMode === "remind" ? "提醒内容" : "执行要求"}</h3><p className="cove-calendar-notes">{plan.executionPrompt}</p></> : null}
      <Link className="plan-detail-link" href={`/app/${mobile ? "mobile/" : ""}workers/calendar?planId=${encodeURIComponent(plan.id)}`}>在日程中查看 →</Link>
      <p className="plan-help">需要修改或取消时，告诉 Cove 是仅这一次、这次及以后，还是整个系列。</p>
      {!mobile ? <Link className="plan-detail-link" href="/app/conversations">前往主对话管理计划 →</Link> : null}
      <PlanRuns planId={plan.id} mobile={mobile} legacyRunCount={plan.legacy?.runCount} key={plan.id} />
    </> : null}
  </section>;
}
