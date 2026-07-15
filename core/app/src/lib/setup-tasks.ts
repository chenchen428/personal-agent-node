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

const requiredRequirements = new Set<SetupRequirement>(["required-for-console", "required-for-agent"]);
const categoryLabels: Record<string, string> = {
  installation: "本机安全",
  agent: "Codex Agent",
  connectivity: "公网与邮箱",
  "mail-identity": "Agent 邮箱",
  "local-mail": "本地邮件",
  "optional-channels": "扩展渠道",
};

const optionalTitles: Record<string, string> = {
  "connectivity.mode": "验证公网域名与 Agent 邮箱",
  "mail.local-ingest": "接入自己的邮件来源",
};

export function canonicalSetupAction(id: string) {
  return ["connectivity.choose-mode", "connectivity.repair"].includes(id) ? "connectivity.managed-authorize" : id;
}

export function buildSetupTaskModel(checks: SetupCheck[]) {
  const requiredChecks = checks.filter((check) => requiredRequirements.has(check.requirement));
  const blockedChecks = requiredChecks.filter((check) => check.state === "blocked");
  const requiredTasks = checks
    .filter((check) => requiredRequirements.has(check.requirement) && check.state === "action-required")
    .map((check) => toTask(check, blockedChecks));
  const optionalCandidates = [
    checks.find((check) => check.group === "connectivity" && check.state === "action-required")
      || checks.find((check) => check.id === "connectivity.mode" && check.state === "not-selected"),
    checks.find((check) => check.group === "mail-identity" && check.state === "action-required"),
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
    completedRequired,
    totalRequired: requiredChecks.length,
    progress: requiredChecks.length ? Math.round((completedRequired / requiredChecks.length) * 100) : 0,
  };
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
