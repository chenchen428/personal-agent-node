"use client";
import { MobileListShell } from "./shell";
import { TaskModuleViewNavigation } from "../desktop-v627/task-module-view-navigation";
import { usePlans } from "../plans/use-plans";
import { PlanList } from "../plans/plan-list";
import { PlanDetail } from "../plans/plan-detail";
import { executionModeLabel } from "../plans/format";
import { CalendarUpcomingSummary } from "../calendar/upcoming-summary";
import type { CalendarUpcoming } from "../calendar/data";
import { useClientResource } from "@/lib/use-client-resource";

export function MobilePlansPage() {
  const plans = usePlans();
  const upcoming = useClientResource<CalendarUpcoming>("/api/calendar?view=upcoming&limit=1");
  return <MobileListShell section="workers" title="任务" note="计划 · 日程 · 执行记录" query={plans.query} setQuery={plans.setQuery} searchLabel="搜索计划" searchPlaceholder="搜索计划、参与人" filter={{ label: "执行方式", description: "选择执行方式", value: plans.mode, setValue: plans.setMode, options: [{ value: "all", label: "全部" }, ...Object.entries(executionModeLabel).map(([value, label]) => ({ value, label }))] }}>
    <div className="mobile-plans"><TaskModuleViewNavigation active="plans" mobile />
      <CalendarUpcomingSummary {...upcoming} onRetry={() => void upcoming.refresh()} onSelect={(id) => { const entry = [upcoming.value?.nextEntry, upcoming.value?.ongoingEntry].find((item) => item?.id === id); if (entry) plans.setSelectedId(entry.planId || entry.id); }} />
      <div className="mobile-calendar-caption"><span>{plans.value?.total ?? "—"} 个计划</span><button onClick={() => void Promise.all([plans.refresh(), upcoming.refresh()])}>刷新</button></div>
      {plans.selectedId && !plans.value?.items.some((plan) => plan.id === plans.selectedId) ? <div className="mobile-plan-selected"><button onClick={() => plans.setSelectedId("")}>收起计划详情</button><PlanDetail id={plans.selectedId} mobile key={plans.selectedId} /></div> : null}
      <PlanList {...plans} onSelect={(id) => plans.setSelectedId(id === plans.selectedId ? "" : id)} onRetry={() => void plans.refresh()} renderDetail={(plan) => <div className="mobile-plan-selected"><PlanDetail id={plan.id} mobile /></div>} />
      {plans.offset > 0 || plans.value?.hasMore ? <div className="cove-calendar-pager"><button disabled={plans.offset === 0} onClick={() => plans.setOffset(Math.max(0, plans.offset - 50))}>上一页</button><button disabled={!plans.value?.hasMore} onClick={() => plans.setOffset(plans.offset + 50)}>下一页</button></div> : null}
      <p className="plan-help">在与 Cove 的对话中创建或调整计划，可选择单次、周期，以及仅记录、提醒本人或交给 Cove 执行。</p>
    </div>
  </MobileListShell>;
}
