const WEEKDAYS: Record<string, string> = {
  "0": "日",
  "1": "一",
  "2": "二",
  "3": "三",
  "4": "四",
  "5": "五",
  "6": "六",
  "7": "日",
};

const CRON_ALIASES: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

export function describeCron(expression: string) {
  const cron = CRON_ALIASES[expression.trim().toLowerCase()] || expression.trim();
  const [minute, hour, day, month, weekday] = cron.split(/\s+/);
  if (!minute || !hour || !day || !month || !weekday) return expression;
  if (/^\*\/\d+$/.test(minute) && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return `每 ${minute.slice(2)} 分钟`;
  }
  if (!isClockPart(minute) || !isClockPart(hour) || month !== "*") return `Cron · ${expression}`;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (day === "*" && weekday === "*") return `每天 ${time}`;
  if (day === "*" && weekday === "1-5") return `每个工作日 ${time}`;
  if (day === "*" && WEEKDAYS[weekday]) return `每周${WEEKDAYS[weekday]} ${time}`;
  if (/^\d+$/.test(day) && weekday === "*") return `每月 ${Number(day)} 日 ${time}`;
  return `Cron · ${expression}`;
}

export function timezoneLabel(timezone: string) {
  if (timezone && timezone !== "local") return timezone;
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return local ? `本机时区（${local}）` : "本机时区";
}

export function formatScheduleDateTime(value: string | null, timezone: string, compact = false) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "等待计算";
  const options: Intl.DateTimeFormatOptions = compact
    ? { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
    : { year: "numeric", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false };
  const timeZone = timezone && timezone !== "local" ? timezone : undefined;
  try {
    return new Intl.DateTimeFormat("zh-CN", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("zh-CN", options).format(date);
  }
}

export function absoluteDateTime(value: string | null) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isClockPart(value: string) {
  return /^\d+$/.test(value);
}
