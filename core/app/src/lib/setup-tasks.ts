export type SetupState = "ready" | "checking" | "action-required" | "blocked" | "not-selected";
export type SetupRequirement = "required-for-console" | "required-for-agent" | "conditional" | "optional";

export type SetupCheck = {
  id: string;
  group: string;
  requirement: SetupRequirement;
  state: SetupState;
  summary: string;
  why: string;
  guidance: string;
  actionIds?: string[];
};

export type SetupTask = {
  check: SetupCheck;
  actionId: string;
  title: string;
  category: string;
  waitingCount: number;
};

export type ManagedCloudAction = {
  state: "idle" | "starting" | "running" | "succeeded" | "failed" | "cancelled";
  phase: "idle" | "enrollment" | "resources" | "complete";
  code?: string;
  authorizationUrl?: string;
};

const requiredRequirements = new Set<SetupRequirement>(["required-for-console", "required-for-agent"]);
const categoryLabels: Record<string, string> = {
  installation: "本机安全",
  agent: "Codex Agent",
  connectivity: "公网与邮箱",
  "mail-identity": "Agent 邮箱",
  "local-mail": "本地邮件",
  connections: "可选连接",
};

const optionalTitles: Record<string, string> = {
  "mail.local-ingest": "接入自己的邮件来源",
};

export function canonicalSetupAction(id: string) {
  return ["connectivity.choose-mode", "connectivity.repair"].includes(id) ? "connectivity.managed-authorize" : id;
}

export function validateLocalPasswordInput(password: string, confirmation: string) {
  if (!password) return "请输入访问密码。";
  if (password.length < 12) return `密码至少需要 12 个字符，还差 ${12 - password.length} 个。`;
  if (!confirmation) return "请再次输入密码进行确认。";
  if (password !== confirmation) return "两次输入的密码不一致。";
  return "";
}

export function managedCloudActionMessage(action?: ManagedCloudAction) {
  if (action?.state === "cancelled") return "已取消本次页面验证，原有连接保持不变。";
  if (action?.state === "failed") return cloudFailureMessage(action.code);
  if (action?.phase === "resources") return "公网接入已确认，正在分配公网域名和 PA 邮箱。";
  if (["starting", "running"].includes(action?.state || "idle")) return "正在后台确认 Cloud 会话并分配公网域名，无需手动操作。";
  if (action?.state === "succeeded") return "后台连接已完成，正在刷新公网域名。";
  return "";
}

export function buildSetupTaskModel(checks: SetupCheck[]) {
  const requiredChecks = checks.filter((check) => requiredRequirements.has(check.requirement));
  const blockedChecks = requiredChecks.filter((check) => check.state === "blocked");
  const coreTasks = checks
    .filter((check) => requiredRequirements.has(check.requirement) && check.state === "action-required")
    .map((check) => toTask(check, blockedChecks));
  const onlineTask = buildOnlineIdentityTask(checks);
  const requiredTasks = [...coreTasks, ...(onlineTask ? [onlineTask] : [])];
  const onlineReady = !onlineTask;
  const optionalCandidates = [
    onlineReady ? checks.find((check) => check.group === "connectivity" && check.state === "action-required") : undefined,
    checks.find((check) => check.group === "local-mail" && check.state === "action-required")
      || checks.find((check) => check.id === "mail.local-ingest" && check.state === "not-selected"),
  ].filter(Boolean) as SetupCheck[];
  const actions = new Set<string>();
  const optionalTasks = optionalCandidates.flatMap((check) => {
    const task = toTask(check, [], optionalTitles[check.id] || (check.group === "connectivity" ? "恢复公网域名与 Agent 邮箱" : check.summary));
    if (!task.actionId || actions.has(task.actionId)) return [];
    actions.add(task.actionId);
    return [task];
  });
  const completedRequired = requiredChecks.filter((check) => check.state === "ready").length;

  return {
    requiredTasks,
    optionalTasks,
    requiredChecks,
    blockedChecks,
    onlineReady,
    completedRequired,
    totalRequired: requiredChecks.length,
    progress: requiredChecks.length ? Math.round((completedRequired / requiredChecks.length) * 100) : 0,
  };
}

function buildOnlineIdentityTask(checks: SetupCheck[]): SetupTask | null {
  const enrollment = checks.find((check) => check.id === "connectivity.enrollment");
  const mailIdentity = checks.find((check) => check.id === "mail.identity");
  if (!enrollment || !mailIdentity || (enrollment.state === "ready" && mailIdentity.state === "ready")) return null;
  const check: SetupCheck = {
    ...enrollment,
    id: "connectivity.public-and-mail",
    state: "action-required",
    summary: "验证公网域名与 Agent 邮箱",
    why: "一次统一引导完成这台 Node 的公网接入，并同步属于你的 Agent 邮箱身份。",
    guidance: "桌面端会在后台完成授权并继续检查公网域名与 Agent 邮箱；仅在静默失败后手动恢复。",
    actionIds: ["connectivity.managed-authorize"],
  };
  return toTask(check, [], check.summary);
}

function toTask(check: SetupCheck, blockedChecks: SetupCheck[], title = check.summary): SetupTask {
  const actionId = canonicalSetupAction(check.actionIds?.[0] || "");
  return {
    check,
    actionId,
    title,
    category: categoryLabels[check.group] || check.group,
    waitingCount: blockedChecks.filter((blocked) => blocked.group === check.group).length,
  };
}

function cloudFailureMessage(code = "") {
  const messages: Record<string, string> = {
    CLOUD_AUTH_DENIED: "页面验证已取消，请重新验证并确认这台电脑。",
    CLOUD_AUTH_EXPIRED: "页面验证已过期，请重新发起验证。",
    CLOUD_AUTH_FAILED: "Cloud 登录状态未通过，请确认 personal-agent.cn 已登录后重试。",
    CLOUD_NETWORK_UNREACHABLE: "无法连接 personal-agent.cn，请检查 DNS 或本机网络后重试。",
    CLOUD_REQUEST_FAILED: "Cloud 授权接口暂时未完成请求，请确认 Cloud 已发布最新版本后重试。",
    DEPENDENCY_UNAVAILABLE: "Cloud 授权服务暂时不可用，本机使用不受影响；请稍后重新验证。",
  };
  return messages[code] || "页面验证未完成，本机使用不受影响；请重新验证。";
}
