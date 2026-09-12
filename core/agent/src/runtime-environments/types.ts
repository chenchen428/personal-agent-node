export type RuntimeEngine = "codex" | "claude-code";
export type RuntimeProfile = {
  mode: "account" | "custom";
  model: string;
  reasoningEffort: string;
  baseUrl: string;
  authType: "api-key" | "bearer";
  credentialConfigured: boolean;
};
export type ProfileDraft = Partial<RuntimeProfile> & { credential?: string; clearCredential?: boolean };
export type RuntimeEnvironmentView = {
  schemaVersion: 1;
  spaceId: string;
  revision: number;
  engine: RuntimeEngine;
  profiles: Record<RuntimeEngine, RuntimeProfile>;
};
export type RuntimeExecution = { engine: RuntimeEngine; revision: number; profile: RuntimeProfile; credential: string };
export type ConnectivityResult = {
  ok: boolean;
  engine: RuntimeEngine;
  protocol: "responses" | "anthropic-messages";
  status: "connected" | "missing-credential" | "invalid-config" | "unauthorized" | "timeout" | "network-error" | "protocol-error";
  message: string;
  durationMs: number;
};
export type RuntimeModel = { id: string; label: string; reasoningEfforts?: string[] };
export type RuntimeDetection = {
  engine: RuntimeEngine;
  installed: boolean;
  version: string;
  authentication: "authenticated" | "missing" | "unknown";
  protocol: "responses" | "anthropic-messages";
  models: RuntimeModel[];
  protocolReady: boolean;
  defaultModel?: RuntimeModel;
  reasoningEfforts?: string[];
  message: string;
};
