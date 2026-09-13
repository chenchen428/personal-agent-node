"use client";
import Link from "next/link";
import { useState } from "react";
import { useClientResource } from "@/lib/use-client-resource";
import type { CalendarResult } from "../calendar/data";
import { calendarTime } from "../calendar/view";
import { executionHref, runStatusLabel } from "./format";
import type { PlanRun } from "./types";

export function PlanRuns({ planId, mobile = false, occurrenceAt, legacyRunCount = 0 }: { planId: string; mobile?: boolean; occurrenceAt?: string; legacyRunCount?: number }) {
  const [offset, setOffset] = useState(0);
  const query = new URLSearchParams({ limit: "20", offset: String(offset) });
  if (occurrenceAt) query.set("occurrenceAt", occurrenceAt);
  const result = useClientResource<CalendarResult<PlanRun>>(`/api/plans/${encodeURIComponent(planId)}/runs?${query}`);
  return <section className="plan-runs" aria-label="计划执行记录"><h3>{occurrenceAt ? "本次执行" : "执行记录"}</h3>
    {legacyRunCount > 0 ? <p>升级前累计执行 {legacyRunCount} 次，以下列出可追溯的执行记录。</p> : null}
    {result.loading ? <p role="status">正在读取执行记录…</p> : null}
    {result.error || result.staleError ? <p role="alert">{result.error || result.staleError}<button onClick={() => void result.refresh()}>重试</button></p> : null}
    {result.value?.items.map((run) => <article key={run.id}><div><strong>{runStatusLabel(run.status)}</strong><time dateTime={run.occurrenceAt}>{calendarTime(run.occurrenceAt)}</time></div>
      {run.error ? <p>{run.error}</p> : null}{run.result ? <p>{typeof run.result === "string" ? run.result : "执行结果已记录"}</p> : null}
      {run.sessionId ? <Link href={executionHref(run.sessionId, mobile)}>查看执行详情与结果 →</Link> : <small>尚未产生任务会话</small>}
    </article>)}
    {!result.loading && !result.error && result.value?.total === 0 ? <p>暂无执行记录。仅记录的安排不会运行 Cove。</p> : null}
    {offset > 0 || result.value?.hasMore ? <div className="cove-calendar-pager"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>较新记录</button><button disabled={!result.value?.hasMore} onClick={() => setOffset(offset + 20)}>更早记录</button></div> : null}
  </section>;
}
