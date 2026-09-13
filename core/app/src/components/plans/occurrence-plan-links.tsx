"use client";
import Link from "next/link";
import type { CalendarEntry } from "../calendar/data";
import { executionModeLabel, planHref, recurrenceLabel } from "./format";
import { PlanRuns } from "./plan-runs";

export function OccurrencePlanLinks({ entry, mobile = false }: { entry: CalendarEntry; mobile?: boolean }) {
  const planId = entry.planId || entry.id;
  return <section className="occurrence-plan-links" aria-label="关联计划">
    <p>{recurrenceLabel(entry.recurrence)} · {executionModeLabel[entry.executionMode || "record"]}</p>
    <Link className="plan-detail-link" href={planHref(planId, mobile)}>查看所属计划 →</Link>
    {entry.executionMode && entry.executionMode !== "record" ? <PlanRuns planId={planId} mobile={mobile} occurrenceAt={entry.occurrenceAt || entry.startAt} /> : null}
  </section>;
}
