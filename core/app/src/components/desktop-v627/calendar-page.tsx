"use client";

import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCalendar, calendarStatus, calendarTime } from "../calendar/data";
import { Button, PageHeader, PageSurface, SearchField, SegmentedControl } from "../desktop-v72/primitives";
import { CalendarDetail } from "./calendar-detail";

export function CalendarPage() {
  const calendar = useCalendar();
  return <PageSurface className="cove-calendar"><PageHeader title="日程" description="谁，在什么时候，要做什么。Cove 帮你记录安排，持续跟进。" actions={<Button onClick={() => void calendar.refresh()} aria-label="刷新日程"><RefreshCw size={15} />刷新</Button>} />
    <div className="cove-calendar-toolbar">
      <div className="cove-calendar-date"><button type="button" aria-label="上一个时间段" onClick={() => calendar.move(-1)}><ChevronLeft size={17} /></button><input type="date" aria-label="日程起始日期" value={calendar.day} onChange={(event) => calendar.setDay(event.target.value)} /><button type="button" aria-label="下一个时间段" onClick={() => calendar.move(1)}><ChevronRight size={17} /></button><Button variant="ghost" onClick={calendar.today}>今天</Button></div>
      <SegmentedControl value={calendar.period} onChange={calendar.setPeriod} options={[{ label: "日", value: "day" }, { label: "7 天", value: "week" }]} />
      <SearchField value={calendar.query} onChange={(event) => calendar.setQuery(event.target.value)} placeholder="搜索安排、参与人…" aria-label="搜索日程" />
      <select aria-label="日程状态" value={calendar.status} onChange={(event) => calendar.setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(calendarStatus).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
    </div>
    <div className="cove-calendar-layout"><section aria-label="日程列表" className="cove-calendar-agenda">
      <div className="cove-calendar-caption"><span>{calendar.value?.total ?? "—"} 项安排</span><span>日期筛选 · {calendar.timeZone}</span></div>
      {calendar.error ? <div role="alert">{calendar.error}<Button onClick={() => void calendar.refresh()}>重新加载</Button></div> : null}
      {calendar.loading ? <p role="status">正在读取日程…</p> : null}
      {calendar.value?.items.map((entry) => <button type="button" className={`cove-calendar-entry${calendar.selectedId === entry.id ? " is-selected" : ""}`} key={entry.id} onClick={() => calendar.setSelectedId(entry.id)} aria-pressed={calendar.selectedId === entry.id}>
        <time dateTime={entry.startAt}>{calendarTime(entry.startAt, entry.timeZone)}<small>{entry.timeZone}</small></time>
        <span><strong>{entry.title}</strong><span>{entry.participants.join(" · ")}</span>{entry.location ? <small>{entry.location}</small> : null}</span><span className="cove-calendar-status">{calendarStatus[entry.status]}</span>
      </button>)}
      {!calendar.loading && !calendar.error && calendar.value?.total === 0 ? <div className="cove-calendar-empty"><CalendarDays size={32} /><h2>留一点空白给自己</h2><p>这段时间没有安排。告诉 Cove 谁要在什么时候做什么，它会帮你记下来。</p></div> : null}
      {calendar.value && (calendar.offset > 0 || calendar.value.hasMore) ? <div className="cove-calendar-pager"><Button disabled={calendar.offset === 0} onClick={() => calendar.setOffset(Math.max(0, calendar.offset - 50))}>上一页</Button><span>{calendar.offset + 1}–{calendar.offset + calendar.value.items.length} / {calendar.value.total}</span><Button disabled={!calendar.value.hasMore} onClick={() => calendar.setOffset(calendar.offset + 50)}>下一页</Button></div> : null}
    </section><aside className="cove-calendar-sidebar">{calendar.selectedId ? <CalendarDetail id={calendar.selectedId} key={calendar.selectedId} /> : <div className="cove-calendar-note"><span>COVE · YOUR TIME</span><h2>安排清楚，<br />从容跟进。</h2><p>选择一项日程，查看完整安排和 Cove 的跟进记录。</p><p>需要新增、调整安排或一张日程海报，直接告诉 Cove。</p></div>}</aside></div>
  </PageSurface>;
}
