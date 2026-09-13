"use client";

import React from "react";
import type { CalendarEntry, CalendarUpcoming } from "./data";
import { calendarTime } from "./view";

export function CalendarUpcomingSummary({ value, loading, error, staleError, onSelect, onRetry }: {
  value: CalendarUpcoming | null; loading: boolean; error: string; staleError: string;
  onSelect: (id: string) => void; onRetry: () => void;
}) {
  return <section className="calendar-upcoming-summary" aria-label="最近的日程">
    {error ? <p role="alert">暂时无法确认最近的日程。{error}<button onClick={onRetry}>重新查询</button></p> : null}
    {loading ? <p role="status">正在查询最近的日程…</p> : null}
    {staleError ? <p role="alert">日程更新失败，以下为上次查询结果。<button onClick={onRetry}>重新查询</button></p> : null}
    {value ? <>
      {value.ongoingEntry ? <SummaryEntry label="进行中的安排" entry={value.ongoingEntry} onSelect={onSelect} /> : null}
      {value.nextEntry ? <SummaryEntry label="下一次日程" entry={value.nextEntry} onSelect={onSelect} />
        : <p>{value.ongoingEntry ? "之后暂时没有新的日程。" : "暂无即将到来的日程。"}</p>}
    </> : null}
  </section>;
}

function SummaryEntry({ label, entry, onSelect }: { label: string; entry: CalendarEntry; onSelect: (id: string) => void }) {
  return <button type="button" className="calendar-upcoming-entry" onClick={() => onSelect(entry.id)}>
    <span>{label}</span><strong>{entry.title}</strong>
    <time dateTime={entry.startAt}>{calendarTime(entry.startAt, entry.timeZone)} · {entry.timeZone}</time>
    {entry.participants.length ? <small>{entry.participants.join(" · ")}</small> : null}
  </button>;
}
