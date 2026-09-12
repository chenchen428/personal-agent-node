export const CALENDAR_STATUSES = new Set(["planned", "in_progress", "done", "cancelled"]);
export const ENTRY_FIELDS = ["title", "participants", "startAt", "endAt", "timeZone", "location", "notes", "nextFollowUpAt", "status"];

export function calendarError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function objectFields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw calendarError(400, "INVALID_CALENDAR_INPUT", "日程参数必须为对象");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw calendarError(400, "INVALID_CALENDAR_FIELD", `不支持的日程字段：${key}`);
  }
  return value;
}

export function textField(value, name, maximum, { optional = false, multiline = false } = {}) {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string") throw calendarError(400, "INVALID_CALENDAR_TEXT", `${name}必须为文本`);
  const text = value.normalize("NFC").trim();
  if ((!optional && !text) || [...text].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    || (!multiline && /[\r\n\t]/.test(text))) {
    throw calendarError(400, "INVALID_CALENDAR_TEXT", `${name}格式无效或超过${maximum}字`);
  }
  return text;
}

export function isoTime(value, name, { optional = false } = {}) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string") throw calendarError(400, "INVALID_CALENDAR_TIME", `${name}必须为带时区的ISO时间`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw calendarError(400, "INVALID_CALENDAR_TIME", `${name}必须为带时区的ISO时间`);
  const [, year, month, day, hour, minute, second = "0", , , , offsetHour = "0", offsetMinute = "0"] = match;
  const dayCheck = new Date(0);
  dayCheck.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  const parsed = new Date(value);
  if (Number(year) < 1 || dayCheck.getUTCFullYear() !== Number(year) || dayCheck.getUTCMonth() !== Number(month) - 1
    || dayCheck.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || Number(offsetHour) > 14 || Number(offsetMinute) > 59 || (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)
    || !Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 1 || parsed.getUTCFullYear() > 9999) {
    throw calendarError(400, "INVALID_CALENDAR_TIME", `${name}不是有效时间`);
  }
  return parsed.toISOString();
}

export function timeZoneField(value) {
  const timeZone = textField(value, "timeZone", 100);
  if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(timeZone)) throw calendarError(400, "INVALID_CALENDAR_TIME_ZONE", "必须指定有效IANA时区");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(0); }
  catch { throw calendarError(400, "INVALID_CALENDAR_TIME_ZONE", "必须指定有效IANA时区"); }
  return timeZone;
}

export function statusField(value) {
  if (!CALENDAR_STATUSES.has(value)) throw calendarError(400, "INVALID_CALENDAR_STATUS", "无效的日程状态");
  return value;
}

export function integerField(value, name, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw calendarError(400, "INVALID_CALENDAR_INTEGER", `${name}必须是${minimum}至${maximum}的整数`);
  }
  return value;
}

export function entryFields(input, current = null) {
  const next = {};
  const pick = (field, fallback) => input[field] !== undefined ? input[field] : current ? current[field] : fallback;
  next.title = textField(pick("title"), "title", 200);
  const participants = pick("participants", []);
  if (!Array.isArray(participants) || participants.length > 100) {
    throw calendarError(400, "INVALID_CALENDAR_PARTICIPANTS", "参与人必须是最多100人的文本数组");
  }
  next.participants = [...new Set(participants.map((person) => textField(person, "参与人", 120)))];
  next.startAt = isoTime(pick("startAt"), "startAt");
  next.endAt = isoTime(pick("endAt", null), "endAt", { optional: true });
  next.timeZone = timeZoneField(pick("timeZone"));
  next.location = textField(pick("location", ""), "location", 500, { optional: true });
  next.notes = textField(pick("notes", ""), "notes", 8_000, { optional: true, multiline: true });
  next.nextFollowUpAt = isoTime(pick("nextFollowUpAt", null), "nextFollowUpAt", { optional: true });
  next.status = statusField(pick("status", "planned"));
  if (next.endAt && next.endAt < next.startAt) throw calendarError(400, "INVALID_CALENDAR_RANGE", "结束时间不能早于开始时间");
  return next;
}

export function pagination(input = {}) {
  return {
    limit: integerField(input.limit, "limit", { minimum: 1, maximum: 1000, fallback: 100 }),
    offset: integerField(input.offset, "offset", { fallback: 0 }),
  };
}
