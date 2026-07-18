const VISIBLE_ROLES = new Set(["user", "assistant", "error"]);
const ACTIVE_STATUSES = new Set(["start", "running"]);

export function buildDesktopConversationView(input, {
  before = "",
  limit = 40,
  resolveSession = () => null,
} = {}) {
  const sessions = (Array.isArray(input) ? input : [input]).filter(Boolean);
  const session = sessions[0] || null;
  const messages = sessions.flatMap((sourceSession) => visibleConversationMessages(sourceSession)
    .map((message) => withConversationSource(message, sourceSession)))
    .sort(compareMessages);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 40));
  let end = messages.length;
  if (before) {
    const beforeIndex = messages.findIndex((message) => message.id === before);
    if (beforeIndex >= 0) end = beforeIndex;
  }
  const start = Math.max(0, end - safeLimit);
  const pageMessages = messages.slice(start, end);
  const activeChild = sessions.flatMap((sourceSession) => (sourceSession.childSessions || []).map((child) => ({
    ...child,
    parentSessionId: sourceSession.id,
  })))
    .filter((child) => ACTIVE_STATUSES.has(child.status))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0] || null;
  const childSession = activeChild ? resolveSession(activeChild.id) : null;
  const currentPlan = buildCurrentPlan(childSession, activeChild)
    || sessions.map((sourceSession) => buildCurrentPlan(sourceSession, null))
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0]
    || null;

  return {
    ...session,
    status: sessions.some((sourceSession) => ACTIVE_STATUSES.has(sourceSession.status)) ? "running" : session?.status,
    messages: pageMessages,
    events: undefined,
    childSessions: undefined,
    currentPlan,
    linkedTask: activeChild ? {
      id: activeChild.id,
      parentSessionId: activeChild.parentSessionId,
      title: activeChild.title,
      summary: activeChild.summary || activeChild.taskDescription || "",
      status: activeChild.status,
      href: taskDetailHref(activeChild.id),
    } : null,
    pagination: {
      hasEarlier: start > 0,
      earlierCursor: start > 0 ? pageMessages[0]?.id || "" : "",
    },
  };
}

function visibleConversationMessages(session) {
  const visible = (session.messages || []).filter((message) =>
    VISIBLE_ROLES.has(message.role)
    && !(message.role === "error" && message.metadata?.willRetry === true)
    && !isInternalAgentInput(message)
    && String(message.content || "").trim());
  if (normalizeChannel(session.channel) !== "wechat") return visible;

  const deduplicated = [];
  for (const message of visible) {
    const previous = deduplicated[deduplicated.length - 1];
    if (isLegacyWechatUserEcho(previous, message)) continue;
    deduplicated.push(message);
  }
  return deduplicated;
}

function isLegacyWechatUserEcho(previous, message) {
  if (!previous || previous.role !== "user" || message.role !== "user") return false;
  if (String(previous.content || "").trim() !== String(message.content || "").trim()) return false;
  if (hasExplicitWechatSource(previous) === hasExplicitWechatSource(message)) return false;
  const previousTime = Date.parse(previous.createdAt || "");
  const messageTime = Date.parse(message.createdAt || "");
  return Number.isFinite(previousTime)
    && Number.isFinite(messageTime)
    && Math.abs(messageTime - previousTime) <= 2_000;
}

function hasExplicitWechatSource(message) {
  return String(message.metadata?.channel || message.source || "").trim().toLowerCase() === "wechat";
}

function withConversationSource(message, session) {
  const channel = normalizeChannel(message.metadata?.channel || message.source || session.channel);
  return {
    ...message,
    sessionId: message.sessionId || session.id,
    metadata: {
      ...(message.metadata || {}),
      channel,
      sourceLabel: sourceLabel(channel),
    },
  };
}

function normalizeChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  if (channel === "wechat") return "wechat";
  if (channel === "desktop" || channel === "web") return "desktop";
  return "desktop";
}

function sourceLabel(channel) {
  if (channel === "wechat") return "来自微信";
  return "来自桌面";
}

function compareMessages(left, right) {
  if (!left.createdAt || !right.createdAt) return 0;
  return String(left.createdAt).localeCompare(String(right.createdAt));
}

function isInternalAgentInput(message) {
  if (message.role !== "user") return false;
  return /^\[(?:worker-hook|worker-recovery|activity-hook):/i.test(String(message.content || "").trim());
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
    href: child ? taskDetailHref(child.id) : "",
    completed: steps.filter((item) => item.status === "completed").length,
    steps,
    updatedAt: planEvent.createdAt || session.updatedAt || "",
  };
}

function taskDetailHref(sessionId) {
  return `/app/workers?task=${encodeURIComponent(String(sessionId || ""))}`;
}

function normalizePlanStatus(status) {
  const value = String(status || "").toLowerCase().replace(/[^a-z]/g, "");
  if (value === "completed" || value === "done") return "completed";
  if (value === "inprogress" || value === "running" || value === "active") return "in_progress";
  return "pending";
}
