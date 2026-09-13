"use client";

import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useClientResource } from "@/lib/use-client-resource";
import { Button, PageHeader } from "../desktop-v72/primitives";
import { TaskModuleViewNavigation } from "../desktop-v627/task-module-view-navigation";
import { CalendarUpcomingSummary } from "./upcoming-summary";
import type { CalendarUpcoming } from "./data";

export const calendarModuleDescription = "查看单次与周期安排，跟进每次执行的进展和结果。";

export function CalendarModuleHeader({ active, mobile = false, onRefresh, onSelect }: {
  active: "calendar" | "tasks"; mobile?: boolean; onRefresh?: () => void; onSelect?: (id: string) => void;
}) {
  const router = useRouter();
  const upcoming = useClientResource<CalendarUpcoming>("/api/calendar?view=upcoming&limit=1");
  const refresh = () => { void upcoming.refresh(); onRefresh?.(); };
  const select = (id: string) => onSelect ? onSelect(id) : router.push(`/app/${mobile ? "mobile/" : ""}workers/calendar?id=${encodeURIComponent(id)}`);
  return <div className="calendar-module-header">
    {!mobile ? <PageHeader title="日程" description={calendarModuleDescription} actions={<Button onClick={refresh} aria-label="刷新日程与执行记录"><RefreshCw size={15} />刷新</Button>} /> : null}
    <TaskModuleViewNavigation active={active} mobile={mobile} />
    <div className="calendar-module-summary"><CalendarUpcomingSummary {...upcoming} onSelect={select} onRetry={() => void upcoming.refresh()} /></div>
  </div>;
}
