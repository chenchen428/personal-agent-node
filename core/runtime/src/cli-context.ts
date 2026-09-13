import path from "node:path";
import { getSpace } from "./space-registry.ts";
import { resolveNodeConfig } from "./config.ts";

/** Resolve only the installed command's registered Space, before loading secrets. */
export function bridgeCliEnvironment(env: NodeJS.ProcessEnv, selector = "") {
  const installationRoot = String(env.PERSONAL_AGENT_CLI_INSTALLATION_ROOT || "");
  if (!path.isAbsolute(installationRoot)) throw cliScopeError("CLI 安装入口无效。", "CLI_INSTALLATION_REQUIRED");
  const boundId = String(env.PERSONAL_AGENT_CLI_BOUND_SPACE_ID || "");
  const callerId = String(env.PERSONAL_AGENT_SPACE_ID || "");
  const callerRoot = String(env.PERSONAL_AGENT_SPACE_ROOT || "");
  const inTurn = Boolean(env.OPEN_AGENT_BRIDGE_SESSION_ID);
  if (inTurn && (!callerId || !callerRoot || !env.OPEN_AGENT_BRIDGE_API_TOKEN)) throw cliScopeError("当前 Agent 缺少完整空间执行身份，已拒绝执行。", "CLI_SPACE_CONTEXT_REQUIRED");
  const target = getSpace(installationRoot, selector || boundId || callerId || undefined);
  if (!target) throw cliScopeError("指定空间不存在。", "CLI_SPACE_NOT_FOUND");
  // A scoped wrapper must never turn another Agent's inherited token or mail
  // operation into a request for this Space. Reject before resolving its env.
  if ((boundId && target.id !== boundId) || ((boundId || inTurn) && callerId && callerId !== target.id)
    || ((boundId || inTurn) && callerRoot && path.resolve(callerRoot) !== path.resolve(target.root))) {
    throw cliScopeError("CLI 目标与当前 Agent 空间不一致，已拒绝执行。", "CLI_SPACE_MISMATCH");
  }
  const selectedEnv = { ...env };
  for (const key of Object.keys(selectedEnv)) {
    if (/^OPEN_AGENT_BRIDGE_/i.test(key) || /^PERSONAL_AGENT_SPACE_/i.test(key)
      || /^(?:PRIVATE_SITE_(?:DATA_ROOT|ENV_FILE|AGENT_WORKSPACE|GATEWAY_PORT)|SITE_DOMAIN)$/i.test(key)) delete selectedEnv[key];
  }
  const config = resolveNodeConfig({ ...selectedEnv, PERSONAL_AGENT_DATA_ROOT: installationRoot,
    PRIVATE_SITE_DATA_ROOT: target.root, PERSONAL_AGENT_SPACE_ID: target.id, PERSONAL_AGENT_SPACE_ROOT: target.root });
  if (config.space?.id !== target.id || path.resolve(config.dataRoot) !== path.resolve(target.root)) throw cliScopeError("CLI 空间身份不匹配。", "CLI_SPACE_MISMATCH");
  return { ...env,
    PERSONAL_AGENT_DATA_ROOT: installationRoot, PERSONAL_AGENT_SPACE_ID: target.id,
    PERSONAL_AGENT_SPACE_SLUG: target.slug, PERSONAL_AGENT_SPACE_KIND: target.kind, PERSONAL_AGENT_SPACE_ROOT: target.root,
    PRIVATE_SITE_DATA_ROOT: target.root, PRIVATE_SITE_ENV_FILE: config.envPath, OPEN_AGENT_BRIDGE_ENV_FILE: config.envPath,
    OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${config.ports.bridge}`,
    OPEN_AGENT_BRIDGE_PORT: String(config.ports.bridge), OPEN_AGENT_BRIDGE_MAIL_DATA_DIR: config.mailDir,
    OPEN_AGENT_BRIDGE_API_TOKEN: inTurn ? env.OPEN_AGENT_BRIDGE_API_TOKEN : config.env.OPEN_AGENT_BRIDGE_API_TOKEN || "",
    OPEN_AGENT_BRIDGE_UPLOAD_TOKEN: inTurn ? env.OPEN_AGENT_BRIDGE_UPLOAD_TOKEN || "" : config.env.OPEN_AGENT_BRIDGE_UPLOAD_TOKEN || "",
    OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN: inTurn ? env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN || "" : config.env.OPEN_AGENT_BRIDGE_MAIL_INGEST_TOKEN || "",
  };
}

function cliScopeError(message: string, code: string) { return Object.assign(new Error(message), { code }); }
