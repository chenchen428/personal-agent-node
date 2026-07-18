export const TASK_TITLE_MAX_LENGTH = 20;
export const TASK_DESCRIPTION_MAX_LENGTH = 100;

export function normalizeTaskCreate(input = {}) {
  const parentSessionId = normalizeSingleLine(input.parentSessionId);
  const title = normalizeSingleLine(input.title);
  const description = normalizeSingleLine(input.description ?? input.taskDescription);
  const task = String(input.task || "").trim();

  if (parentSessionId && !title) throw taskInputError("创建子任务时必须设置标题");
  if (parentSessionId && !description) throw taskInputError("创建子任务时必须设置描述");
  if (parentSessionId && !task) throw taskInputError("创建子任务时必须设置执行内容");
  if (parentSessionId) {
    validateTaskText(title, "任务标题", TASK_TITLE_MAX_LENGTH);
    validateTaskText(description, "任务描述", TASK_DESCRIPTION_MAX_LENGTH);
  }
  return { parentSessionId, title, description, task };
}

export function normalizeTaskPatch(input = {}) {
  const hasTitle = input.title !== undefined;
  const hasDescription = input.description !== undefined || input.taskDescription !== undefined;
  if (!hasTitle && !hasDescription) throw taskInputError("至少需要更新任务标题或描述");
  const title = hasTitle ? normalizeSingleLine(input.title) : undefined;
  const description = hasDescription ? normalizeSingleLine(input.description ?? input.taskDescription) : undefined;
  if (hasTitle && !title) throw taskInputError("任务标题不能为空");
  if (hasDescription && !description) throw taskInputError("任务描述不能为空");
  if (title !== undefined) validateTaskText(title, "任务标题", TASK_TITLE_MAX_LENGTH);
  if (description !== undefined) validateTaskText(description, "任务描述", TASK_DESCRIPTION_MAX_LENGTH);
  return { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { taskDescription: description } : {}) };
}

export function taskTextLength(value) {
  return Array.from(String(value || "")).length;
}

function normalizeSingleLine(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validateTaskText(value, label, maximum) {
  const length = taskTextLength(value);
  if (length > maximum) throw taskInputError(`${label}不能超过 ${maximum} 个字（当前 ${length} 个）`);
}

function taskInputError(message) {
  return Object.assign(new Error(message), { code: "TASK_METADATA_INVALID", statusCode: 400 });
}
