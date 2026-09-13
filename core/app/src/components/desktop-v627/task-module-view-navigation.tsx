"use client";
import Link from "next/link";
import { CalendarDays, ListTodo } from "lucide-react";
export function TaskModuleViewNavigation({ active, mobile = false }: { active: "tasks" | "calendar"; mobile?: boolean }) {
  const base = `/app/${mobile ? "mobile/" : ""}workers`;
  return <nav className="task-view-navigation" aria-label="日程视图">
    <Link className={active === "calendar" ? "active" : ""} href={`${base}/calendar`} aria-current={active === "calendar" ? "page" : undefined}><CalendarDays aria-hidden="true" /><span>日程</span></Link>
    <Link className={active === "tasks" ? "active" : ""} href={base} aria-current={active === "tasks" ? "page" : undefined}><ListTodo aria-hidden="true" /><span>执行记录</span></Link>
  </nav>;
}
