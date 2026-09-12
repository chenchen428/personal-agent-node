import { createRuntimeEnvironmentService } from "../runtime-environments/index.ts";
import { discoverAppServerDefaultModel, discoverAppServerModels } from "../agent/app-server-runner.ts";
import { probeRuntimeAccount } from "../agent/runtime-runner.ts";
import { resolveCodexCli } from "../../../runtime/src/config.ts";
import { resolveClaudeCommand } from "../agent/claude-code-runner.ts";

export function createAgentRuntimeEnvironmentController(config: any) {
  const baseConfig = {
    workspace: config.workspaceRoot,
    command: config.codexCommand,
    appServerCommand: config.codexAppServerCommand,
    appServerArgs: config.codexAppServerArgs,
    agentEnv: process.env,
  };
  let codexCommand;
  let claudeCommand;
  try {
    const resolved = resolveCodexCli(process.env);
    codexCommand = { command: resolved.command, args: resolved.prefixArgs };
  } catch { /* The detector returns an actionable missing-installation result. */ }
  try { claudeCommand = resolveClaudeCommand(); } catch { /* Optional base is not installed. */ }
  return createRuntimeEnvironmentService({
    workspaceRoot: config.siteDataRoot,
    spaceId: config.spaceId || "default",
    legacyFile: config.codexRuntimeSettingsFile,
    legacyFallback: { model: config.codexModel, reasoningEffort: config.codexReasoningEffort },
    commands: { ...(codexCommand ? { codex: codexCommand } : {}), ...(claudeCommand ? { "claude-code": claudeCommand } : {}) },
    async detectAccount(engine, execution) {
      if (engine !== "codex" || execution.profile.mode !== "account") return {};
      const [models, defaultModel] = await Promise.all([
        discoverAppServerModels(baseConfig), discoverAppServerDefaultModel(baseConfig),
      ]);
      return {
        installed: true,
        models: models.map((item: any) => ({ id: item.id, label: item.label || item.id, reasoningEfforts: item.efforts || [] })),
        defaultModel: defaultModel ? { id: defaultModel.id, label: defaultModel.label || defaultModel.id } : undefined,
        protocolReady: true,
      };
    },
    accountConnectivity: (execution, signal) => probeRuntimeAccount(execution, baseConfig, signal),
  });
}
