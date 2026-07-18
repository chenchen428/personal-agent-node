export type ConnectionTone = "success" | "warning" | "danger" | "info";

export type DomainVerification = {
  kind: "mail" | "sites";
  phase: "idle" | "authorizing" | "verifying" | "verified" | "failed";
  resource: string;
  startedAt: string | null;
  deadlineAt: string | null;
  updatedAt: string | null;
  error: { code: string; message: string } | null;
  evidence: { kind: "mail" | "site"; url: string; label: string; messageId?: string } | null;
  steps: Array<{ id: string; label: string; detail?: string; status: "pending" | "active" | "passed" | "failed" }>;
};

export type Connection = {
  id: string;
  name: string;
  accessMode: "account" | "browser" | "local";
  category: string;
  icon: string;
  summary: string;
  description: string;
  state: string;
  statusLabel: string;
  tone: ConnectionTone;
  capabilities: string[];
  primaryAction: string;
  runtime: Array<{ label: string; value: string }>;
  skill: { name: string; reference: string; description: string; document: string };
  cli: { command: string; description: string; operations: Array<{ name: string; risk: string; description: string }> };
  setup?: {
    runtimeBundled: boolean;
    browserBridge: string;
    browserBridgeInstallUrl: string;
    userConfirmationRequired: boolean;
    customExtensionRequired: boolean;
  };
  details?: { platformDomainBound?: boolean; platformDomain?: string; mailAddress?: string; publicOrigin?: string; domainVerification?: DomainVerification; policyEnabled?: boolean };
};

export type PersonalWechatDirectoryEntry = { id: string; name: string; maskedId: string };
export type PersonalWechatSetup = {
  qianxunRepositoryUrl: string;
  qianxunBaseUrl: string;
  callbackUrl: string;
};
export type PersonalWechatDirectory = {
  account: PersonalWechatDirectoryEntry;
  contacts: PersonalWechatDirectoryEntry[];
  groups: PersonalWechatDirectoryEntry[];
  readAt: string;
};
export type PersonalWechatPolicy = {
  schemaVersion: 1;
  enabled: boolean;
  contacts: Array<{ wxid: string; scope: "direct_and_group" | "direct_only" | "group_only" }>;
  groups: Array<{ wxid: string; trigger: "allowed_members_mention" | "any_member_mention" | "allowed_members_message" }>;
  updatedAt: string | null;
};
