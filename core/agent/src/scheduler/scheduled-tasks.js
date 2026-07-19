const DEFAULT_TICK_MS = 15_000;
const MAX_SCAN_MINUTES = 366 * 24 * 60;
const TIMEZONE_FORMATTERS = new Map();
export const MINIMUM_CRON_INTERVAL_MINUTES = 15;

export class ScheduledTaskRunner {
  constructor({ store, broker, channels = {}, logger = console, tickMs = DEFAULT_TICK_MS } = {}) {
    this.store = store;
    this.broker = broker;
    this.channels = channels;
    this.logger = logger;
    this.tickMs = tickMs;
    this.timer = null;
    this.running = new Set();
  }

  start() {
    if (this.timer) return;
    this.ensureNextRuns();
    this.timer = setInterval(() => this.tick().catch((error) => {
      this.logger.error?.(`[scheduled-tasks] tick failed: ${error.message}`);
    }), this.tickMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  ensureNextRuns(now = new Date()) {
    for (const task of this.store.listScheduledTasks({ enabled: true })) {
      try {
        assertMinimumCronInterval(task.cron);
      } catch (error) {
        this.store.updateScheduledTask(task.id, {
          enabled: false,
          nextRunAt: null,
          lastError: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (task.nextRunAt) continue;
      this.store.updateScheduledTask(task.id, { nextRunAt: nextRunAt(task.cron, now, task.timezone).toISOString() });
    }
  }

  async tick(now = new Date()) {
    this.ensureNextRuns(now);
    const due = this.store.listScheduledTasks({ enabled: true })
      .filter((task) => task.nextRunAt && new Date(task.nextRunAt).getTime() <= now.getTime());
    for (const task of due) {
      await this.trigger(task.id, { now }).catch((error) => {
        this.store.updateScheduledTask(task.id, {
          lastError: error.message,
          nextRunAt: nextRunAt(task.cron, now, task.timezone).toISOString(),
        });
        this.logger.error?.(`[scheduled-tasks] ${task.id} failed: ${error.message}`);
      });
    }
  }

  async trigger(taskId, { now = new Date(), manual = false } = {}) {
    if (this.running.has(taskId)) return { skipped: true, reason: "already running" };
    const task = this.store.getScheduledTask(taskId);
    if (!task) throw new Error("scheduled task not found");
    if (!task.enabled && !manual) return { skipped: true, reason: "disabled" };

    this.running.add(taskId);
    try {
      const session = this.broker.createBrokerSession({
        action: "new",
        role: "worker",
        workspaceName: task.workspaceName,
        workspaceRoot: task.workspaceRoot,
        title: `自动化：${task.name}`,
        taskDescription: scheduledPrompt(task, now),
      });

      const recipientId = task.recipientId
        || this.store.getLastWechatRecipient()
        || this.channels.wechat?.getDefaultRecipientId?.()
        || "";
      if (recipientId && !this.store.getLastWechatRecipient()) {
        this.store.setLastWechatRecipient(recipientId);
      }
      const notification = {
        attempted: Boolean(recipientId),
        sent: false,
        recipientId: recipientId || "",
        error: "",
      };
      if (recipientId) {
        if (typeof this.channels.wechat?.sendText !== "function") {
          notification.error = "The WeChat channel is unavailable.";
          this.logger.error?.(`[scheduled-tasks] ${notification.error}`);
        } else {
          try {
            await this.channels.wechat.sendText(recipientId, [
              `自动化已触发：${task.name}`,
              `计划：${task.cron}`,
              `会话：${session.url}`,
            ].join("\n"));
            notification.sent = true;
          } catch (error) {
            notification.error = error instanceof Error ? error.message : String(error);
            this.logger.error?.(`[scheduled-tasks] wechat notify failed: ${notification.error}`);
          }
        }
      } else {
        notification.error = "No WeChat recipient is available. Receive a WeChat message first or set recipientId on the task.";
        this.logger.error?.(`[scheduled-tasks] ${notification.error}`);
      }

      const result = await this.broker.dispatchSessionAction(session.id, {
        action: "send",
        workspaceName: task.workspaceName,
        workspaceRoot: task.workspaceRoot,
        content: scheduledPrompt(task, now),
      });

      const next = task.enabled ? nextRunAt(task.cron, now, task.timezone).toISOString() : null;
      const updated = this.store.updateScheduledTask(task.id, {
        nextRunAt: next,
        lastRunAt: now.toISOString(),
        lastSessionId: session.id,
        runCount: task.runCount + 1,
        lastError: notification.error,
      });
      return { task: updated, session, command: result.command, delivered: result.delivered, notification };
    } finally {
      this.running.delete(taskId);
    }
  }
}

export function scheduledPrompt(task, now = new Date()) {
  return [
    "这是 Personal Agent 自动化的定时计划触发的新任务。",
    `任务名称：${task.name}`,
    `计划：${task.cron}`,
    `时区：${task.timezone}`,
    `触发时间：${now.toISOString()}`,
    "",
    task.prompt,
  ].join("\n");
}

export function nextRunAt(expression, from = new Date(), timezone = "local") {
  const schedule = parseCronExpression(expression);
  const normalizedTimezone = normalizeTimezone(timezone);
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < MAX_SCAN_MINUTES; i += 1) {
    if (matchesCron(schedule, cursor, normalizedTimezone)) return cursor;
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  throw new Error(`cron does not produce a run within ${MAX_SCAN_MINUTES} minutes`);
}

export function parseCronExpression(expression) {
  const normalized = String(expression || "").trim();
  const aliases = {
    "@hourly": "0 * * * *",
    "@daily": "0 9 * * *",
    "@weekly": "0 9 * * 1",
    "@monthly": "0 9 1 * *",
  };
  const cron = aliases[normalized] || normalized;
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) throw new Error("cron must have 5 fields: minute hour day month weekday");
  const [minute, hour, day, month, weekday] = parts;
  return {
    source: normalized,
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    day: parseField(day, 1, 31),
    month: parseField(month, 1, 12),
    weekday: parseField(weekday, 0, 7).map((value) => value === 7 ? 0 : value),
    dayWildcard: day.startsWith("*"),
    weekdayWildcard: weekday.startsWith("*"),
  };
}

export function normalizeTimezone(timezone = "local") {
  const normalized = String(timezone || "local").trim() || "local";
  if (normalized === "local") return normalized;
  try {
    timezoneFormatter(normalized);
  } catch {
    throw new Error(`invalid IANA timezone: ${normalized}`);
  }
  return normalized;
}

export function assertMinimumCronInterval(expression, minimumMinutes = MINIMUM_CRON_INTERVAL_MINUTES) {
  const schedule = parseCronExpression(expression);
  const minimum = Number(minimumMinutes);
  if (!Number.isFinite(minimum) || minimum <= 0) throw new Error("minimum cron interval must be positive");
  const times = [];
  for (const hour of schedule.hour) {
    for (const minute of schedule.minute) times.push(hour * 60 + minute);
  }
  times.sort((left, right) => left - right);
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] - times[index - 1] < minimum) throw minimumIntervalError(minimum);
  }
  const overnightGap = 24 * 60 - times.at(-1) + times[0];
  if (overnightGap < minimum && canMatchConsecutiveDays(schedule)) throw minimumIntervalError(minimum);
  return schedule;
}

function matchesCron(schedule, date, timezone) {
  const parts = dateParts(date, timezone);
  return schedule.minute.includes(parts.minute)
    && schedule.hour.includes(parts.hour)
    && matchesCalendarDay(schedule, parts.day, parts.weekday)
    && schedule.month.includes(parts.month);
}

function matchesCalendarDay(schedule, day, weekday) {
  const dayMatches = schedule.day.includes(day);
  const weekdayMatches = schedule.weekday.includes(weekday);
  if (schedule.dayWildcard) return weekdayMatches;
  if (schedule.weekdayWildcard) return dayMatches;
  return dayMatches || weekdayMatches;
}

function canMatchConsecutiveDays(schedule) {
  const date = new Date(Date.UTC(2024, 0, 1));
  const end = Date.UTC(2033, 0, 1);
  let previousMatched = false;
  while (date.getTime() < end) {
    const matched = schedule.month.includes(date.getUTCMonth() + 1)
      && matchesCalendarDay(schedule, date.getUTCDate(), date.getUTCDay());
    if (matched && previousMatched) return true;
    previousMatched = matched;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return false;
}

function minimumIntervalError(minimum) {
  return new Error(`cron interval must be at least ${minimum} minutes`);
}

function dateParts(date, timezone) {
  if (timezone === "local") {
    return {
      minute: date.getMinutes(),
      hour: date.getHours(),
      day: date.getDate(),
      month: date.getMonth() + 1,
      weekday: date.getDay(),
    };
  }
  const values = Object.fromEntries(timezoneFormatter(timezone).formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return {
    minute: Number(values.minute),
    hour: Number(values.hour),
    day,
    month,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function timezoneFormatter(timezone) {
  let formatter = TIMEZONE_FORMATTERS.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatter.format(new Date(0));
    TIMEZONE_FORMATTERS.set(timezone, formatter);
  }
  return formatter;
}

function parseField(value, min, max) {
  const result = new Set();
  for (const rawPart of String(value || "").split(",")) {
    const part = rawPart.trim();
    if (!part) throw new Error("empty cron field");
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid cron step: ${part}`);
    const [start, end] = parseRange(rangePart, min, max);
    for (let current = start; current <= end; current += step) result.add(current);
  }
  const values = Array.from(result).sort((a, b) => a - b);
  if (!values.length) throw new Error(`empty cron values: ${value}`);
  return values;
}

function parseRange(value, min, max) {
  if (value === "*") return [min, max];
  if (value.includes("-")) {
    const [left, right] = value.split("-").map(Number);
    assertInRange(left, min, max, value);
    assertInRange(right, min, max, value);
    if (left > right) throw new Error(`invalid cron range: ${value}`);
    return [left, right];
  }
  const single = Number(value);
  assertInRange(single, min, max, value);
  return [single, single];
}

function assertInRange(value, min, max, raw) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`cron value out of range: ${raw}`);
}
