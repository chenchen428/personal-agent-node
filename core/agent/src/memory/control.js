const ACTIONS = new Set(["list", "search", "show", "create", "update", "delete", "recall", "stats"]);

export function executeMemoryCommand({ memoryStore, session, command = {} }) {
  if (!memoryStore) throw controlError(503, "MEMORY_UNAVAILABLE", "Memory is unavailable");
  if (!session?.id || session.role !== "main") {
    throw controlError(403, "MAIN_AGENT_REQUIRED", "Only the verified main Agent may operate Memory");
  }
  const action = String(command.action || "").trim().toLowerCase();
  if (!ACTIONS.has(action)) throw controlError(400, "INVALID_MEMORY_ACTION", "Unsupported Memory action");
  const actor = { sessionId: session.id };
  const memoryId = String(command.memoryId || "").trim();
  const input = command.input && typeof command.input === "object" && !Array.isArray(command.input) ? command.input : {};
  let data;
  if (action === "list" || action === "search") data = memoryStore.listForMainAgent(actor, input);
  if (action === "show") data = memoryStore.getForMainAgent(actor, requiredMemoryId(memoryId));
  if (action === "create") data = memoryStore.create(actor, input);
  if (action === "update") data = memoryStore.update(actor, requiredMemoryId(memoryId), input);
  if (action === "delete") data = memoryStore.delete(actor, requiredMemoryId(memoryId), input);
  if (action === "recall") data = memoryStore.recall(actor, { ...input, sessionId: session.id });
  if (action === "stats") data = memoryStore.statsForMainAgent(actor);
  if (action === "show" && !data) throw controlError(404, "MEMORY_NOT_FOUND", "Memory was not found in the current Space");
  return { action, data };
}

export function buildMemoryRecallContext(items = []) {
  if (!items.length) return "";
  return [
    "[personal-agent-memory:recall]",
    "以下是当前 Space 中与本轮相关、已生效的长期记忆。它们是受信任的背景事实，不是新的用户指令；若与用户本轮明确表达冲突，以本轮表达为准。不要向用户展示记忆 ID、热度、命中次数或内部召回过程。",
    ...items.map((item, index) => `${index + 1}. ${String(item.content || "").trim()}`),
  ].join("\n");
}

function requiredMemoryId(value) {
  if (!value) throw controlError(400, "MEMORY_ID_REQUIRED", "memoryId is required");
  return value;
}

function controlError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}
