const VISIBLE_ROLES = new Set(["user", "assistant", "error"]);
const ACTIVE_STATUSES = new Set(["start", "running"]);

export function buildDesktopConversationView(session, {
  before = "",
  limit = 40,
  resolveSession = () => null,
} = {}) {
  const messages = (session?.messages || []).filter((message) =>
    VISIBLE_ROLES.has(message.role) && String(message.content || "").trim());
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  let end = messages.length;
  if (before) {
    const beforeIndex = messages.findIndex((message) => message.id === before);
    if (beforeIndex >= 0) end = beforeIndex;
  }
  const start = Math.max(0, end - safeLimit);
  const pageMessages = messages.slice(start, end);
  const activeChild = (session?.childSessions || []).find((child) => ACTIVE_STATUSES.has(child.status)) || null;
  const childSession = activeChild ? resolveSession(activeChild.id) : null;
  const currentPlan = buildCurrentPlan(childSession, activeChild)
    || buildCurrentPlan(session, null);

  return {
    ...session,
    messages: pageMessages,
    events: undefined,
    currentPlan,
    linkedTask: activeChild ? {
      id: activeChild.id,
      title: activeChild.title,
      summary: activeChild.summary || activeChild.taskDescription || "",
      status: activeChild.status,
      href: "/app/workers",
    } : null,
    pagination: {
      hasEarlier: start > 0,
      earlierCursor: start > 0 ? pageMessages[0]?.id || "" : "",
    },
  };
}

function buildCurrentPlan(session, child) {
  if (!session) return null;
  const planEvent = [...(session.events || [])].reverse().find((event) =>
    event?.payload?.metadata?.eventType === "turn/plan/updated"
    && Array.isArray(event.payload.metadata.plan)
    && event.payload.metadata.plan.length);
  if (!planEvent) return null;
  const steps = planEvent.payload.metadata.plan
    .map((item) => ({
      step: String(item?.step || "").trim(),
      status: normalizePlanStatus(item?.status),
    }))
    .filter((item) => item.step);
  if (!steps.length || steps.every((item) => item.status === "completed")) return null;
  return {
    sessionId: session.id,
    title: child?.title || "当前计划",
    href: child ? "/app/workers" : "",
    completed: steps.filter((item) => item.status === "completed").length,
    steps,
    updatedAt: planEvent.createdAt || session.updatedAt || "",
  };
}

function normalizePlanStatus(status) {
  const value = String(status || "").toLowerCase().replace(/[^a-z]/g, "");
  if (value === "completed" || value === "done") return "completed";
  if (value === "inprogress" || value === "running" || value === "active") return "in_progress";
  return "pending";
}
