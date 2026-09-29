"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useClientResource } from "@/lib/use-client-resource";
import { calendarStatus, calendarTime, useCalendar, type CalendarEntry, type CalendarHistory, type CalendarResult } from "../calendar/data";
import { CalendarModuleHeader, calendarModuleDescription } from "../calendar/module-header";
import { PlanDetail } from "../plans/plan-detail";
import { OccurrencePlanLinks } from "../plans/occurrence-plan-links";
import { MobileListShell } from "./shell";

export function MobileCalendarPage() {
  const calendar = useCalendar();
  return <MobileListShell section="workers" title="日程" note={calendarModuleDescription} screenClassName="mobile-calendar-module" query={calendar.query} setQuery={calendar.setQuery} searchLabel="搜索日程" searchPlaceholder="搜索安排、参与人" filter={{ label: "日程状态", description: "选择要查看的安排", value: calendar.status, setValue: calendar.setStatus, options: [{ value: "all", label: calendar.period === "upcoming" ? "全部未结束安排" : "全部" }, ...calendar.statusOptions.map(([value, label]) => ({ value, label }))] }}>
    <div className="mobile-calendar">
      <CalendarModuleHeader active="calendar" mobile onSelect={calendar.setSelectedId} onRefresh={() => void calendar.refresh()} />
      {calendar.planId ? <p className="plan-help">当前仅显示所选计划 · <Link href="/app/mobile/workers/calendar">查看全部日程</Link></p> : null}
      <div className="mobile-calendar-toolbar" role="group" aria-label="日程时间范围">
        <div className="mobile-calendar-toolbar-main">
          <select aria-label="查看时间范围" value={calendar.period} onChange={(event) => calendar.setPeriod(event.target.value)}>
            <option value="upcoming">即将到来</option><option value="day">当天</option><option value="week">7 天</option>
          </select>
          <button type="button" onClick={calendar.today}>今天</button>
          <button type="button" className="mobile-calendar-refresh" aria-label="刷新日程" onClick={() => void calendar.refresh()}><RefreshCw size={17} aria-hidden="true" /></button>
        </div>
        <div className="mobile-calendar-date-slot">
          {calendar.period !== "upcoming" ? <>
            <button type="button" aria-label="上一个时间段" onClick={() => calendar.move(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
            <input type="date" aria-label="日程日期" value={calendar.day} onChange={(event) => calendar.setDay(event.target.value)} />
            <button type="button" aria-label="下一个时间段" onClick={() => calendar.move(1)}><ChevronRight size={18} aria-hidden="true" /></button>
          </> : <span>各计划下一次 · 含进行中</span>}
        </div>
      </div>
      <div className="mobile-calendar-caption" aria-live="polite"><span>{calendar.value?.total ?? "—"} 项安排</span><span>{calendar.timeZone}</span></div>
      {calendar.planId && !calendar.selectedId ? <PlanDetail id={calendar.planId} mobile key={calendar.planId} /> : null}
      {calendar.error || calendar.staleError ? <p className="mobile-calendar-feedback" role="alert">{calendar.error || `更新失败，以下为上次结果：${calendar.staleError}`}<button type="button" onClick={() => void calendar.refresh()}>重新加载</button></p> : null}
      {calendar.loading ? <p className="mobile-calendar-feedback" role="status">正在读取日程…</p> : null}
      {!calendar.loading && calendar.selectedId && !calendar.value?.items.some((entry) => entry.id === calendar.selectedId) ? <LinkedCalendarEntry id={calendar.selectedId} /> : null}
      <div className="mobile-calendar-entries" aria-label="日程列表">
        {calendar.value?.items.map((entry) => <CalendarEntryCard key={entry.id} entry={entry} expanded={calendar.selectedId === entry.id} onToggle={() => calendar.setSelectedId(calendar.selectedId === entry.id ? null : entry.id)} />)}
      </div>
      {!calendar.loading && !calendar.error && calendar.value?.total === 0 ? <div className="mobile-calendar-empty"><CalendarDays size={30} aria-hidden="true" /><h2>{calendar.query || calendar.status !== "all" ? "没有符合筛选的日程" : calendar.period === "upcoming" ? "暂无即将到来的日程" : "这段时间没有安排"}</h2><p>可以调整筛选条件，或告诉 Cove 新的安排。</p></div> : null}
      {calendar.value && (calendar.offset > 0 || calendar.value.hasMore) ? <nav className="mobile-calendar-pager" aria-label="日程翻页"><button type="button" disabled={calendar.offset === 0} onClick={() => calendar.setOffset(Math.max(0, calendar.offset - 50))}>上一页</button><span>{calendar.offset + calendar.value.items.length} / {calendar.value.total}</span><button type="button" disabled={!calendar.value.hasMore} onClick={() => calendar.setOffset(calendar.offset + 50)}>下一页</button></nav> : null}
    </div>
  </MobileListShell>;
}

function CalendarEntryCard({ entry, expanded, onToggle }: { entry: CalendarEntry; expanded: boolean; onToggle: () => void }) {
  const start = new Date(entry.startAt);
  const date = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: entry.timeZone }).format(start);
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: entry.timeZone }).format(start);
  const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: entry.timeZone }).format(start);
  const status = calendarStatus[entry.status] || entry.status;
  return <article className={`mobile-calendar-entry${expanded ? " is-expanded" : ""}`}>
    <button type="button" className="mobile-calendar-entry-main" aria-expanded={expanded} aria-label={`${entry.title}，${calendarTime(entry.startAt, entry.timeZone)}，${status}`} onClick={onToggle}>
      <time className="mobile-calendar-entry-date" dateTime={entry.startAt}><strong>{date}</strong><span>{weekday}</span></time>
      <span className="mobile-calendar-entry-copy"><span className="mobile-calendar-entry-meta"><time dateTime={entry.startAt}>{clock}</time><span className={`mobile-calendar-entry-status status-${calendarStatus[entry.status] ? entry.status : "unknown"}`}>{status}</span></span><strong className="mobile-calendar-entry-title">{entry.title}</strong>{entry.participants.length ? <span className="mobile-calendar-entry-participants">{entry.participants.join(" · ")}</span> : null}</span>
      <ChevronDown className="mobile-calendar-entry-chevron" size={17} aria-hidden="true" />
    </button>
    {expanded ? <MobileCalendarDetail entry={entry} /> : null}
  </article>;
}

function LinkedCalendarEntry({ id }: { id: string }) {
  const result = useClientResource<{ entry: CalendarEntry }>(`/api/calendar/${encodeURIComponent(id)}`);
  const entry = result.value?.entry;
  return <article className="mobile-calendar-entry mobile-calendar-linked">
    {result.error ? <p className="mobile-calendar-feedback" role="alert">{result.error}<button type="button" onClick={() => void result.refresh()}>重新加载</button></p> : null}
    {entry ? <><header><h2>{entry.title}</h2><p>{calendarTime(entry.startAt, entry.timeZone)} · {calendarStatus[entry.status] || entry.status}</p></header><MobileCalendarDetail entry={entry} /></> : result.loading ? <p className="mobile-calendar-feedback" role="status">正在读取这项安排…</p> : null}
  </article>;
}

function MobileCalendarDetail({ entry }: { entry: CalendarEntry }) {
  const [offset, setOffset] = useState(0);
  const history = useClientResource<CalendarResult<CalendarHistory>>(`/api/calendar/${encodeURIComponent(entry.id)}/history?limit=20&offset=${offset}`);
  return <div className="mobile-calendar-detail">
    <dl><dt>完整时间</dt><dd>{calendarTime(entry.startAt, entry.timeZone)}{entry.endAt ? ` — ${calendarTime(entry.endAt, entry.timeZone)}` : ""}<small>{entry.timeZone}</small></dd>{entry.location ? <><dt>地点</dt><dd>{entry.location}</dd></> : null}{entry.nextFollowUpAt ? <><dt>下次跟进</dt><dd>{calendarTime(entry.nextFollowUpAt, entry.timeZone)}</dd></> : null}</dl>
    {entry.notes ? <p className="mobile-calendar-notes">{entry.notes}</p> : null}
    <OccurrencePlanLinks entry={entry} mobile />
    <h3>记录与跟进</h3>
    {history.error ? <p role="alert">{history.error}<button type="button" onClick={() => void history.refresh()}>重试</button></p> : null}
    <ol>{history.value?.items.map((item) => <li key={item.id}><small>{item.actor} · {calendarTime(item.createdAt)}</small><p>{item.content || ({ create: "记录了这项安排", update: "更新了安排", "follow-up": "跟进了安排" }[item.action] || "更新了记录")}</p></li>)}</ol>
    {offset > 0 ? <button type="button" onClick={() => setOffset(Math.max(0, offset - 20))}>较新记录</button> : null}
    {history.value?.hasMore ? <button type="button" onClick={() => setOffset(offset + 20)}>更早记录</button> : null}
  </div>;
}
