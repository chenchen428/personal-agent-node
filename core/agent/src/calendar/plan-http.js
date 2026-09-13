import { calendarError, objectFields } from "./validation.js";
import { assertMinimumCronInterval, nextRunAt, normalizeTimezone } from "../scheduler/scheduled-tasks.js";
import { nextForPlan } from "./plan-projection.js";

// Called only after the shared HTTP authentication boundary. No browser mutation
// capability is accepted here; the internal command endpoint verifies the turn.
export function readPlanRequest(calendarStore, pathname, searchParams = new URLSearchParams()) {
  const input = Object.fromEntries(searchParams.entries());
  for (const key of ["limit", "offset"]) if (input[key] !== undefined) input[key] = Number(input[key]);
  if (input.enabled !== undefined) {
    if (!["true", "false", "1", "0"].includes(input.enabled)) throw calendarError(400, "INVALID_PLAN_ENABLED", "enabled必须为布尔值");
    input.enabled = input.enabled === "true" || input.enabled === "1";
  }
  if (pathname === "/api/plans") return calendarStore.listPlans(input);
  if (pathname === "/api/plans/runs") return calendarStore.listRuns(input);
  const match = /^\/api\/plans\/([^/]+)(?:\/(runs|history))?$/.exec(pathname);
  if (!match) throw calendarError(404, "PLAN_NOT_FOUND", "计划不存在");
  const planId = decodeURIComponent(match[1]);
  calendarStore.requirePlan(planId);
  if (match[2] === "runs") return calendarStore.listRuns({ ...input, planId });
  if (match[2] === "history") return calendarStore.history(planId, input);
  objectFields(input, []);
  return { plan: planDetail(calendarStore, planId) };
}

export function planDetail(calendarStore, planId) {
  const plan = calendarStore.requirePlan(planId);
  return { ...plan,
    nextOccurrenceAt: plan.enabled && ["planned", "in_progress"].includes(plan.status) ? nextForPlan(calendarStore, plan, calendarStore.nowIso())?.startAt || null : null,
    latestRun: calendarStore.listRuns({ planId, limit: 1 }).items[0] || null,
  };
}

export function legacyTaskFromPlan(plan, calendarStore) {
  const run = plan.latestRun || calendarStore.listRuns({ planId: plan.id, limit: 1 }).items[0];
  const importedRunCount = plan.legacy?.importedRunCount ?? (plan.legacy?.lastRunAt && plan.legacy?.lastSessionId ? 1 : 0);
  const historicCount = Math.max(Number(plan.legacy?.runCount || 0), importedRunCount);
  return {
    ...(plan.legacy || {}), id: plan.id, planId: plan.id, name: plan.title,
    cron: plan.recurrence?.expression || plan.recurrence?.cron || plan.legacy?.cron || "", timezone: plan.timeZone,
    prompt: plan.executionPrompt, ...plan.executionContext, enabled: plan.enabled && plan.status !== "cancelled",
    nextRunAt: plan.nextOccurrenceAt === undefined ? planDetail(calendarStore, plan.id).nextOccurrenceAt : plan.nextOccurrenceAt,
    lastRunAt: run?.createdAt || plan.legacy?.lastRunAt || null,
    lastSessionId: run?.sessionId || plan.legacy?.lastSessionId || null,
    runCount: historicCount + Math.max(0, calendarStore.listRuns({ planId: plan.id, limit: 1 }).total - importedRunCount),
    lastError: run?.error || "", revision: plan.revision, executionMode: plan.executionMode,
    createdAt: plan.createdAt, updatedAt: plan.updatedAt,
  };
}

export function legacyTaskInput(body, current = null, defaultTimezone = "local") {
  objectFields(body, ["name", "cron", "schedule", "timezone", "prompt", "taskDescription", "content", "workspaceName", "workspace", "workspaceRoot", "recipientId", "recipient_id", "enabled", "expectedRevision"]);
  const cron = String(body.cron ?? body.schedule ?? current?.recurrence?.expression ?? current?.recurrence?.cron ?? current?.legacy?.cron ?? "").trim();
  assertMinimumCronInterval(cron);
  const zone = normalizeTimezone(body.timezone || current?.timeZone || defaultTimezone);
  const timeZone = zone === "local" ? Intl.DateTimeFormat().resolvedOptions().timeZone : zone;
  const context = current?.executionContext || {};
  const executionContext = {
    workspaceName: String(body.workspaceName ?? body.workspace ?? context.workspaceName ?? ""),
    workspaceRoot: String(body.workspaceRoot ?? context.workspaceRoot ?? ""),
    recipientId: String(body.recipientId ?? body.recipient_id ?? context.recipientId ?? ""),
  };
  return {
    title: body.name ?? current?.title,
    recurrence: { frequency: "cron", expression: cron, interval: 1 }, timeZone,
    executionMode: current?.executionMode || "execute",
    executionPrompt: body.prompt ?? body.taskDescription ?? body.content ?? current?.executionPrompt,
    executionContext,
    enabled: body.enabled === undefined ? current?.enabled ?? true : ![false, 0, "0", "false"].includes(body.enabled),
    ...(current ? { expectedRevision: body.expectedRevision ?? current.revision }
      : { startAt: nextRunAt(cron, new Date(), timeZone).toISOString(), missedRunPolicy: "skip" }),
  };
}

export function listLegacyTasks(calendarStore) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const page = calendarStore.listPlans({ limit: 1000, offset });
    items.push(...page.items.filter((plan) => (plan.recurrence?.frequency === "cron" || plan.legacy?.id) && plan.status !== "cancelled")
      .map((plan) => legacyTaskFromPlan(plan, calendarStore)));
    if (!page.hasMore) return items;
  }
}
