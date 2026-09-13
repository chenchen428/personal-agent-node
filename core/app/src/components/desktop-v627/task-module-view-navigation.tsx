"use client";
import Link from "next/link";
import { CalendarClock, CalendarDays, ListTodo } from "lucide-react";
export function TaskModuleViewNavigation({ active, mobile = false }: { active: "tasks" | "plans" | "calendar"; mobile?: boolean }) {
  const base = `/app/${mobile ? "mobile/" : ""}workers`;
  return <nav className="task-view-navigation" aria-label="任务视图">
    <Link className={active === "plans" ? "active" : ""} href={`${base}/plans`} aria-current={active === "plans" ? "page" : undefined}><CalendarClock aria-hidden="true" /><span>计划</span></Link>
    <Link className={active === "calendar" ? "active" : ""} href={`${base}/calendar`} aria-current={active === "calendar" ? "page" : undefined}><CalendarDays aria-hidden="true" /><span>日程</span></Link>
    <Link className={active === "tasks" ? "active" : ""} href={base} aria-current={active === "tasks" ? "page" : undefined}><ListTodo aria-hidden="true" /><span>执行记录</span></Link>
  </nav>;
}
