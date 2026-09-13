import { parseCronExpression } from "../scheduler/scheduled-tasks.js";

const DAY = 86_400_000;
const formatters = new Map();
export function localParts(value, timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(new Date(value)).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
function civilMs(parts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour || 0, parts.minute || 0, parts.second || 0, 0);
  return date.getTime();
}

// Nonexistent clocks are skipped. A repeated autumn clock uses the earlier instant,
// making the occurrence identity deterministic across restarts and tz offsets.
export function zonedInstant(parts, zone, milliseconds = 0) {
  const target = civilMs(parts), offsets = new Set();
  for (const delta of [-DAY, 0, DAY]) {
    const probe = target + delta;
    offsets.add(civilMs(localParts(probe, zone)) - probe);
  }
  const matches = [...offsets].map(offset => target - offset).filter(value => civilMs(localParts(value, zone)) === target);
  return matches.length ? Math.min(...matches) + milliseconds : null;
}
function dateParts(dayMs) {
  const date = new Date(dayMs);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), weekday: date.getUTCDay() };
}
function cronDay(rule, day) {
  const dom = rule.day.includes(day.day), dow = rule.weekday.includes(day.weekday);
  return rule.month.includes(day.month) && (rule.dayWildcard ? dow : rule.weekdayWildcard ? dom : dom || dow);
}

function context(plan) {
  const seedMs = Date.parse(plan.startAt), seed = localParts(seedMs, plan.timeZone);
  const seedDay = civilMs({ ...seed, hour: 0, minute: 0, second: 0 });
  const rule = plan.recurrence;
  return { seedMs, seed, seedDay, rule, cron: rule?.frequency === "cron" ? parseCronExpression(rule.expression) : null };
}
function dayMatches(ctx, dayMs, day) {
  const { seed, seedDay, rule, cron } = ctx;
  if (cron) return cronDay(cron, day);
  const interval = rule.interval || 1;
  if (rule.frequency === "daily") return Math.round((dayMs - seedDay) / DAY) % interval === 0;
  if (rule.frequency === "weekly") {
    const seedWeekday = new Date(seedDay).getUTCDay();
    const week = Math.floor((dayMs - seedDay + ((seedWeekday + 6) % 7) * DAY) / (7 * DAY));
    return week % interval === 0 && (rule.weekdays || [seedWeekday]).includes(day.weekday);
  }
  if (rule.frequency === "monthly") return day.day === seed.day && ((day.year - seed.year) * 12 + day.month - seed.month) % interval === 0;
  return day.month === seed.month && day.day === seed.day && (day.year - seed.year) % interval === 0;
}
function* candidatesForDay(ctx, plan, dayMs, reverse = false) {
  const day = dateParts(dayMs);
  if (!dayMatches(ctx, dayMs, day)) return;
  const hours = ctx.cron ? ctx.cron.hour : [ctx.seed.hour];
  const minutes = ctx.cron ? ctx.cron.minute : [ctx.seed.minute];
  const values = [];
  for (const hour of hours) for (const minute of minutes) {
    const value = zonedInstant({ ...day, hour, minute, second: ctx.cron ? 0 : ctx.seed.second }, plan.timeZone, ctx.cron ? 0 : ((ctx.seedMs % 1000) + 1000) % 1000);
    if (value !== null && value >= ctx.seedMs) values.push(value);
  }
  values.sort((a, b) => reverse ? b - a : a - b);
  yield* values;
}
function localDay(value, zone) { return civilMs({ ...localParts(value, zone), hour: 0, minute: 0, second: 0 }); }

// Infinite series are lazy. Callers without an end bound consume only the next
// occurrence, rather than imposing an arbitrary seven-day or one-year horizon.
export function* occurrences(plan, { from = plan.startAt, to, limit = Infinity } = {}) {
  const ctx = context(plan), fromMs = Date.parse(from), toMs = to ? Date.parse(to) : Date.UTC(9999, 11, 31, 23, 59, 59);
  if (!ctx.rule) { if (ctx.seedMs >= fromMs && ctx.seedMs < toMs && limit > 0) yield plan.startAt; return; }
  const until = ctx.rule.until ? Date.parse(ctx.rule.until) : Infinity;
  let count = 0, emitted = 0;
  // A count bound counts all valid civil occurrences since DTSTART, including
  // exceptions. Cancelled and moved instances never extend the series.
  let day = ctx.rule.count ? ctx.seedDay : Math.max(ctx.seedDay, localDay(fromMs, plan.timeZone) - DAY);
  const lastDay = Math.min(localDay(Math.min(toMs, until), plan.timeZone) + DAY, Date.UTC(9999, 11, 31));
  for (; day <= lastDay; day += DAY) {
    for (const value of candidatesForDay(ctx, plan, day)) {
      if (value > until || value >= toMs) continue;
      count++;
      if (ctx.rule.count && count > ctx.rule.count) return;
      if (value >= fromMs) { yield new Date(value).toISOString(); if (++emitted >= limit) return; }
    }
  }
}

export function latestOccurrence(plan, before, from = plan.startAt) {
  const ctx = context(plan), fromMs = Math.max(Date.parse(from), ctx.seedMs);
  let bound = Date.parse(before);
  if (!ctx.rule) return ctx.seedMs <= bound && ctx.seedMs >= fromMs ? plan.startAt : null;
  if (ctx.rule.until) bound = Math.min(bound, Date.parse(ctx.rule.until));
  if (ctx.rule.count) {
    let latest = null;
    for (const at of occurrences(plan, { from, to: new Date(bound + 1).toISOString() })) latest = at;
    return latest;
  }
  for (let day = localDay(bound, plan.timeZone); day >= Math.max(ctx.seedDay, localDay(fromMs, plan.timeZone)); day -= DAY) {
    for (const value of candidatesForDay(ctx, plan, day, true)) if (value <= bound && value >= fromMs) return new Date(value).toISOString();
  }
  return null;
}

export function isOccurrence(plan, at) {
  return occurrences(plan, { from: at, to: new Date(Date.parse(at) + 1).toISOString(), limit: 1 }).next().value === at;
}
