"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useClientResource } from "@/lib/use-client-resource";
import { calendarContext, calendarLink, calendarSearch, calendarTime, dateKey, type CalendarPeriod } from "./view";
import type { ExecutionMode, Recurrence } from "../plans/types";
import { executionModeLabel, recurrenceLabel } from "../plans/format";
export { calendarTime, dateKey } from "./view";

export type CalendarEntry = {
  id: string; title: string; participants: string[]; startAt: string; endAt: string | null;
  timeZone: string; location: string; notes: string; status: string; nextFollowUpAt: string | null; revision: number;
  planId?: string; occurrenceAt?: string; recurrence?: Recurrence | null; executionMode?: ExecutionMode;
};
export type CalendarHistory = { id: string; actor: string; action: string; content: string; revision: number; createdAt: string; changes: Record<string, { before: unknown; after: unknown }> };
export type CalendarResult<T> = { items: T[]; total: number; limit: number; offset: number; hasMore: boolean };
export type CalendarUpcoming = CalendarResult<CalendarEntry> & { asOf: string; nextEntry: CalendarEntry | null; ongoingEntry: CalendarEntry | null };
export const calendarStatus: Record<string, string> = { planned: "待开始", in_progress: "进行中", done: "已完成", cancelled: "已取消" };
export const calendarField: Record<string, string> = { title: "安排", participants: "参与人", startAt: "开始时间", endAt: "结束时间", timeZone: "时区", location: "地点", notes: "备注", status: "状态", nextFollowUpAt: "下次跟进", recurrence: "重复规则", executionMode: "执行方式", executionPrompt: "执行要求", missedRunPolicy: "错过时", enabled: "计划开关", occurrenceAt: "本次原定时间", scope: "修改范围", executionContext: "执行环境" };
export function calendarChange(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return "未设置";
  if (field === "recurrence") return recurrenceLabel(value as Recurrence);
  if (field === "executionMode") return executionModeLabel[value as ExecutionMode] || String(value);
  if (field === "missedRunPolicy") return value === "latest" ? "补执行最近一次" : "跳过";
  if (field === "enabled") return value ? "已启用" : "已暂停";
  if (field === "scope") return ({ series: "整个系列", occurrence: "仅本次", future: "这次及以后" }[String(value)] || String(value));
  if (field === "executionContext") return "已设置";
  if (Array.isArray(value)) return value.join("、");
  if (field === "status") return calendarStatus[String(value)] || String(value);
  if (field.endsWith("At") && typeof value === "string") return calendarTime(value);
  return String(value);
}
export function useCalendar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const [day, setDay] = useState(() => calendarLink(new URLSearchParams(params.toString())).day);
  const [period, setPeriod] = useState<CalendarPeriod>(() => calendarLink(new URLSearchParams(params.toString())).period);
  const [linkedRange, setLinkedRange] = useState(() => calendarLink(new URLSearchParams(params.toString())).linkedRange);
  const [status, setStatus] = useState(params.get("status") && calendarStatus[params.get("status")!] ? params.get("status")! : "all");
  const [query, setQuery] = useState((params.get("query") || "").slice(0, 300));
  const [offset, setOffset] = useState(0);
  const context = calendarContext(pathname, new URLSearchParams(params.toString()));
  const planId = context.planId;
  const [selectedId, setSelectedId] = useState<string | null>(context.selectedId);
  const linkedSearch = params.toString();
  const appliedLink = useRef(linkedSearch);
  useEffect(() => {
    if (!/\/(calendar|plans|schedules)$/.test(pathname) || appliedLink.current === linkedSearch) return;
    appliedLink.current = linkedSearch;
    const linked = new URLSearchParams(linkedSearch);
    const view = calendarLink(linked);
    setDay(view.day); setOffset(0); setSelectedId(calendarContext(pathname, linked).selectedId);
    setPeriod(view.period); setLinkedRange(view.linkedRange);
    setStatus(calendarStatus[linked.get("status") || ""] ? linked.get("status")! : "all");
    setQuery((linked.get("query") || "").slice(0, 300));
  }, [linkedSearch, pathname]);
  const from = new Date(`${day}T00:00:00`);
  const search = calendarSearch({ day, period, linkedRange, offset, query, status });
  if (planId) search.set("planId", planId);
  const result = useClientResource<CalendarResult<CalendarEntry>>(`/api/calendar?${search}`);
  const upcoming = useClientResource<CalendarUpcoming>("/api/calendar?view=upcoming&limit=1");
  function updateDay(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(`${value}T00:00:00`).getTime())) return; setDay(value); setOffset(0); setLinkedRange(null); setSelectedId(null); if (period === "upcoming") setPeriod("day"); }
  function move(direction: number) { const next = new Date(from); next.setDate(next.getDate() + direction * (period === "week" ? 7 : 1)); updateDay(dateKey(next)); }
  return { ...result, upcoming, refresh: () => Promise.all([result.refresh(), upcoming.refresh()]), day, setDay: updateDay, period, setPeriod: (value: string) => { setPeriod(value as CalendarPeriod); setOffset(0); setLinkedRange(null); if (value === "upcoming" && ["done", "cancelled"].includes(status)) setStatus("all"); },
    statusOptions: Object.entries(calendarStatus).filter(([value]) => period !== "upcoming" || !["done", "cancelled"].includes(value)),
    status, setStatus: (value: string) => { setStatus(value); setOffset(0); }, query, setQuery: (value: string) => { setQuery(value); setOffset(0); },
    offset, setOffset, selectedId, setSelectedId, planId, move, today: () => updateDay(dateKey(new Date())),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
