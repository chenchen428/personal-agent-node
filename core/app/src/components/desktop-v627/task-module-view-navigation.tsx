"use client";

import Link from "next/link";
import { CalendarClock, ListTodo } from "lucide-react";

export function TaskModuleViewNavigation({ active, scheduledCount }: { active: "tasks" | "schedules"; scheduledCount?: number }) {
  return <nav className="task-view-navigation" aria-label="任务视图">
    <Link className={active === "tasks" ? "active" : ""} href="/app/workers" aria-current={active === "tasks" ? "page" : undefined}>
      <ListTodo aria-hidden="true" /><span>任务列表</span>
    </Link>
    <Link className={active === "schedules" ? "active" : ""} href="/app/workers/schedules" aria-current={active === "schedules" ? "page" : undefined}>
      <CalendarClock aria-hidden="true" /><span>自动化</span>
      {typeof scheduledCount === "number" ? <small>{scheduledCount}</small> : null}
    </Link>
  </nav>;
}
