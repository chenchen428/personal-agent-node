"use client";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { PageHeader, PageSurface, Button, SearchField } from "../desktop-v72/primitives";
import { TaskModuleViewNavigation } from "./task-module-view-navigation";
import { CalendarUpcomingSummary } from "../calendar/upcoming-summary";
import type { CalendarUpcoming } from "../calendar/data";
import { useClientResource } from "@/lib/use-client-resource";
import { usePlans } from "../plans/use-plans";
import { PlanList } from "../plans/plan-list";
import { PlanDetail } from "../plans/plan-detail";
import { executionModeLabel } from "../plans/format";

export function PlansPage() {
  const plans = usePlans();
  const upcoming = useClientResource<CalendarUpcoming>("/api/calendar?view=upcoming&limit=1");
  const activeId = plans.selectedId || plans.value?.items[0]?.id || "";
  return <PageSurface className="cove-plans"><PageHeader title="任务" description="事项、时间与执行方式，在这里统一管理。" actions={<Button onClick={() => void Promise.all([plans.refresh(), upcoming.refresh()])}><RefreshCw size={15} />刷新</Button>} />
    <TaskModuleViewNavigation active="plans" />
    <CalendarUpcomingSummary {...upcoming} onRetry={() => void upcoming.refresh()} onSelect={(id) => { const entry = [upcoming.value?.nextEntry, upcoming.value?.ongoingEntry].find((item) => item?.id === id); if (entry) plans.setSelectedId(entry.planId || entry.id); }} />
    <div className="plans-toolbar"><SearchField aria-label="搜索计划" placeholder="搜索计划、参与人…" value={plans.query} onChange={(event) => plans.setQuery(event.target.value)} />
      <select aria-label="计划执行方式" value={plans.mode} onChange={(event) => plans.setMode(event.target.value)}><option value="all">全部执行方式</option>{Object.entries(executionModeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <span>{plans.value?.total ?? "—"} 个计划</span><Link href="/app/conversations">告诉 Cove 新的安排 →</Link></div>
    <div className="cove-calendar-layout"><div><PlanList {...plans} selectedId={activeId} onSelect={plans.setSelectedId} onRetry={() => void plans.refresh()} />
      {plans.offset > 0 || plans.value?.hasMore ? <div className="cove-calendar-pager"><Button disabled={plans.offset === 0} onClick={() => plans.setOffset(Math.max(0, plans.offset - 50))}>上一页</Button><Button disabled={!plans.value?.hasMore} onClick={() => plans.setOffset(plans.offset + 50)}>下一页</Button></div> : null}
    </div><aside className="cove-calendar-sidebar">{activeId ? <PlanDetail id={activeId} key={activeId} /> : <div className="cove-calendar-note"><span>COVE · YOUR PLANS</span><h2>一次安排，<br />持续跟进。</h2><p>计划决定做什么、何时发生；日程显示每次安排，执行记录保留 Cove 的结果。</p><p>仅记录不会启动 Cove。需要提醒或执行，请在对话中明确告诉它。</p></div>}</aside></div>
  </PageSurface>;
}
