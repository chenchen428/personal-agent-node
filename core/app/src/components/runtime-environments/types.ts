export type Engine = "codex" | "claude-code";
export type Profile = {
  mode: "account" | "custom";
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  authType: "api-key" | "bearer";
  credentialConfigured: boolean;
};
export type DraftProfile = Profile & { credential?: string; clearCredential?: boolean };
export type RuntimeSettings = {
  schemaVersion: 1;
  spaceId: string;
  revision: number;
  engine: Engine;
  profiles: Record<Engine, Profile>;
  readOnly?: boolean;
  inherited?: boolean;
  sourceSpace?: { id: string; kind: "personal"; displayName: string };
};
export type ModelOption = { id: string; label?: string; reasoningEfforts?: string[] };
export type Detection = {
  engine: Engine;
  installed: boolean;
  version: string | null;
  authentication: "authenticated" | "missing" | "unknown";
  models: ModelOption[];
  defaultModel?: ModelOption;
  reasoningEfforts?: string[];
  message: string;
};
export type ConnectionResult = { ok: boolean; engine: Engine; message: string; durationMs?: number };
export const engines: Engine[] = ["codex", "claude-code"];
export const engineLabels: Record<Engine, string> = { codex: "Codex", "claude-code": "Claude Code" };
export const effortLabels: Record<string, string> = {
  none: "无", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高",
};
