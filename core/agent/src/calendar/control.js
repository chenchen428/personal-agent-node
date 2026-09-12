import { calendarError, objectFields } from "./validation.js";

export function executeCalendarCommand({ calendarStore, session, command = {} }) {
  if (!calendarStore) throw calendarError(503, "CALENDAR_UNAVAILABLE", "日程暂不可用");
  if (!session?.id || session.role !== "main") throw calendarError(403, "MAIN_AGENT_REQUIRED", "仅已验证的主 Agent 可以操作日程");
  objectFields(command, ["action", "entryId", "input"]);
  const actor = { sessionId: session.id };
  calendarStore.requireMainAgent(actor);
  const action = command.action;
  const input = command.input === undefined ? {} : command.input;
  let data;
  if (action === "list") data = calendarStore.list(input);
  else if (action === "due") data = calendarStore.due(input);
  else if (action === "show") { objectFields(input, []); data = calendarStore.requireEntry(command.entryId); }
  else if (action === "history") data = calendarStore.history(command.entryId, input);
  else if (action === "create") data = calendarStore.create(actor, input);
  else if (action === "update") data = calendarStore.update(actor, command.entryId, input);
  else if (action === "follow-up") data = calendarStore.followUp(actor, command.entryId, input);
  else throw calendarError(400, "INVALID_CALENDAR_ACTION", "不支持的日程操作");
  return { action, data };
}
