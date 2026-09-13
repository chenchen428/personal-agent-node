"use client";

import { OccurrencePlanLinks } from "../plans/occurrence-plan-links";
import { useState } from "react";
import { useClientResource } from "@/lib/use-client-resource";
import { calendarStatus, calendarTime, calendarField, calendarChange, type CalendarEntry, type CalendarHistory, type CalendarResult } from "../calendar/data";

export function CalendarDetail({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const result = useClientResource<{ entry: CalendarEntry }>(`/api/calendar/${encodeURIComponent(id)}`);
  const history = useClientResource<CalendarResult<CalendarHistory>>(`/api/calendar/${encodeURIComponent(id)}/history?limit=20&offset=${offset}`);
  const entry = result.value?.entry;
  return <section className="cove-calendar-detail" aria-label="日程详情">
    {result.error ? <p role="alert">{result.error}<button onClick={() => void result.refresh()}>重新加载</button></p> : null}
    {result.loading ? <p role="status">正在读取安排…</p> : null}
    {entry ? <><span className="cove-calendar-status">{calendarStatus[entry.status]}</span><h2>{entry.title}</h2><dl><dt>参与人</dt><dd>{entry.participants.join("、")}</dd><dt>时间</dt><dd>{calendarTime(entry.startAt, entry.timeZone)}{entry.endAt ? ` — ${calendarTime(entry.endAt, entry.timeZone)}` : ""}<small>{entry.timeZone}</small></dd>{entry.location ? <><dt>地点</dt><dd>{entry.location}</dd></> : null}{entry.nextFollowUpAt ? <><dt>下次跟进</dt><dd>{calendarTime(entry.nextFollowUpAt, entry.timeZone)}</dd></> : null}</dl>{entry.notes ? <p className="cove-calendar-notes">{entry.notes}</p> : null}</> : null}
    {entry ? <OccurrencePlanLinks entry={entry} /> : null}<h3>记录与跟进</h3>{history.error ? <p role="alert">{history.error}<button onClick={() => void history.refresh()}>重试</button></p> : null}
    <ol className="cove-calendar-history">{history.value?.items.map((item) => <li key={item.id}><span>{item.actor} · {calendarTime(item.createdAt)}</span><p>{item.content || ({ create: "记录了这项安排", update: "更新了安排", "follow-up": "跟进了安排" }[item.action] || "更新了记录")}</p>{Object.keys(item.changes).length ? <details><summary>查看变更</summary>{Object.entries(item.changes).map(([field, change]) => <p key={field}>{calendarField[field] || field}: {calendarChange(change.before, field)} → {calendarChange(change.after, field)}</p>)}</details> : null}</li>)}</ol>
    {offset > 0 ? <button onClick={() => setOffset(Math.max(0, offset - 20))}>较新记录</button> : null}{history.value?.hasMore ? <button onClick={() => setOffset(offset + 20)}>更早记录</button> : null}
  </section>;
}
