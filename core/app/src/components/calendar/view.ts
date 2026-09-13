export type CalendarPeriod = "upcoming" | "day" | "week";
export type CalendarRange = { from: string; to: string } | null;

export function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function calendarTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(value));
}
export function calendarLink(params: URLSearchParams, now = new Date()) {
  const start = params.get("from"), end = params.get("to");
  const validStart = Boolean(start && Number.isFinite(Date.parse(start)));
  const linkedRange: CalendarRange = validStart && end && Date.parse(end) > Date.parse(start!)
    ? { from: new Date(start!).toISOString(), to: new Date(end).toISOString() } : null;
  const requested = params.get("period");
  const period: CalendarPeriod = linkedRange ? (requested === "week" ? "week" : "day")
    : requested === "week" || requested === "day" ? requested : validStart || ["done", "cancelled"].includes(params.get("status") || "") ? "day" : "upcoming";
  return { day: dateKey(validStart ? new Date(start!) : now), period, linkedRange };
}
export function calendarSearch({ day, period, linkedRange, offset, query, status }: {
  day: string; period: CalendarPeriod; linkedRange: CalendarRange; offset: number; query: string; status: string;
}) {
  const search = new URLSearchParams({ limit: "50", offset: String(offset) });
  if (period === "upcoming") search.set("view", "upcoming");
  else {
    const from = new Date(`${day}T00:00:00`), to = new Date(from);
    to.setDate(to.getDate() + (period === "week" ? 7 : 1));
    search.set("from", linkedRange?.from || from.toISOString());
    search.set("to", linkedRange?.to || to.toISOString());
  }
  if (query) search.set("query", query);
  if (status !== "all") search.set("status", status);
  return search;
}
