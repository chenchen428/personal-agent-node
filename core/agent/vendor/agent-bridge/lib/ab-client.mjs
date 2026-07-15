import { getJson, postJson, bucAuthHeaders } from './http.mjs';

/**
 * 主 Agent 的编排工具客户端：包装单机 Agent Bridge REST API。
 *
 * 这些函数是 `ab` 子命令的运行时，也是 worker 派发的实现。
 */

function options(config, extra = {}) {
  return { ...extra, headers: { ...bucAuthHeaders(config), ...(extra.headers ?? {}) } };
}

/** 列出本机工作区（含 routingTags / contextSummary）。 */
export async function listWorkspaces(config, deps = {}) {
  const json = await getJson(config.baseUrl, '/api/agent-bridge/workspaces', options(config, deps));
  return Array.isArray(json?.workspaces) ? json.workspaces : [];
}

/** 列出当前用户会话；可按 status 过滤。 */
export async function listSessions(config, { status, ...deps } = {}) {
  const json = await getJson(config.baseUrl, '/api/agent-bridge/sessions', options(config, deps));
  let all = Array.isArray(json?.sessions) ? json.sessions : [];
  if (status) all = all.filter((session) => session.status === status);
  return all;
}

/** 创建 worker 子会话记录（action:'new' 只落库，不入队 command；首轮执行由 send 触发）。 */
export async function startSession(config, { workspace, agentAlias, task, parentSessionId } = {}, deps = {}) {
  const json = await postJson(config.baseUrl, '/api/agent-bridge/sessions', {
    action: 'new',
    workspaceName: workspace,
    agentAlias,
    taskDescription: task,
    parentSessionId,
    role: 'worker',
  }, options(config, deps));
  return json?.session;
}

/** 给已有 worker 续发输入。 */
export async function sessionInput(config, { sessionId, text } = {}, deps = {}) {
  return postJson(config.baseUrl, `/api/agent-bridge/sessions/${encodeURIComponent(sessionId)}/actions`, {
    action: 'send',
    content: text,
  }, options(config, deps));
}

/** 查询会话状态/产出/待授权。 */
export async function sessionStatus(config, { sessionId } = {}, deps = {}) {
  return getJson(config.baseUrl, `/api/agent-bridge/sessions/${encodeURIComponent(sessionId)}`, options(config, deps));
}
