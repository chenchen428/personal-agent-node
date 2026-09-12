"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useClientResource } from "@/lib/use-client-resource";

export type CalendarEntry = {
  id: string; title: string; participants: string[]; startAt: string; endAt: string | null;
  timeZone: string; location: string; notes: string; status: string; nextFollowUpAt: string | null; revision: number;
};
export type CalendarHistory = { id: string; actor: string; action: string; content: string; revision: number; createdAt: string; changes: Record<string, { before: unknown; after: unknown }> };
export type CalendarResult<T> = { items: T[]; total: number; limit: number; offset: number; hasMore: boolean };
export const calendarStatus: Record<string, string> = { planned: "待开始", in_progress: "进行中", done: "已完成", cancelled: "已取消" };
export const calendarField: Record<string, string> = { title: "安排", participants: "参与人", startAt: "开始时间", endAt: "结束时间", timeZone: "时区", location: "地点", notes: "备注", status: "状态", nextFollowUpAt: "下次跟进" };
export function calendarChange(value: unknown, field: string) {
  if (value === null || value === "") return "未设置";
  if (Array.isArray(value)) return value.join("、");
  if (field === "status") return calendarStatus[String(value)] || String(value);
  if (field.endsWith("At") && typeof value === "string") return calendarTime(value);
  return String(value);
}
export function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function calendarTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(value));
}
export function useCalendar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const [day, setDay] = useState(() => {
    const value = params.get("from"); const parsed = value ? new Date(value) : new Date();
    return dateKey(Number.isFinite(parsed.getTime()) ? parsed : new Date());
  });
  const [period, setPeriod] = useState(params.get("period") === "week" ? "week" : "day");
  const [linkedRange, setLinkedRange] = useState(() => {
    const from = params.get("from"), to = params.get("to");
    return from && to && Number.isFinite(Date.parse(from)) && Date.parse(to) > Date.parse(from) ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : null;
  });
  const [status, setStatus] = useState(params.get("status") && calendarStatus[params.get("status")!] ? params.get("status")! : "all");
  const [query, setQuery] = useState((params.get("query") || "").slice(0, 300));
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const linkedSearch = params.toString();
  const appliedLink = useRef(linkedSearch);
  useEffect(() => {
    if (!pathname.endsWith("/calendar") || appliedLink.current === linkedSearch) return;
    appliedLink.current = linkedSearch;
    const linked = new URLSearchParams(linkedSearch);
    const start = linked.get("from"), end = linked.get("to");
    if (!start || !Number.isFinite(Date.parse(start))) return;
    setDay(dateKey(new Date(start))); setOffset(0); setSelectedId(linked.get("id"));
    setPeriod(linked.get("period") === "week" ? "week" : "day");
    setLinkedRange(end && Date.parse(end) > Date.parse(start) ? { from: new Date(start).toISOString(), to: new Date(end).toISOString() } : null);
    setStatus(calendarStatus[linked.get("status") || ""] ? linked.get("status")! : "all");
    setQuery((linked.get("query") || "").slice(0, 300));
  }, [linkedSearch, pathname]);
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from); to.setDate(to.getDate() + (period === "week" ? 7 : 1));
  const search = new URLSearchParams({ from: linkedRange?.from || from.toISOString(), to: linkedRange?.to || to.toISOString(), limit: "50", offset: String(offset) });
  if (query) search.set("query", query);
  if (status !== "all") search.set("status", status);
  const result = useClientResource<CalendarResult<CalendarEntry>>(`/api/calendar?${search}`);
  function updateDay(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(`${value}T00:00:00`).getTime())) return; setDay(value); setOffset(0); setLinkedRange(null); setSelectedId(null); }
  function move(direction: number) { const next = new Date(from); next.setDate(next.getDate() + direction * (period === "week" ? 7 : 1)); updateDay(dateKey(next)); }
  return { ...result, day, setDay: updateDay, period, setPeriod: (value: string) => { setPeriod(value); setOffset(0); setLinkedRange(null); },
    status, setStatus: (value: string) => { setStatus(value); setOffset(0); }, query, setQuery: (value: string) => { setQuery(value); setOffset(0); },
    offset, setOffset, selectedId, setSelectedId, move, today: () => updateDay(dateKey(new Date())),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
