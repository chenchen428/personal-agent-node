export type AgentStatus = "available" | "updating" | "unavailable";

export type AgentProfileItem = {
  title: string;
  description?: string;
};

export type AgentWorkflowStep = AgentProfileItem & {
  step?: string;
};

export type AgentExample = AgentProfileItem & {
  kind?: string;
  summary?: string;
  preview?: string;
  device?: "desktop" | "mobile";
};

export type AgentPublicProfile = {
  overview: {
    role: string;
    tagline: string;
  };
  skillSummaries?: Array<{ id: string; label: string; summary: string }>;
  capabilities: AgentProfileItem[];
  useWhen: string[];
  notFor: string[];
  requiredInputs: string[];
  workflow: AgentWorkflowStep[];
  deliverables: AgentProfileItem[];
  examples: AgentExample[];
  limitations: string[];
  acceptance: string[];
  visualIdentity?: {
    accent?: string;
    color?: string;
    icon?: string;
  };
};

export type AgentDirectoryItem = {
  id: string;
  displayName: string;
  description: string;
  profile: AgentPublicProfile;
  status: AgentStatus;
};

export const agentStatusPresentation: Record<AgentStatus, {
  label: string;
  detail: string;
  tone: "danger" | "success" | "warning";
}> = {
  available: { label: "可用", detail: "已通过当前空间配置校验", tone: "success" },
  updating: { label: "更新中", detail: "配置正在更新，暂不接受新任务", tone: "warning" },
  unavailable: { label: "不可用", detail: "当前空间配置未通过校验", tone: "danger" },
};
