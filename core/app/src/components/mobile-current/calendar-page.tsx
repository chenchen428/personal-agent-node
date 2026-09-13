"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useClientResource } from "@/lib/use-client-resource";
import { calendarStatus, calendarTime, useCalendar, type CalendarEntry, type CalendarHistory, type CalendarResult } from "../calendar/data";
import { CalendarModuleHeader, calendarModuleDescription } from "../calendar/module-header";
import { PlanDetail } from "../plans/plan-detail";
import { OccurrencePlanLinks } from "../plans/occurrence-plan-links";
import { MobileListShell } from "./shell";

export function MobileCalendarPage() {
  const calendar = useCalendar();
  return <MobileListShell section="workers" title="日程" note={calendarModuleDescription} screenClassName="mobile-calendar-module" query={calendar.query} setQuery={calendar.setQuery} searchLabel="搜索日程" searchPlaceholder="搜索安排、参与人" filter={{ label: "日程状态", description: "选择要查看的安排", value: calendar.status, setValue: calendar.setStatus, options: [{ value: "all", label: calendar.period === "upcoming" ? "全部未结束安排" : "全部" }, ...calendar.statusOptions.map(([value, label]) => ({ value, label }))] }}>
    <div className="mobile-calendar"><CalendarModuleHeader active="calendar" mobile onSelect={calendar.setSelectedId} onRefresh={() => void calendar.refresh()} />

      {calendar.planId ? <p className="plan-help">当前仅显示所选计划 · <Link href="/app/mobile/workers/calendar">查看全部日程</Link></p> : null}
      <div className="mobile-calendar-toolbar"><select aria-label="查看时间范围" value={calendar.period} onChange={(event) => calendar.setPeriod(event.target.value)}><option value="upcoming">即将到来</option><option value="day">当天</option><option value="week">7 天</option></select><div className="mobile-calendar-date-slot">{calendar.period !== "upcoming" ? <><button aria-label="上一个时间段" onClick={() => calendar.move(-1)}><ChevronLeft size={18} /></button><input type="date" aria-label="日程日期" value={calendar.day} onChange={(event) => calendar.setDay(event.target.value)} /><button aria-label="下一个时间段" onClick={() => calendar.move(1)}><ChevronRight size={18} /></button></> : <span>各计划下一次 · 含进行中</span>}</div><button aria-label="刷新日程" onClick={() => void calendar.refresh()}><RefreshCw size={17} /></button></div>
      <div className="mobile-calendar-caption"><span>{calendar.value?.total ?? "—"} 项 · {calendar.timeZone}</span><button onClick={calendar.today}>今天</button></div>
      {calendar.planId && !calendar.selectedId ? <PlanDetail id={calendar.planId} mobile key={calendar.planId} /> : null}
      {calendar.error || calendar.staleError ? <p role="alert">{calendar.error || `更新失败，以下为上次结果：${calendar.staleError}`}<button onClick={() => void calendar.refresh()}>重新加载</button></p> : null}
      {calendar.loading ? <p role="status">正在读取日程…</p> : null}
      {!calendar.loading && calendar.selectedId && !calendar.value?.items.some((entry) => entry.id === calendar.selectedId) ? <LinkedCalendarEntry id={calendar.selectedId} /> : null}
      {calendar.value?.items.map((entry) => <article className="mobile-calendar-entry" key={entry.id}><button className="mobile-calendar-entry-main" aria-expanded={calendar.selectedId === entry.id} onClick={() => calendar.setSelectedId(calendar.selectedId === entry.id ? null : entry.id)}><time dateTime={entry.startAt}>{calendarTime(entry.startAt, entry.timeZone)}</time><h2>{entry.title}</h2><p>{entry.participants.join(" · ")}</p><span>{calendarStatus[entry.status]}</span></button>{calendar.selectedId === entry.id ? <MobileCalendarDetail entry={entry} /> : null}</article>)}
      {!calendar.loading && !calendar.error && calendar.value?.total === 0 ? <div className="mobile-calendar-empty"><CalendarDays size={30} /><h2>{calendar.query || calendar.status !== "all" ? "没有符合筛选的日程" : calendar.period === "upcoming" ? "暂无即将到来的日程" : "这段时间没有安排"}</h2><p>可以调整筛选条件，或告诉 Cove 新的安排。</p></div> : null}
      {calendar.value && (calendar.offset > 0 || calendar.value.hasMore) ? <div className="mobile-calendar-caption"><button disabled={calendar.offset === 0} onClick={() => calendar.setOffset(Math.max(0, calendar.offset - 50))}>上一页</button><span>{calendar.offset + calendar.value.items.length} / {calendar.value.total}</span><button disabled={!calendar.value.hasMore} onClick={() => calendar.setOffset(calendar.offset + 50)}>下一页</button></div> : null}
    </div>
  </MobileListShell>;
}

function LinkedCalendarEntry({ id }: { id: string }) {
  const result = useClientResource<{ entry: CalendarEntry }>(`/api/calendar/${encodeURIComponent(id)}`);
  const entry = result.value?.entry;
  return <article className="mobile-calendar-entry">{result.error ? <p role="alert">{result.error}<button onClick={() => void result.refresh()}>重新加载</button></p> : null}{entry ? <><h2>{entry.title}</h2><p>{entry.participants.join(" · ")} · {calendarStatus[entry.status]}</p><MobileCalendarDetail entry={entry} /></> : result.loading ? <p role="status">正在读取这项安排…</p> : null}</article>;
}

function MobileCalendarDetail({ entry }: { entry: CalendarEntry }) {
  const [offset, setOffset] = useState(0);
  const history = useClientResource<CalendarResult<CalendarHistory>>(`/api/calendar/${encodeURIComponent(entry.id)}/history?limit=20&offset=${offset}`);
  return <div className="mobile-calendar-detail"><dl><dt>完整时间</dt><dd>{calendarTime(entry.startAt, entry.timeZone)}{entry.endAt ? ` — ${calendarTime(entry.endAt, entry.timeZone)}` : ""}<small>{entry.timeZone}</small></dd>{entry.location ? <><dt>地点</dt><dd>{entry.location}</dd></> : null}{entry.nextFollowUpAt ? <><dt>下次跟进</dt><dd>{calendarTime(entry.nextFollowUpAt, entry.timeZone)}</dd></> : null}</dl>{entry.notes ? <p>{entry.notes}</p> : null}<OccurrencePlanLinks entry={entry} mobile /><h3>记录与跟进</h3>{history.error ? <p role="alert">{history.error}<button onClick={() => void history.refresh()}>重试</button></p> : null}<ol>{history.value?.items.map((item) => <li key={item.id}><small>{item.actor} · {calendarTime(item.createdAt)}</small><p>{item.content || ({ create: "记录了这项安排", update: "更新了安排", "follow-up": "跟进了安排" }[item.action] || "更新了记录")}</p></li>)}</ol>{offset > 0 ? <button onClick={() => setOffset(Math.max(0, offset - 20))}>较新记录</button> : null}{history.value?.hasMore ? <button onClick={() => setOffset(offset + 20)}>更早记录</button> : null}</div>;
}
